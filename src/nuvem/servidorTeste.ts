// Só para testes: sobe o banco do servidor (as mesmas migrações do Supabase) num Postgres em memória (PGlite),
// com uma imitação mínima do que o Supabase fornece (auth.users, auth.uid() e os papéis anon/authenticated).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PASTA = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));

const IMITACAO_SUPABASE = `
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated;
`;

export interface Servidor {
  pg: PGlite;
  novoUsuario(email: string): Promise<string>;
  /** Roda como a pessoa logada (papel "authenticated", como faz a API do Supabase). */
  como<T>(uid: string | null, fn: () => Promise<T>): Promise<T>;
  /** Chama uma função RPC como a pessoa. Erros do servidor viram exceção com a mensagem. */
  rpc<T = unknown>(uid: string | null, nome: string, args: Record<string, unknown>): Promise<T>;
}

export async function subirServidor(): Promise<Servidor> {
  const pg = await PGlite.create();
  await pg.exec(IMITACAO_SUPABASE);
  for (const f of readdirSync(PASTA).filter((x: string) => x.endsWith('.sql')).sort()) await pg.exec(readFileSync(join(PASTA, f), 'utf8'));
  let n = 0;
  const como = async <T,>(uid: string | null, fn: () => Promise<T>): Promise<T> => {
    await pg.exec(uid ? `set role authenticated; select set_config('request.jwt.claims', '{"sub":"${uid}"}', false);` : `set role anon; select set_config('request.jwt.claims', '', false);`);
    try { return await fn(); } finally { await pg.exec(`reset role; select set_config('request.jwt.claims', '', false);`); }
  };
  return {
    pg,
    como,
    async novoUsuario(email) {
      const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
      await pg.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
      return id;
    },
    async rpc(uid, nome, args) {
      const chaves = Object.keys(args);
      const sql = `select * from public.${nome}(${chaves.map((k, i) => `${k} => $${i + 1}`).join(', ')})`;
      const vals = chaves.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
      const r = await como(uid, () => pg.query<Record<string, unknown>>(sql, vals));
      const cols = r.fields.map((f) => f.name);
      if (cols.length === 1 && cols[0] === nome) return (r.rows.length === 1 ? r.rows[0][nome] : r.rows.map((x) => x[nome])) as never;
      return r.rows as never;
    },
  };
}
