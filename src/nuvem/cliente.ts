// Ligação com o Supabase (login, equipe, sincronização, cotações e leitura por foto).
// O endereço e a chave pública vêm do build (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). A chave pública
// pode estar no app: ela só deixa chegar até as regras do servidor, que conferem tudo (ver SEGURANCA.md).
// A biblioteca só é carregada quando a nuvem é usada, para o app continuar leve e abrir sem internet.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Papel } from './esquema';
import type { LinhaRemota, OpEnvio, Resultado, Transporte } from './sinc';

const URL_NUVEM = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const CHAVE_PUBLICA = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export const nuvemConfigurada = () => !!(URL_NUVEM && CHAVE_PUBLICA && /^https:\/\//.test(URL_NUVEM));

let cliente: Promise<SupabaseClient> | null = null;
export function sb(): Promise<SupabaseClient> {
  if (!nuvemConfigurada()) return Promise.reject(new Error('A nuvem ainda não foi configurada neste app.'));
  cliente ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(URL_NUVEM!, CHAVE_PUBLICA!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'boiforte-sessao' } }));
  return cliente;
}

/** Mensagem de erro em português simples (sem detalhe técnico). */
function erro(e: { message?: string } | null | undefined): Error {
  const m = e?.message ?? '';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return new Error('Sem internet agora. Tente quando pegar sinal.');
  if (/JWT|token|session/i.test(m)) return new Error('Sua entrada venceu. Entre de novo.');
  if (/rate limit|Too many|security purposes/i.test(m)) return new Error('Muitas tentativas. Espere um minuto e tente de novo.');
  if (/Token has expired or is invalid|otp/i.test(m)) return new Error('Código errado ou vencido. Peça outro.');
  return new Error(m || 'Não deu certo. Tente de novo.');
}

async function rpc<T>(nome: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (await sb()).rpc(nome, args);
  if (error) throw erro(error);
  return data as T;
}

// ---------- login por código no e-mail ----------

const RE_EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export async function pedirCodigo(email: string) {
  const e = email.trim().toLowerCase();
  if (!RE_EMAIL.test(e)) throw new Error('Confira o e-mail.');
  const { error } = await (await sb()).auth.signInWithOtp({ email: e, options: { shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname } });
  if (error) throw erro(error);
}

export async function confirmarCodigo(email: string, codigo: string) {
  const token = codigo.replace(/\D/g, '');
  if (token.length < 6) throw new Error('O código tem 6 números.');
  const { error } = await (await sb()).auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: 'email' });
  if (error) throw erro(error);
}

export async function usuarioAtual(): Promise<{ id: string; email: string } | null> {
  if (!nuvemConfigurada()) return null;
  const { data } = await (await sb()).auth.getSession(); // lê do aparelho: funciona sem internet
  const u = data.session?.user;
  return u ? { id: u.id, email: u.email ?? '' } : null;
}

export async function sair() { await (await sb()).auth.signOut({ scope: 'local' }); }

// ---------- fazendas e equipe ----------

/** bloqueado: a pessoa está "pausada" porque a equipe passou do limite do plano (decidido no servidor). */
export interface MinhaFazenda { fazenda_id: string; nome: string; papel: Papel; bloqueado?: boolean }
export interface Membro { usuario_id: string; nome: string; papel: Papel; entrou_em: string; eu: boolean; bloqueado?: boolean }
export interface PlanoFazenda { plano: 'basico' | 'pro'; usuarios_extras: number; limite: number; pessoas: number; convites_abertos: number; eu_pausado: boolean }
export const NOME_PLANO: Record<string, string> = { basico: 'Básico', pro: 'Pro' };

export const minhasFazendas = () => rpc<MinhaFazenda[]>('minhas_fazendas', {});
export const criarFazenda = (nome: string, meuNome: string) => rpc<string>('criar_fazenda', { p_nome: nome, meu_nome: meuNome });
export const criarConvite = (f: string, papel: Papel) => rpc<string>('criar_convite', { f, p_papel: papel });
export async function aceitarConvite(codigo: string, meuNome: string): Promise<string> {
  const id = await rpc<string | null>('aceitar_convite', { p_codigo: codigo, meu_nome: meuNome });
  if (!id) throw new Error('Código inválido ou vencido. Peça um novo ao dono da fazenda.');
  return id;
}
export const equipe = (f: string) => rpc<Membro[]>('equipe', { f });
/** Plano e vagas da fazenda. Só para mostrar: quem limita é o servidor. */
export const planoDaFazenda = (f: string) => rpc<PlanoFazenda[]>('plano_da_fazenda', { f }).then((r) => r[0] ?? null);
export const mudarPapel = (f: string, usuario: string, papel: Papel) => rpc<void>('mudar_papel', { f, usuario, p_papel: papel });
export async function apagarMinhaConta() { await rpc<void>('apagar_minha_conta', { confirmar: 'APAGAR' }); await sair(); }
export const removerMembro = (f: string, usuario: string) => rpc<void>('remover_membro', { f, usuario });

export interface ConvitePendente { codigo: string; papel: Papel; expira_em: string }
/** Convites ainda não usados (só o dono enxerga, pela regra do servidor). */
export async function convitesPendentes(f: string): Promise<ConvitePendente[]> {
  const { data, error } = await (await sb()).from('convites').select('codigo, papel, expira_em')
    .eq('fazenda_id', f).is('usado_por', null).gt('expira_em', new Date().toISOString()).order('criado_em');
  if (error) throw erro(error);
  return (data ?? []) as ConvitePendente[];
}
export const cancelarConvite = (f: string, codigo: string) => rpc<void>('cancelar_convite', { f, p_codigo: codigo });

// ---------- sincronização ----------

export const transporteNuvem: Transporte = {
  enviar: (f: string, ops: OpEnvio[]) => rpc<Resultado[]>('enviar_alteracoes', { f, ops }),
  baixar: (f: string, desde: number, limite: number) => rpc<LinhaRemota[]>('baixar_alteracoes', { f, desde, limite }),
};

// ---------- cotações e foto ----------

export interface Cotacao { produto: string; praca: string; data: string; valor: number; unidade: string; fonte: string }

export async function ultimasCotacoes(): Promise<Cotacao[]> {
  const { data, error } = await (await sb()).from('cotacoes').select('produto, praca, data, valor, unidade, fonte').order('data', { ascending: false }).limit(200);
  if (error) throw erro(error);
  return (data ?? []).map((c) => ({ ...c, valor: Number(c.valor) })) as Cotacao[];
}

/** Manda a foto para o servidor ler (rótulo do núcleo ou visor da balança). */
export async function lerFoto<T>(tipo: 'rotulo' | 'balanca', imagemBase64: string, mime: string): Promise<T> {
  const { data, error } = await (await sb()).functions.invoke('ler-foto', { body: { tipo, imagem: imagemBase64, mime } });
  if (error) {
    const corpo = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw erro({ message: corpo?.erro ?? error.message });
  }
  return data as T;
}
