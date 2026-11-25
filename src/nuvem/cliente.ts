// Ligação com o Supabase (login, equipe, sincronização e leitura por foto).
// O endereço e a chave pública vêm do build (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). A chave pública
// pode estar no app: ela só deixa chegar até as regras do servidor, que conferem tudo (ver SEGURANCA.md).
// A biblioteca só é carregada quando a nuvem é usada, para o app continuar leve e abrir sem internet.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Papel } from './esquema';
import type { LinhaRemota, OpEnvio, Resultado, Transporte } from './sinc';
import { ErroFoto, MIME_EXT, type ArmazemFotos, type TipoErroFoto } from '../anotacoes';

const URL_NUVEM = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const CHAVE_PUBLICA = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export const nuvemConfigurada = () => !!(URL_NUVEM && CHAVE_PUBLICA && /^https:\/\//.test(URL_NUVEM));

export const CHAVE_SESSAO = 'boiforte-sessao';

let cliente: Promise<SupabaseClient> | null = null;
export function sb(): Promise<SupabaseClient> {
  if (!nuvemConfigurada()) return Promise.reject(new Error('A nuvem ainda não foi configurada neste app.'));
  cliente ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(URL_NUVEM!, CHAVE_PUBLICA!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: CHAVE_SESSAO } }));
  return cliente;
}

/** Mensagem de erro em português simples (sem detalhe técnico). */
function erro(e: { message?: string } | null | undefined): Error {
  const m = e?.message ?? '';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return new Error('Sem internet agora. Tente quando pegar sinal.');
  if (/Invalid login credentials/i.test(m)) return new Error('E-mail ou senha errados. Confira e tente de novo. Se ainda não criou sua senha, toque em "Primeiro acesso".');
  if (/Email not confirmed/i.test(m)) return new Error('Seu e-mail ainda não foi confirmado. Toque em "Primeiro acesso" para receber o link.');
  if (/weak|Password should|password.*(characters|contain)/i.test(m)) return new Error(`Senha fraca: use pelo menos ${SENHA_MINIMA} letras e números misturados.`);
  if (/Token has expired or is invalid|otp/i.test(m)) return new Error('Código ou link errado ou vencido. Peça outro.');
  if (/JWT|token|session/i.test(m)) return new Error('Sua entrada venceu. Entre de novo.');
  if (/rate limit|Too many|security purposes/i.test(m)) return new Error('Muitas tentativas. Espere um minuto e tente de novo.');
  return new Error(m || 'Não deu certo. Tente de novo.');
}

async function rpc<T>(nome: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (await sb()).rpc(nome, args);
  if (error) throw erro(error);
  return data as T;
}

// ---------- entrada com e-mail e senha ----------
// Primeiro acesso: link no e-mail -> a pessoa entra por ele -> cadastra a senha.
// Depois: e-mail e senha. Esqueceu: outro link -> senha nova.
// Quem decide se a senha é forte e limita as tentativas é o servidor (painel do Supabase, ver CONFIGURAR.md);
// a conferência daqui só evita mandar uma senha que ele vai recusar.

const RE_EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
export const SENHA_MINIMA = 8;
const CHAVE_ULTIMO_EMAIL = 'boiforte-ultimo-email';

function emailLimpo(email: string) {
  const e = email.trim().toLowerCase();
  if (!RE_EMAIL.test(e)) throw new Error('Confira o e-mail.');
  return e;
}
const enderecoDoApp = () => location.origin + location.pathname;

/** O que falta na senha, em português simples (ou null se está boa). */
export function problemaNaSenha(senha: string): string | null {
  if (senha.length < SENHA_MINIMA) return `A senha precisa de pelo menos ${SENHA_MINIMA} letras ou números.`;
  if (senha.length > 72) return 'Senha comprida demais (até 72).';
  if (!/[A-Za-zÀ-ÿ]/.test(senha) || !/\d/.test(senha)) return 'Misture letras e números (exemplo: boi2026forte).';
  return null;
}

export function ultimoEmail(): string {
  try { return localStorage.getItem(CHAVE_ULTIMO_EMAIL) ?? ''; } catch { return ''; }
}
function lembrarEmail(e: string) { try { localStorage.setItem(CHAVE_ULTIMO_EMAIL, e); } catch { /* sem armazenamento */ } }

export async function entrarComSenha(email: string, senha: string) {
  const e = emailLimpo(email);
  if (!senha) throw new Error('Digite sua senha.');
  const { error } = await (await sb()).auth.signInWithPassword({ email: e, password: senha });
  if (error) throw erro(error);
  lembrarEmail(e);
}

/** Primeiro acesso: manda o link de confirmação (cria a conta se ainda não existe). */
export async function mandarLinkPrimeiroAcesso(email: string) {
  const e = emailLimpo(email);
  const { error } = await (await sb()).auth.signInWithOtp({ email: e, options: { shouldCreateUser: true, emailRedirectTo: enderecoDoApp() } });
  if (error) throw erro(error);
  lembrarEmail(e);
}

