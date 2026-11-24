import { PAPEIS, PERMISSOES, type Papel } from '../nuvem/esquema';

/** Mostra, em duas listas, o que a pessoa com este papel pode e não pode fazer no app. */
export function Permissoes({ papel }: { papel: Papel }) {
  const p = PERMISSOES[papel];
  return (
    <div className="permissoes" data-testid="permissoes" aria-label={`O que o ${PAPEIS[papel].nome.toLowerCase()} pode fazer`}>
      <ul>
        {p.pode.map((t) => <li key={t} className="pode"><span aria-hidden="true">✅</span>{t}</li>)}
        {p.naoPode.map((t) => <li key={t} className="nao"><span aria-hidden="true">🚫</span>Não pode: {t.charAt(0).toLowerCase() + t.slice(1)}</li>)}
      </ul>
    </div>
  );
}
