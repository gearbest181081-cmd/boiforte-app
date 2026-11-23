import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { criarLote, db, FASES, type Controle, type Fase, type Sexo } from '../db';
import { hojeISO } from '../calc';
import { TIPOS } from '../nutricao';
import { CampoData, CampoEscolha, CampoNumero, CampoTexto, num, Opcoes, Topo, useAviso } from '../components/ui';

/** GMD de referência por fase (tabela de referência da planilha, ajustável). */
export const GMD_SUGERIDO: Record<Fase, number> = { cria: 0.7, recria: 0.6, engorda_pasto: 0.75, tip: 0.95, confinamento: 1.35 };
export const PESO_ALVO_SUGERIDO: Record<Fase, number> = { cria: 210, recria: 360, engorda_pasto: 510, tip: 540, confinamento: 540 };

export function LoteForm() {
  const { id } = useParams();
  const editando = id != null;
  const nav = useNavigate();
  const aviso = useAviso();
  const props = useLiveQuery(() => db.propriedades.toArray());
  const formulas = useLiveQuery(() => db.formulas.toArray());
  const [f, setF] = useState({
    nome: '', propriedadeId: 0, piqueteId: 0, fase: 'recria' as Fase, sexo: 'macho' as Sexo, controle: 'lote' as Controle,
    qtd: '', data: hojeISO(), pesoEntrada: '', pesoAlvo: String(PESO_ALVO_SUGERIDO.recria), gmdMeta: String(GMD_SUGERIDO.recria).replace('.', ','), obs: '', formulaId: 0, consumo: '',
  });
  const set = (k: keyof typeof f) => (v: any) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!editando) return;
    db.lotes.get(Number(id)).then((l) => {
      if (!l) return;
      setF({
        nome: l.nome, propriedadeId: l.propriedadeId, piqueteId: l.piqueteId ?? 0, fase: l.fase, sexo: l.sexo, controle: l.controle,
        qtd: String(l.qtdCabecas), data: l.dataEntrada, pesoEntrada: '', pesoAlvo: l.pesoAlvo ? String(l.pesoAlvo) : '',
        gmdMeta: l.gmdMeta ? String(l.gmdMeta).replace('.', ',') : '', obs: l.obs ?? '',
        formulaId: l.formulaId ?? 0, consumo: l.consumoPctPV ? String(+(l.consumoPctPV * 100).toFixed(4)).replace('.', ',') : '',
      });
    });
  }, [editando, id]);

  useEffect(() => {
    if (props && props.length && !f.propriedadeId) setF((x) => ({ ...x, propriedadeId: props[0].id! }));
  }, [props, f.propriedadeId]);

  const piquetes = useLiveQuery(async () => {
    if (!f.propriedadeId) return [];
    const mods = await db.modulos.where('propriedadeId').equals(f.propriedadeId).toArray();
    const out: { id: number; nome: string }[] = [];
    for (const m of mods) {
      const ps = await db.piquetes.where('moduloId').equals(m.id!).toArray();
      ps.forEach((p) => out.push({ id: p.id!, nome: `${m.nome} › ${p.nome}` }));
    }
    return out;
  }, [f.propriedadeId]);

  const trocarFase = (fase: Fase) => setF((x) => ({ ...x, fase, gmdMeta: String(GMD_SUGERIDO[fase]).replace('.', ','), pesoAlvo: String(PESO_ALVO_SUGERIDO[fase]) }));

  if (props && props.length === 0) {
    return (
      <>
        <Topo titulo="Novo lote" voltar />
        <main>
          <p>Antes de criar um lote, cadastre a sua fazenda.</p>
          <button className="btn largo" onClick={() => nav('/fazenda')}>Cadastrar fazenda</button>
        </main>
      </>
    );
  }

  const salvar = async () => {
    const qtd = num(f.qtd) ?? 0;
    if (!f.nome.trim()) return aviso('Dê um nome para o lote. Ex.: "Lote 1 - Machos".', true);
    if (f.controle === 'lote' && !(qtd > 0)) return aviso('Informe quantas cabeças tem o lote.', true);
    if (!f.propriedadeId) return aviso('Escolha a fazenda.', true);
    const dados = {
      nome: f.nome.trim(), propriedadeId: f.propriedadeId, piqueteId: f.piqueteId || null, fase: f.fase, sexo: f.sexo, controle: f.controle,
      qtdCabecas: Math.round(qtd), dataEntrada: f.data, pesoAlvo: num(f.pesoAlvo), gmdMeta: num(f.gmdMeta), obs: f.obs.trim() || undefined,
      formulaId: f.formulaId || null, consumoPctPV: num(f.consumo) ? num(f.consumo)! / 100 : null,
    };
    try {
    if (editando) {
      await db.lotes.update(Number(id), dados);
      aviso('Lote atualizado.');
      nav(`/lotes/${id}`, { replace: true });
    } else {
      const peso = f.controle === 'lote' ? num(f.pesoEntrada) : null;
      const novo = await criarLote(dados, peso);
      aviso('Lote salvo no celular.');
      nav(f.controle === 'individual' ? `/pesar/${novo}` : `/lotes/${novo}`, { replace: true });
    }
    } catch (e) { aviso((e as Error).message, true); }
  };

  return (
    <>
      <Topo titulo={editando ? 'Editar lote' : 'Novo lote'} voltar />
      <main>
        <CampoTexto rotulo="Nome do lote" valor={f.nome} aoMudar={set('nome')} nome="nome" dica='Ex.: "Macho 1º lote" ou "Novilhas TIP"' />

        {props && props.length > 1 && (
          <CampoEscolha rotulo="Fazenda" nome="fazenda" valor={f.propriedadeId} aoMudar={(v) => setF((x) => ({ ...x, propriedadeId: Number(v), piqueteId: 0 }))}>
            {props.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </CampoEscolha>
        )}

        <div className="campo"><span style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>Fase</span>
          <Opcoes valor={f.fase} aoMudar={trocarFase} opcoes={(Object.keys(FASES) as Fase[]).map((k) => ({ valor: k, rotulo: FASES[k].split(' (')[0] }))} />
        </div>

        <div className="campo"><span style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>Sexo</span>
          <Opcoes tres valor={f.sexo} aoMudar={set('sexo')} opcoes={[{ valor: 'macho', rotulo: 'Macho' }, { valor: 'femea', rotulo: 'Fêmea' }, { valor: 'misto', rotulo: 'Misto' }]} />
        </div>

        <div className="campo"><span style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>Como você quer controlar?</span>
          <Opcoes valor={f.controle} aoMudar={set('controle')} opcoes={[
            { valor: 'lote', rotulo: 'Pelo lote', dica: 'peso médio do grupo' },
            { valor: 'individual', rotulo: 'Por cabeça', dica: 'peso de cada brinco' },
          ]} />
        </div>

        {f.controle === 'lote' && <CampoNumero rotulo="Quantidade de cabeças" valor={f.qtd} aoMudar={set('qtd')} unidade="cab" nome="qtd" />}

        <CampoData rotulo="Data de entrada" valor={f.data} aoMudar={set('data')} nome="dataEntrada" />

        {!editando && f.controle === 'lote' && (
          <CampoNumero rotulo="Peso médio na entrada" valor={f.pesoEntrada} aoMudar={set('pesoEntrada')} unidade="kg" nome="pesoEntrada" dica="Vira a primeira pesagem do lote. Pode deixar em branco e pesar depois." />
        )}
        {!editando && f.controle === 'individual' && (
          <div className="dica">Depois de salvar, o app abre a pesagem para você lançar o brinco e o peso de cada animal.</div>
        )}

        <CampoNumero rotulo="Peso alvo (saída)" valor={f.pesoAlvo} aoMudar={set('pesoAlvo')} unidade="kg" nome="pesoAlvo" dica="Peso que você quer atingir para vender ou mudar de fase." />
        <CampoNumero rotulo="GMD esperado" valor={f.gmdMeta} aoMudar={set('gmdMeta')} unidade="kg/dia" nome="gmdMeta" dica="Sugestão pela fase. O app avisa quando o lote ficar 10% abaixo." />

        {piquetes && piquetes.length > 0 && (
          <CampoEscolha rotulo="Piquete (opcional)" nome="piquete" valor={f.piqueteId} aoMudar={(v) => set('piqueteId')(Number(v))}>
            <option value={0}>Nenhum</option>
            {piquetes.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </CampoEscolha>
        )}

        <CampoEscolha rotulo="Dieta / suplemento" nome="formula" valor={f.formulaId} aoMudar={(v) => set('formulaId')(Number(v))}
          dica={formulas?.length === 0 ? 'Crie fórmulas em Mais › Nutrição.' : 'Usada no trato do dia e no custo do lote.'}>
          <option value={0}>Nenhuma (só pasto e sal)</option>
          {formulas?.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
        </CampoEscolha>
        {f.formulaId ? (
          <CampoNumero rotulo="Consumo do lote" valor={f.consumo} aoMudar={set('consumo')} unidade="% PV" nome="consumoLote"
            dica={`Deixe em branco para usar o da fórmula (${String(+((formulas?.find((x) => x.id === f.formulaId)?.consumoPctPV ?? 0) * 100).toFixed(3)).replace('.', ',')}% PV). ${TIPOS[formulas?.find((x) => x.id === f.formulaId)?.tipo ?? 'outro'].descricao}`} />
        ) : null}

        <CampoTexto rotulo="Observações" valor={f.obs} aoMudar={set('obs')} nome="loteObs" multilinha />

        <button className="btn largo" onClick={salvar}>Salvar lote</button>
      </main>
    </>
  );
}