/** Esqueci a senha: manda o link para cadastrar outra. Não diz se o e-mail tem conta (para ninguém descobrir quem usa o app). */
export async function mandarLinkNovaSenha(email: string) {
  const e = emailLimpo(email);
  const { error } = await (await sb()).auth.resetPasswordForEmail(e, { redirectTo: enderecoDoApp() });
  if (error) throw erro(error);
  lembrarEmail(e);
}

/** Quando o e-mail traz um código de 6 números (aberto em outro aparelho, por exemplo). */
export async function confirmarCodigo(email: string, codigo: string, tipo: 'email' | 'recovery' = 'email') {
  const token = codigo.replace(/\D/g, '');
  if (token.length < 6) throw new Error('O código tem 6 números.');
  const { error } = await (await sb()).auth.verifyOtp({ email: emailLimpo(email), token, type: tipo });
  if (error) throw erro(error);
}

/** Cadastra (ou troca) a senha de quem entrou pelo link do e-mail. */
export async function definirSenha(senha: string) {
  const p = problemaNaSenha(senha);
  if (p) throw new Error(p);
  const { error } = await (await sb()).auth.updateUser({ password: senha });
  if (error && !/same_password|different from the old/i.test(`${(error as { code?: string }).code} ${error.message}`)) throw erro(error);
}

/** A conta já tem senha? (pergunta ao servidor; só sobre a própria conta) */
export const tenhoSenha = () => rpc<boolean>('tenho_senha', {});

export async function usuarioAtual(): Promise<{ id: string; email: string } | null> {
  if (!nuvemConfigurada()) return null;
  const { data } = await (await sb()).auth.getSession(); // lê do aparelho: funciona sem internet
  const u = data.session?.user;
  return u ? { id: u.id, email: u.email ?? '' } : null;
}

export interface Conta { id: string; email: string }

/**
 * Conta guardada neste aparelho, lida direto do armazenamento (sem internet e sem esperar a biblioteca).
 * A biblioteca só apaga a sessão guardada quando a pessoa sai ou quando o servidor diz que ela não vale mais;
 * sem sinal ela continua guardada, então o app segue aberto no pasto mesmo com a entrada vencida.
 * Isto só decide o que a TELA mostra: quem libera os dados da nuvem é o servidor, conferindo a sessão.
 */
export function contaGuardada(): Conta | null {
  if (!nuvemConfigurada()) return null;
  try {
    const s = JSON.parse(localStorage.getItem(CHAVE_SESSAO) ?? 'null');
    const u = s?.user;
    return s?.refresh_token && typeof u?.id === 'string' ? { id: u.id, email: typeof u.email === 'string' ? u.email : '' } : null;
  } catch { return null; }
}

export async function sair() { await (await sb()).auth.signOut({ scope: 'local' }); }

// ---------- fazendas e equipe ----------

/** bloqueado: a pessoa está "pausada" porque a equipe passou do limite do plano (decidido no servidor). */
export interface MinhaFazenda { fazenda_id: string; nome: string; papel: Papel; bloqueado?: boolean }
export interface Membro { usuario_id: string; nome: string; papel: Papel; entrou_em: string; eu: boolean; bloqueado?: boolean }
export interface PlanoFazenda { plano: 'basico' | 'pro'; usuarios_extras: number; limite: number; pessoas: number; convites_abertos: number; eu_pausado: boolean; fotos_usadas?: number; fotos_limite?: number }
/** Preço de cada pessoa a mais na equipe, além das que o plano já inclui. */
export const PRECO_PESSOA_EXTRA = 'R$ 14,90';
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
export async function apagarMinhaConta() {
  // As fazendas em que a pessoa está sozinha somem junto com a conta: antes, apaga as fotos delas do Storage.
  try {
    for (const f of (await minhasFazendas()).filter((x) => x.papel === 'dono' && !x.bloqueado)) {
      if ((await equipe(f.fazenda_id)).length === 1) await apagarFotosDaFazenda(f.fazenda_id);
    }
  } catch { /* não impede de apagar a conta */ }
  await rpc<void>('apagar_minha_conta', { confirmar: 'APAGAR' });
  await sair();
}
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

// ---------- foto ----------

/** Manda a foto para o servidor ler (rótulo do núcleo ou visor da balança). */
export async function lerFoto<T>(fazenda: string, tipo: 'rotulo' | 'balanca' | 'balanca_lote' | 'brinco', imagemBase64: string, mime: string): Promise<T> {
  const { data, error } = await (await sb()).functions.invoke('ler-foto', { body: { fazenda, tipo, imagem: imagemBase64, mime } });
  if (error) {
    const corpo = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw erro({ message: corpo?.erro ?? error.message });
  }
  return data as T;
}

// ---------- NDVI do satélite ----------

