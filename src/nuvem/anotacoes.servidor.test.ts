// Anotações e tarefas no servidor: carimbo de quem anotou/resolveu, regras do vaqueiro e as regras
// das fotos no Storage (balde "anotacoes"), tentando furar como um app adulterado faria.
import { describe, it, expect, beforeAll } from 'vitest';
import { subirServidor, type Servidor } from './servidorTeste';

const uuid = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Res = { tabela: string; gid: string; ok: boolean; erro?: string }[];
type Linha = { tabela: string; gid: string; dados: Record<string, unknown> | null; excluido: boolean };

describe('anotações no servidor', () => {
  let s: Servidor;
  let ana: string, gil: string, vito: string, vera: string, duda: string, beto: string;
  let fa: string, fb: string;
  const enviar = (u: string, f: string, ops: unknown[]) => s.rpc<Res>(u, 'enviar_alteracoes', { f, ops });
  const anot = (n: number, extra: Record<string, unknown> = {}) => ({
    tabela: 'anotacoes', gid: uuid(n), op: 'put',
    dados: { texto: 'Cerca caída no piquete 3', categoria: 'cerca', moduloId: uuid(2), piqueteId: uuid(3), urgente: true, feita: false, data: '2026-11-23', criadoEm: 0, ...extra },
  });
  const ler = async (u: string, f: string, gid: string) =>
    (await s.rpc<Linha[]>(u, 'baixar_alteracoes', { f, desde: 0 })).filter((l) => l.gid === gid).pop();
  const entrar = async (u: string, papel: string, nome: string) =>
    s.rpc(u, 'aceitar_convite', { p_codigo: await s.rpc<string>(ana, 'criar_convite', { f: fa, p_papel: papel }), meu_nome: nome });

  beforeAll(async () => {
    s = await subirServidor();
    [ana, gil, vito, vera, duda, beto] = await Promise.all(['ana', 'gil', 'vito', 'vera', 'duda', 'beto'].map((n) => s.novoUsuario(n + '@x')));
    fa = await s.rpc<string>(ana, 'criar_fazenda', { p_nome: 'Boa Vista', meu_nome: 'Ana' });
    fb = await s.rpc<string>(beto, 'criar_fazenda', { p_nome: 'Santa Rita', meu_nome: 'Beto' });
    await s.pg.query(`select public.definir_plano($1, 'pro', 4)`, [fa]);
    await entrar(gil, 'gerente', 'Gil');
    await entrar(vito, 'vaqueiro', 'Vito');
    await entrar(vera, 'vaqueiro', 'Vera');
    await entrar(duda, 'consultor', 'Duda');
    const r = await enviar(ana, fa, [
      { tabela: 'propriedades', gid: uuid(1), op: 'put', dados: { nome: 'Boa Vista', criadoEm: 0 } },
      { tabela: 'modulos', gid: uuid(2), op: 'put', dados: { propriedadeId: uuid(1), nome: 'Retiro', criadoEm: 0 } },
      { tabela: 'piquetes', gid: uuid(3), op: 'put', dados: { moduloId: uuid(2), nome: 'Piquete 3', criadoEm: 0 } },
    ]);
    expect(r.every((x) => x.ok)).toBe(true);
  }, 30000);

  it('quem anotou é carimbado pelo servidor (o que o celular manda é ignorado)', async () => {
    const r = await enviar(vito, fa, [anot(10, { autor: 'Ana', autorId: ana, feitaPor: 'Fulano', fotos: [{ foto: uuid(900) }] })]);
    expect(r[0]).toMatchObject({ ok: true });
    const l = await ler(ana, fa, uuid(10));
    expect(l?.dados).toMatchObject({ autor: 'Vito', autorId: vito, texto: 'Cerca caída no piquete 3', fotos: [{ foto: uuid(900) }] });
    expect(l?.dados).not.toHaveProperty('feitaPor');
    // edição de outra pessoa não troca o autor
    await enviar(ana, fa, [anot(10, { texto: 'Cerca caída, 3 lascas', autor: 'Ana', autorId: ana })]);
    expect((await ler(ana, fa, uuid(10)))?.dados).toMatchObject({ autor: 'Vito', autorId: vito, texto: 'Cerca caída, 3 lascas' });
  });

  it('quem resolveu também é do servidor; reabrir limpa', async () => {
    await enviar(vera, fa, [anot(10, { feita: true, feitaEm: '2026-11-24', feitaPor: 'Ana' })]);
    expect((await ler(ana, fa, uuid(10)))?.dados).toMatchObject({ feita: true, feitaPor: 'Vera', feitaEm: '2026-11-24', autor: 'Vito' });
    await enviar(ana, fa, [anot(10, { feita: true, feitaEm: '2026-11-24', texto: 'editado depois de feito' })]);
    expect((await ler(ana, fa, uuid(10)))?.dados).toMatchObject({ feitaPor: 'Vera' });
    await enviar(gil, fa, [anot(10, { feita: false, feitaEm: '2026-11-24' })]);
    const d = (await ler(ana, fa, uuid(10)))?.dados;
    expect(d).toMatchObject({ feita: false });
    expect(d).not.toHaveProperty('feitaPor');
    expect(d).not.toHaveProperty('feitaEm');
  });

  it('o vaqueiro vê e grava anotações, mas só apaga as dele', async () => {
    expect((await ler(vera, fa, uuid(10)))?.dados).toMatchObject({ autor: 'Vito' });
    const r = await enviar(vera, fa, [{ tabela: 'anotacoes', gid: uuid(10), op: 'del' }]);
    expect(r[0].ok).toBe(false);
    expect(r[0].erro).toMatch(/só quem anotou/);
    expect((await ler(ana, fa, uuid(10)))?.excluido).toBe(false);
    await enviar(vera, fa, [anot(11, { texto: 'Bebedouro vazando' })]);
    expect((await enviar(vera, fa, [{ tabela: 'anotacoes', gid: uuid(11), op: 'del' }]))[0].ok).toBe(true);
    expect((await ler(ana, fa, uuid(11)))?.excluido).toBe(true);
    // gerente apaga a de qualquer um
    await enviar(vito, fa, [anot(12)]);
    expect((await enviar(gil, fa, [{ tabela: 'anotacoes', gid: uuid(12), op: 'del' }]))[0].ok).toBe(true);
  });

  it('recusa foto com id fora do formato, módulo de outra fazenda e consultor', async () => {
    let r = await enviar(ana, fa, [anot(13, { fotos: [{ foto: '../../outra-fazenda/x' }] })]);
    expect(r[0]).toMatchObject({ ok: false, erro: 'Anotação: foto inválida.' });
    r = await enviar(ana, fa, [anot(14, { fotos: [1, 2, 3, 4, 5].map((n) => ({ foto: uuid(800 + n) })) })]);
    expect(r[0].ok).toBe(false); // no máximo 4 fotos
    r = await enviar(beto, fb, [anot(15)]); // módulo/piquete são da fazenda da Ana
    expect(r[0]).toMatchObject({ ok: false });
    expect(r[0].erro).toMatch(/não existe nesta fazenda/);
    await expect(enviar(duda, fa, [anot(16)])).rejects.toThrow('Consultor só pode ver');
    await expect(s.rpc(beto, 'baixar_alteracoes', { f: fa, desde: 0 })).rejects.toThrow('não faz parte');
  });

  // ------------------------------------------------------------ fotos no Storage
  const caminho = (f: string, n: number) => `${f}/${uuid(n)}.jpg`;
  const subir = (u: string | null, nome: string, balde = 'anotacoes') =>
    s.como(u, () => s.pg.query(`insert into storage.objects (bucket_id, name, owner_id) values ($1, $2, $3)`, [balde, nome, u]).then(() => 'ok', (e) => String(e.message)));
  const ver = (u: string) => s.como(u, () => s.pg.query<{ name: string }>(`select name from storage.objects where bucket_id = 'anotacoes' order by name`)).then((r) => r.rows.map((x) => x.name));
  const apagar = (u: string, nome: string) => s.como(u, () => s.pg.query(`delete from storage.objects where bucket_id = 'anotacoes' and name = $1`, [nome])).then((r) => r.affectedRows);

  it('balde privado, só JPEG e até 1 MB', async () => {
    const b = await s.pg.query<{ public: boolean; file_size_limit: number; allowed_mime_types: string[] }>(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'anotacoes'`);
    expect(b.rows[0]).toEqual({ public: false, file_size_limit: 1048576, allowed_mime_types: ['image/jpeg'] });
  });

  it('enviar foto: só quem é da fazenda e pode gravar, na pasta da fazenda, com nome certo', async () => {
    expect(await subir(vito, caminho(fa, 1))).toBe('ok');
    expect(await subir(ana, caminho(fa, 2))).toBe('ok');
    expect(await subir(gil, caminho(fa, 3))).toBe('ok');
    expect(await subir(beto, caminho(fb, 4))).toBe('ok');
    const recusa = /row-level security/;
    expect(await subir(beto, caminho(fa, 5))).toMatch(recusa); // pasta de outra fazenda
    expect(await subir(duda, caminho(fa, 6))).toMatch(recusa); // consultor só olha
    expect(await subir(null, caminho(fa, 7))).toMatch(/row-level security|permission denied/); // sem login
    for (const nome of [`${fa}/x.jpg`, `${fa}/${uuid(8)}.png`, `${fa}/../${fb}/${uuid(8)}.jpg`, `${fa}/sub/${uuid(8)}.jpg`, `${uuid(8)}.jpg`, `${fa.toUpperCase()}/${uuid(8)}.jpg`]) {
      expect(await subir(ana, nome), nome).toMatch(recusa);
    }
    expect(await subir(ana, caminho(fa, 9), 'outro-balde')).toMatch(/row-level security|violates foreign key/);
  });

  it('ver foto: só quem é da fazenda (o consultor também vê)', async () => {
    const daA = [1, 2, 3].map((n) => caminho(fa, n)).sort();
    expect(await ver(ana)).toEqual(daA);
    expect(await ver(vito)).toEqual(daA);
    expect(await ver(duda)).toEqual(daA);
    expect(await ver(beto)).toEqual([caminho(fb, 4)]);
  });

  it('ninguém troca uma foto já enviada', async () => {
    const r = await s.como(ana, () => s.pg.query(`update storage.objects set name = $1 where name = $2`, [caminho(fa, 50), caminho(fa, 1)]));
    expect(r.affectedRows).toBe(0);
    expect(await ver(ana)).toContain(caminho(fa, 1));
  });

  it('apagar foto: dono e gerente qualquer uma; vaqueiro só a dele; de fora, nenhuma', async () => {
    expect(await apagar(vera, caminho(fa, 1))).toBe(0); // é do Vito
    expect(await apagar(beto, caminho(fa, 1))).toBe(0);
    expect(await apagar(duda, caminho(fa, 1))).toBe(0);
    expect(await apagar(vito, caminho(fa, 1))).toBe(1);
    expect(await apagar(gil, caminho(fa, 2))).toBe(1); // era da Ana
    expect(await ver(ana)).toEqual([caminho(fa, 3)]);
  });

  it('quem foi tirado da equipe perde o acesso às fotos na hora', async () => {
    const rui = await s.novoUsuario('rui@x');
    await entrar(rui, 'vaqueiro', 'Rui');
    expect(await subir(rui, caminho(fa, 20))).toBe('ok');
    await s.rpc(ana, 'remover_membro', { f: fa, usuario: rui });
    expect(await ver(rui)).toEqual([]);
    expect(await subir(rui, caminho(fa, 21))).toMatch(/row-level security/);
    expect(await apagar(rui, caminho(fa, 20))).toBe(0);
  });

  it('limites: 300 fotos por pessoa por dia e 5.000 por fazenda', async () => {
    const janela = `to_timestamp(floor(extract(epoch from now()) / 86400) * 86400)`;
    await s.pg.query(`insert into public.limites (usuario_id, tipo, janela, contagem) values ($1, 'foto_anotacao', ${janela}, 300)
      on conflict on constraint limites_pkey do update set contagem = 300`, [vera]);
    expect(await subir(vera, caminho(fa, 30))).toMatch(/Muitas tentativas/);
    await s.pg.query(`insert into storage.objects (bucket_id, name) select 'anotacoes', $1 || '/' || gen_random_uuid() || '.jpg' from generate_series(1, 5000)`, [fa]);
    expect(await subir(ana, caminho(fa, 31))).toMatch(/limite de 5.000 fotos/);
    expect(await subir(beto, caminho(fb, 32))).toBe('ok'); // a outra fazenda não é afetada
  });

  it('as funções das regras não ficam abertas pela API nem perdem a permissão com migrações futuras', async () => {
    // migração futura que faz o "revoke" de sempre no schema public não derruba as regras das fotos
    await s.pg.exec(`revoke execute on all functions in schema public from public, anon, authenticated;`);
    expect(await ver(beto)).toContain(caminho(fb, 32));
    const e = await s.como(null, () => s.pg.query(`select bf_privado.pode_ver_foto('x')`).then(() => null, (x) => String(x)));
    expect(e).toMatch(/permission denied/);
    await s.pg.exec(`grant execute on function public.bf_vaqueiro_le(), public.bf_papel(uuid) to authenticated;`);
  });
});
