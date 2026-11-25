// Área do módulo × área dos piquetes, na tela: quanto já foi usado, quanto sobra e o aviso na hora
// quando a área digitada para um piquete passa do que sobra no módulo (a regra fica em src/pasto.ts e no servidor).
import { fmtNum } from '../calc';
import { FOLGA_AREA_HA, type UsoArea } from '../pasto';

/** Área do módulo e quanto os piquetes já usam; módulo antigo, sem área, ganha o aviso para informar. */
export function AreaDoModulo({ uso, informar }: { uso: UsoArea; informar?: () => void }) {
  if (uso.areaModulo == null) {
    return (
      <div className="alerta atencao" data-testid="faltaAreaModulo">
        <span className="ic">🔔</span>
        <div>
          <b>Falta a área do módulo</b>
          Sem ela, o app não confere se os piquetes cabem no módulo{uso.usada > 0 ? ` (hoje os piquetes somam ${fmtNum(uso.usada, 2)} ha)` : ''}.
          {informar && <Botao rotulo="Informar a área" acao={informar} />}
        </div>
      </div>
    );
  }
  // Passou da área: acontece quando dois celulares cadastram piquetes sem internet ao mesmo tempo
  // (o servidor recusa o que não coube) ou com dado gravado antes desta conferência.
  if (uso.usada > uso.areaModulo + FOLGA_AREA_HA) {
    return (
      <div className="alerta ruim" data-testid="piquetesPassamArea">
        <span className="ic">⚠️</span>
        <div>
          <b>Os piquetes passam da área do módulo</b>
          Os piquetes somam {fmtNum(uso.usada, 2)} ha e o módulo tem {fmtNum(uso.areaModulo, 2)} ha. Diminua a área de algum piquete ou aumente a do módulo.
          {informar && <Botao rotulo="Corrigir a área" acao={informar} />}
        </div>
      </div>
    );
  }
  const cheio = uso.livre! <= FOLGA_AREA_HA;
  return (
    <p className="mudo" style={{ margin: '8px 0 6px' }} data-testid="areaModulo">
      Área: <b>{fmtNum(uso.areaModulo, 2)} ha</b> · piquetes: {fmtNum(uso.usada, 2)} ha · {cheio ? 'todo dividido' : `sobram ${fmtNum(uso.livre, 2)} ha`}
    </p>
  );
}

/** Botão embaixo do texto do aviso: a frase fica com a largura toda, fácil de ler no celular. */
function Botao({ rotulo, acao }: { rotulo: string; acao: () => void }) {
  return <div style={{ marginTop: 8 }}><button type="button" className="btn sec pequeno" onClick={acao}>{rotulo}</button></div>;
}

/** Aviso na hora, enquanto digita, quando a área do piquete passa do que sobra no módulo. */
export function PassouDaArea({ uso, area }: { uso: UsoArea; area: number | null }) {
  if (uso.livre == null || area == null || area <= uso.livre + FOLGA_AREA_HA) return null;
  return (
    <div className="alerta ruim" role="status" data-testid="passouAreaModulo">
      <span className="ic">⚠️</span>
      <div>
        <b>Passa da área do módulo</b>
        {uso.livre > FOLGA_AREA_HA ? `Este piquete pode ter no máximo ${fmtNum(uso.livre, 2)} ha.` : 'Não sobra área: diminua outro piquete ou aumente a área do módulo.'}
      </div>
    </div>
  );
}
