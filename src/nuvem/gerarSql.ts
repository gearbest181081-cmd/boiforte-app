// Gera o SQL com as regras de validação de cada tabela, a partir de src/validar.ts e das referências.
// Assim o servidor confere exatamente as mesmas regras que o celular, sem duas listas para manter.
import { ESQUEMAS, ROTULOS } from '../validar';
import { REFERENCIAS } from './esquema';

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function gerarSqlEsquemas(): string {
  const linhas = Object.keys(ESQUEMAS).sort().map((t) => {
    const refs = { ...REFERENCIAS[t].campos, __listas: REFERENCIAS[t].listas ?? {} };
    return `  (${q(t)}, ${q(ROTULOS[t] ?? t)}, ${q(JSON.stringify(ESQUEMAS[t]))}::jsonb, ${q(JSON.stringify(refs))}::jsonb)`;
  });
  return [
    '-- GERADO por src/nuvem/gerarSql.ts a partir de src/validar.ts e src/nuvem/esquema.ts.',
    '-- Não edite à mão: rode `npm run gerar-sql` depois de mudar as regras.',
    'insert into public.bf_esquemas (tabela, rotulo, regras, refs) values',
    linhas.join(',\n'),
    'on conflict (tabela) do update set rotulo = excluded.rotulo, regras = excluded.regras, refs = excluded.refs;',
    '',
  ].join('\n');
}
