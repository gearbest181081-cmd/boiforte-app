// Função "ler-foto": lê o rótulo de um núcleo/suplemento ou o visor de uma balança a partir de uma foto.
// Segurança: exige login, exige ser de uma fazenda, cota diária por pessoa e teto geral no banco (pode_usar_foto),
// e a chave da IA fica só aqui no servidor. O CORS (APP_ORIGIN) só impede outros sites de usar a função pelo navegador
// de alguém; não é a proteção principal, porque fora do navegador qualquer um escolhe o cabeçalho Origin.
// A resposta da IA é limpa por limparLeitura antes de voltar; o app ainda mostra tudo para conferir.
import Anthropic from 'npm:@anthropic-ai/sdk@1.4.0';
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { ESQUEMA, PROMPT, limparLeitura, validarPedido } from '../_shared/foto.ts';

const ORIGEM = Deno.env.get('APP_ORIGIN') ?? '';
// Só manda Access-Control-Allow-Origin para o endereço do app (nunca o valor "null", que casaria com iframes isolados).
const cors = (origem: string | null): Record<string, string> => ({
  ...(ORIGEM && origem === ORIGEM ? { 'Access-Control-Allow-Origin': origem } : {}),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
});
const resposta = (corpo: unknown, status: number, origem: string | null) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors(origem), 'Content-Type': 'application/json' } });

const ia = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

Deno.serve(async (req) => {
  const origem = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origem) });
  if (req.method !== 'POST') return resposta({ erro: 'Método não permitido.' }, 405, origem);
  if (!ORIGEM || origem !== ORIGEM) return resposta({ erro: 'Origem não permitida.' }, 403, origem);
  if (Number(req.headers.get('Content-Length') ?? 0) > 6_500_000) return resposta({ erro: 'Foto grande demais.' }, 413, origem);

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return resposta({ erro: 'Entre na sua conta primeiro.' }, 401, origem);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data: u, error: eu } = await sb.auth.getUser(auth.slice(7));
  if (eu || !u?.user) return resposta({ erro: 'Sua entrada venceu. Entre de novo.' }, 401, origem);

  let pedido;
  try { pedido = validarPedido(await req.json()); } catch (e) { return resposta({ erro: (e as Error).message }, 400, origem); }

  const { error: ec } = await sb.rpc('pode_usar_foto');
  if (ec) return resposta({ erro: ec.message }, 429, origem);

  try {
    const r = await ia.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA[pedido.tipo] } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: pedido.mime, data: pedido.imagem } },
          { type: 'text', text: PROMPT[pedido.tipo] },
        ],
      }],
    } as never) as unknown as { stop_reason: string; content: { type: string; text?: string }[] };
    if (r.stop_reason === 'refusal') return resposta({ erro: 'Não consegui ler esta foto. Digite os valores.' }, 422, origem);
    if (r.stop_reason === 'max_tokens') return resposta({ erro: 'Não consegui ler esta foto. Tente outra mais perto.' }, 422, origem);
    const texto = r.content.find((b) => b.type === 'text')?.text ?? '';
    return resposta(limparLeitura(pedido.tipo, JSON.parse(texto)), 200, origem);
  } catch (e) {
    console.error('ler-foto', (e as Error).message);
    return resposta({ erro: 'A leitura não funcionou agora. Tente de novo ou digite os valores.' }, 502, origem);
  }
});