/** Pede para buscar agora o NDVI dos piquetes da fazenda (dono/gerente; o servidor limita a 2 por hora). */
export async function atualizarNdvi(fazenda: string): Promise<{ piquetes: number; leituras: number; falhas?: number; motivo?: string }> {
  const { data, error } = await (await sb()).functions.invoke('ndvi', { body: { fazenda } });
  if (error) {
    const corpo = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(corpo?.erro ?? 'Não deu para falar com o satélite agora. Tente mais tarde.');
  }
  return data as { piquetes: number; leituras: number; falhas?: number; motivo?: string };
}

/**
 * Foto do satélite de um piquete ('cor' = como o olho vê; 'verde' = mapa do verde). Fica guardada no celular:
 * a mesma foto não é pedida de novo (cada pedido gasta a cota gratuita do Copernicus).
 */
export async function fotoSatelite(fazenda: string, piquete: string, data: string, tipo: 'cor' | 'verde'): Promise<Blob> {
  const chave = `https://boiforte.local/foto-satelite/${piquete}/${data}/${tipo}.png`;
  const cache = typeof caches !== 'undefined' ? await caches.open('boiforte-satelite').catch(() => null) : null;
  const guardada = await cache?.match(chave).catch(() => undefined);
  if (guardada) return guardada.blob();
  const { data: img, error } = await (await sb()).functions.invoke('ndvi', { body: { fazenda, foto: tipo, piquete, data } });
  if (error) {
    const corpo = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(corpo?.erro ?? 'Não deu para buscar a foto do satélite agora. Tente mais tarde.');
  }
  if (!(img instanceof Blob) || !img.size) throw new Error('O satélite não mandou a foto.');
  const png = img.type === 'image/png' ? img : new Blob([await img.arrayBuffer()], { type: 'image/png' });
  await cache?.put(chave, new Response(png, { headers: { 'Content-Type': 'image/png' } })).catch(() => {});
  return png;
}

// ---------- fotos das anotações (Storage) ----------
// Balde privado "anotacoes", uma pasta por fazenda: "<fazenda>/<foto>.jpg". Quem decide quem lê, envia e
// apaga são as regras do servidor (20261123170000_anotacoes.sql); o app só leva e traz.

export const BALDE_FOTOS = 'anotacoes';

function erroFoto(e: unknown): ErroFoto {
  const x = e as { status?: number; statusCode?: string; message?: string; name?: string };
  const m = x?.message ?? '';
  const cod = String(x?.statusCode ?? x?.status ?? '');
  let tipo: TipoErroFoto = 'outro';
  let msg = m || 'Não foi possível enviar a foto.';
  if (x?.status == null || /Failed to fetch|NetworkError|network|fetch failed/i.test(m)) { tipo = 'rede'; msg = 'Sem internet agora.'; }
  else if (/jwt|token/i.test(m)) { tipo = 'rede'; msg = 'Sua entrada venceu. Entre de novo.'; } // tenta de novo depois de entrar
  else if (cod === '409' || /already exists|duplicate/i.test(m)) tipo = 'existe';
  else if (cod === '404' || /not.?found/i.test(m)) tipo = 'nao_existe';
  else if (cod === '403' || cod === '401' || /row-level security|unauthorized|permission/i.test(m)) { tipo = 'proibido'; msg = 'Seu papel na fazenda não permite mexer nesta foto.'; }
  else if (cod === '413' || /too large|size/i.test(m)) msg = 'Foto grande demais.';
  return new ErroFoto(tipo, msg);
}

export const armazemNuvem: ArmazemFotos = {
  async enviar(caminho, dados) {
    const { error } = await (await sb()).storage.from(BALDE_FOTOS).upload(caminho, dados, { contentType: MIME_EXT[caminho.split('.').pop() ?? ''] ?? 'image/jpeg', upsert: false, cacheControl: '31536000' });
    if (error) throw erroFoto(error);
  },
  async baixar(caminho) {
    const { data, error } = await (await sb()).storage.from(BALDE_FOTOS).download(caminho);
    if (error || !data) throw erroFoto(error);
    return data.arrayBuffer();
  },
  async apagar(caminho) {
    const { data, error } = await (await sb()).storage.from(BALDE_FOTOS).remove([caminho]);
    if (error) throw erroFoto(error);
    if (!data?.length) throw new ErroFoto('nao_existe', 'A foto não estava lá (ou não é sua).');
  },
};

/** Antes de apagar a fazenda da nuvem: apaga as fotos dela (o banco não consegue apagar arquivos do Storage). */
export async function apagarFotosDaFazenda(f: string) {
  const c = await sb();
  for (let rodada = 0; rodada < 100; rodada++) {
    const { data, error } = await c.storage.from(BALDE_FOTOS).list(f, { limit: 1000 });
    if (error) throw erroFoto(error);
    if (!data?.length) return;
    const { data: foram, error: e2 } = await c.storage.from(BALDE_FOTOS).remove(data.map((o) => `${f}/${o.name}`));
    if (e2) throw erroFoto(e2);
    if (!foram?.length) return; // sem permissão para o resto
  }
}
