// Função "atualizar-cotacoes": chamada uma vez por dia pelo agendador (GitHub Actions).
// Não é aberta ao público: exige o cabeçalho x-cron-secret igual ao segredo CRON_SECRET.
// Grava pela função do banco gravar_cotacoes, que só a chave de serviço pode chamar e que descarta números fora da faixa.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { lerFontes, lerTabelaIndicador, type CotacaoLida } from '../_shared/cotacoes.ts';
import { segredoConfere } from '../_shared/foto.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Método não permitido', { status: 405 });
  if (!segredoConfere(req.headers.get('x-cron-secret') ?? '', Deno.env.get('CRON_SECRET') ?? '')) return new Response('Proibido', { status: 403 });

  const fontes = lerFontes(Deno.env.get('FONTES_COTACOES'));
  const lidas: CotacaoLida[] = [];
  const falhas: string[] = [];
  for (const f of fontes) {
    try {
      const r = await fetch(f.url, { headers: { 'User-Agent': 'BoiForte/1.0 (cotacoes diarias)' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const html = (await r.text()).slice(0, 2_000_000);
      const v = lerTabelaIndicador(html);
      if (!v) throw new Error('tabela não encontrada');
      lidas.push({ produto: f.produto, praca: f.praca, unidade: f.unidade, fonte: f.fonte, ...v });
    } catch (e) { falhas.push(`${f.produto}/${f.praca}: ${(e as Error).message}`); }
  }
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data, error } = await sb.rpc('gravar_cotacoes', { lista: lidas });
  if (error) return new Response(JSON.stringify({ erro: error.message, falhas }), { status: 500 });
  return new Response(JSON.stringify({ gravadas: data, lidas: lidas.length, falhas }), { headers: { 'Content-Type': 'application/json' } });
});
