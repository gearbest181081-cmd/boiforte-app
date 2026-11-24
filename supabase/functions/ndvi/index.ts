// Função "ndvi": busca o NDVI do Sentinel-2 de cada piquete com contorno e grava no banco (tabela "ndvi" do app).
// Dois jeitos de chamar:
//   * agendado (Cron do Supabase), com o cabeçalho x-cron-secret = CRON_SECRET: todas as fazendas, os piquetes
//     mais atrasados primeiro, até NDVI_MAX_PIQUETES por rodada (padrão 250);
//   * pelo app, com o login do dono ou do gerente e { fazenda }: só aquela fazenda (o banco limita a 2 por hora).
// Segredos (só no servidor): CDSE_CLIENT_ID e CDSE_CLIENT_SECRET (conta gratuita do Copernicus Data Space), CRON_SECRET.
// Cota gratuita do Copernicus: 10.000 pedidos e 10.000 unidades de processamento por mês; cada piquete gasta 1 pedido por rodada.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { CDSE_ESTATISTICA, CDSE_TOKEN, lerResposta, pedidoEstatistica, somaDias } from '../_shared/ndvi.ts';

const ORIGEM = Deno.env.get('APP_ORIGIN') ?? '';
const MAX = Math.min(Number(Deno.env.get('NDVI_MAX_PIQUETES') ?? 250) || 250, 2000);
const cors = (origem: string | null): Record<string, string> => ({
  ...(ORIGEM && origem === ORIGEM ? { 'Access-Control-Allow-Origin': origem } : {}),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
});
const resposta = (corpo: unknown, status: number, origem: string | null) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors(origem), 'Content-Type': 'application/json' } });
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Comparação de segredo sem vazar pelo tempo. */
function igual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function tokenCdse(): Promise<string> {
  const corpo = new URLSearchParams({ grant_type: 'client_credentials', client_id: Deno.env.get('CDSE_CLIENT_ID') ?? '', client_secret: Deno.env.get('CDSE_CLIENT_SECRET') ?? '' });
  const r = await fetch(CDSE_TOKEN, { method: 'POST', body: corpo });
  if (!r.ok) throw new Error(`Copernicus recusou a entrada (${r.status}). Confira CDSE_CLIENT_ID e CDSE_CLIENT_SECRET.`);
  return (await r.json()).access_token;
}

Deno.serve(async (req) => {
  const origem = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origem) });
  if (req.method !== 'POST') return resposta({ erro: 'Método não permitido.' }, 405, origem);

  const servico = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  let fazenda: string | null = null;
  let limite = MAX;

  if (igual(req.headers.get('x-cron-secret') ?? '', Deno.env.get('CRON_SECRET') ?? '')) {
    // agendado: todas as fazendas
  } else {
    if (!ORIGEM || origem !== ORIGEM) return resposta({ erro: 'Origem não permitida.' }, 403, origem);
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return resposta({ erro: 'Entre na sua conta primeiro.' }, 401, origem);
    const usuario = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: u, error: eu } = await usuario.auth.getUser(auth.slice(7));
    if (eu || !u?.user) return resposta({ erro: 'Sua entrada venceu. Entre de novo.' }, 401, origem);
    const corpo = await req.json().catch(() => null) as { fazenda?: unknown } | null;
    if (typeof corpo?.fazenda !== 'string' || !RE_UUID.test(corpo.fazenda)) return resposta({ erro: 'Ligue o celular a uma fazenda na nuvem.' }, 400, origem);
    // papel (dono/gerente) e limite de 2 por hora conferidos no banco, como a própria pessoa
    const { error: ep } = await usuario.rpc('pedir_ndvi', { f: corpo.fazenda });
    if (ep) return resposta({ erro: ep.message }, 429, origem);
    fazenda = corpo.fazenda;
    limite = Math.min(MAX, 300);
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const { data: piquetes, error } = await servico.rpc('piquetes_para_ndvi', { p_fazenda: fazenda, p_limite: limite });
  if (error) return resposta({ erro: 'Não deu para ler os piquetes.' }, 500, origem);
  // no agendado, pula quem já tem leitura dos últimos 5 dias (o satélite passa a cada ~5 dias)
  const fila = (piquetes as { fazenda_id: string; gid: string; contorno: unknown; ultima: string | null }[])
    .filter((p) => fazenda || !p.ultima || p.ultima < somaDias(hoje, -5));
  if (!fila.length) return resposta({ piquetes: 0, leituras: 0, falhas: 0 }, 200, origem);

  let token: string;
  try { token = await tokenCdse(); } catch (e) {
    console.error('ndvi', (e as Error).message);
    return resposta({ erro: 'O satélite não está configurado no servidor.' }, 503, origem);
  }

  let leituras = 0, feitos = 0, falhas = 0;
  let motivo: string | undefined; // primeiro erro, para a tela e para os Logs
  const inicio = Date.now();
  for (const p of fila) {
    if (Date.now() - inicio > 120_000) break; // a função tem tempo limitado; o resto vai na próxima rodada
    const pedido = pedidoEstatistica(p.contorno, p.ultima, hoje);
    if (!pedido) { falhas++; motivo ??= 'contorno inválido'; console.warn('ndvi', p.gid, 'contorno inválido'); continue; }
    try {
      const r = await fetch(CDSE_ESTATISTICA, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(pedido) });
      if (r.status === 429) { console.warn('ndvi: cota do Copernicus atingida'); motivo ??= 'cota do Copernicus atingida'; break; }
      if (!r.ok) {
        const txt = (await r.text().catch(() => '')).slice(0, 400);
        falhas++; motivo ??= `Copernicus ${r.status}`;
        console.warn('ndvi', p.gid, r.status, txt);
        continue;
      }
      const linhas = lerResposta(await r.json());
      if (linhas.length) {
        const { data: n, error: eg } = await servico.rpc('gravar_ndvi', { p_fazenda: p.fazenda_id, p_piquete: p.gid, p_linhas: linhas });
        if (eg) { falhas++; motivo ??= 'gravar'; console.warn('ndvi gravar', p.gid, eg.message); continue; }
        leituras += Number(n) || 0;
      }
      feitos++;
    } catch (e) {
      falhas++; motivo ??= 'rede';
      console.warn('ndvi', p.gid, (e as Error).message);
    }
  }
  console.log('ndvi', JSON.stringify({ fazenda, fila: fila.length, feitos, leituras, falhas, motivo }));
  return resposta({ piquetes: feitos, leituras, falhas, motivo }, 200, origem);
});
