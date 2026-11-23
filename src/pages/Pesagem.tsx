import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, pontosDoLote, registrarPesagemIndividual, type Animal, type Pesagem as PesagemT } from '../db';
import { fmtGmd, fmtKg, gmd, hojeISO, media, resumo } from '../calc';
import { lerPesagemFalada, melhorNumero } from '../voz';
import { BotaoMic, CampoData, CampoEscolha, CampoNumero, CampoTexto, num, Opcoes, Topo, useAviso } from '../components/ui';
import { BotaoBalanca } from '../components/Balanca';
import { BotaoFoto } from '../components/Foto';
import type { LeituraBalanca } from '../../supabase/functions/_shared/foto';

type Linha = { brinco: string; peso: string };

export function Pesagem() {
  const { loteId } = useParams();
  const nav = useNavigate();
  const aviso = useAviso();
  const lotes = useLiveQuery(() => db.lotes.filter((l) => !l.encerrado).toArray());
  const [sel, setSel] = useState<number>(loteId ? Number(loteId) : 0);
  const lote = lotes?.find((l) => l.id === sel);
  const pesagens = useLiveQuery(() => (sel ? db.pesagens.where('loteId').equals(sel).toArray() : Promise.resolve([] as PesagemT[])), [sel]);
  const animais = useLiveQuery(() => (sel ? db.animais.where('loteId').equals(sel).toArray() : Promise.resolve([] as Animal[])), [sel]);

  const [data, setData] = useState(hojeISO());
  const [modo, setModo] = useState<'media' | 'um_a_um'>('media');
  const [pesoMedio, setPesoMedio] = useState('');
  const [qtd, setQtd] = useState('');
  const [linhas, setLinhas] = useState<Linha[]>([{ brinco: '', peso: '' }]);
  const [obs, setObs] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { if (loteId) setSel(Number(loteId)); }, [loteId]);
  useEffect(() => {
    if (!lote) return;
    setModo(lote.controle === 'individual' ? 'um_a_um' : 'media');
    setQtd(String(lote.qtdCabecas || ''));
  }, [lote?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lote por cabeça: já traz os brincos cadastrados para só preencher o peso.
  useEffect(() => {
    if (lote?.controle === 'individual' && animais && animais.length) {
      setLinhas(animais.filter((a) => a.ativo).sort((a, b) => a.brinco.localeCompare(b.brinco, 'pt-BR', { numeric: true })).map((a) => ({ brinco: a.brinco, peso: '' })));
    } else if (lote) {
      setLinhas([{ brinco: '', peso: '' }]);
    }
  }, [lote?.id, animais?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const anterior = useMemo(() => (pesagens ? resumo(pontosDoLote(pesagens)) : null), [pesagens]);
  const pesosValidos = linhas.map((l) => num(l.peso)).filter((x): x is number => x != null && x > 0);
  const mediaAtual = modo === 'media' ? num(pesoMedio) : media(pesosValidos);
  const gmdPrevia = anterior?.pesoAtual != null && anterior.dataUltima && mediaAtual
    ? gmd({ data: anterior.dataUltima, peso: anterior.pesoAtual }, { data, peso: mediaAtual }) : null;

  const individual = lote?.controle === 'individual';

  const setLinha = (i: number, k: keyof Linha, v: string) => setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const novaLinha = () => setLinhas((ls) => [...ls, { brinco: individual ? '' : String(ls.length + 1), peso: '' }]);

  /** Põe um peso na lista: no brinco dito, ou na primeira linha sem peso. */
  const colocarPeso = (brinco: string | null, kg: number) => {
    const peso = String(kg).replace('.', ',');
    setLinhas((ls) => {
      const i = brinco ? ls.findIndex((l) => l.brinco.trim().toUpperCase() === brinco.toUpperCase()) : -1;
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, peso } : l));
      const vazia = ls.findIndex((l) => (brinco ? !l.brinco && !l.peso : !l.peso));
      if (vazia >= 0) return ls.map((l, j) => (j === vazia ? { brinco: brinco ?? l.brinco, peso } : l));
      return [...ls, { brinco: brinco ?? (individual ? '' : String(ls.length + 1)), peso }];
    });
    aviso(brinco ? `Brinco ${brinco}: ${fmtKg(kg)}` : `Peso lido: ${fmtKg(kg)}`);
  };
  const ouviuPesagem = (texto: string) => {
    for (const t of texto.split('|')) {
      const r = lerPesagemFalada(t);
      if (r) { colocarPeso(r.brinco, r.peso); return; }
    }
    // Só o peso ("trezentos e dezoito"): vai para a primeira linha sem peso.
    const kg = melhorNumero(texto);
    if (kg != null && kg > 0) { colocarPeso(null, kg); return; }
    aviso(`Não entendi. Fale assim: "brinco 12 peso 318".`, true);
  };

  const salvar = async () => {
    if (!lote) return aviso('Escolha o lote.', true);
    if (lote.dataEntrada && data < lote.dataEntrada) return aviso('A data da pesagem é antes da entrada do lote.', true);
    setSalvando(true);
    try {
      if (individual) {
        const itens = linhas.map((l) => ({ brinco: l.brinco, peso: num(l.peso) ?? 0 }));
        if (itens.some((i) => i.peso > 0 && !i.brinco.trim())) { aviso('Tem peso sem brinco. Preencha o brinco.', true); return; }
        await registrarPesagemIndividual(lote.id!, data, itens, obs.trim() || undefined);
      } else if (modo === 'media') {
        const p = num(pesoMedio);
        const q = num(qtd);
        if (!p || p <= 0) { aviso('Informe o peso médio.', true); return; }
        if (p > 1500) { aviso('Peso muito alto. Confira o valor (em kg por cabeça).', true); return; }
        await db.pesagens.add({ loteId: lote.id!, data, tipo: 'media', pesoMedio: p, qtdPesada: Math.round(q || lote.qtdCabecas), obs: obs.trim() || undefined, criadoEm: Date.now() });
      } else {
        if (!pesosValidos.length) { aviso('Lance ao menos um peso.', true); return; }
        await db.pesagens.add({ loteId: lote.id!, data, tipo: 'media', pesoMedio: media(pesosValidos)!, qtdPesada: pesosValidos.length, obs: (obs.trim() ? obs.trim() + ' · ' : '') + `média de ${pesosValidos.length} animais`, criadoEm: Date.now() });
      }
      aviso('Pesagem salva no celular.');
      nav(`/lotes/${lote.id}`, { replace: true });
    } catch (e) {
      aviso((e as Error).message, true);
    } finally {
      setSalvando(false);
    }
  };

  if (lotes && lotes.length === 0) {
    return (<><Topo titulo="Pesar" /><main><p>Nenhum lote ativo. Crie um lote primeiro.</p><button className="btn largo" onClick={() => nav('/lotes/novo')}>Novo lote</button></main></>);
  }

  return (
    <>
      <Topo titulo="Pesagem" />
      <main>
        <CampoEscolha rotulo="Lote" nome="lote" valor={sel} aoMudar={(v) => setSel(Number(v))}>
          <option value={0}>Escolha o lote…</option>
          {lotes?.map((l) => <option key={l.id} value={l.id}>{l.nome} ({l.qtdCabecas} cab)</option>)}
        </CampoEscolha>

        {lote && (
          <>
            {anterior?.pesoAtual != null && (
              <div className="dica">Última pesagem: <b>{fmtKg(anterior.pesoAtual)}</b> em {anterior.dataUltima!.split('-').reverse().join('/')}</div>
            )}
            <CampoData rotulo="Data da pesagem" valor={data} aoMudar={setData} nome="pesagemData" />

            {!individual && (
              <div className="campo">
                <Opcoes valor={modo} aoMudar={setModo} opcoes={[
                  { valor: 'media', rotulo: 'Peso médio', dica: 'já tenho a média' },
                  { valor: 'um_a_um', rotulo: 'Um a um', dica: 'o app tira a média' },
                ]} />
              </div>
            )}

            {modo === 'media' && !individual ? (
              <>
                <CampoNumero rotulo="Peso médio por cabeça" valor={pesoMedio} aoMudar={setPesoMedio} unidade="kg" nome="pesoMedio" />
                <CampoNumero rotulo="Cabeças pesadas" valor={qtd} aoMudar={setQtd} unidade="cab" nome="qtdPesada" />
              </>
            ) : (
              <div className="cartao">
                <div className="linha-lote" style={{ marginBottom: 10 }}>
                  <b>{individual ? 'Brinco e peso' : 'Pesos (kg)'}</b>
                  <span className="mudo">{pesosValidos.length} pesados</span>
                </div>
                <BotaoMic tipo="pesagem" rotulo="Falar brinco e peso" grande={individual ? 'Falar brinco e peso' : 'Falar o peso'} aoOuvir={ouviuPesagem} />
                <p className="mudo" style={{ fontSize: 14, margin: '6px 0 12px' }}>{individual ? 'Fale “brinco 12 peso 318”.' : 'Fale “trezentos e dezoito” ou “brinco 12 peso 318”.'} O peso vai para a primeira linha vazia.</p>
                <div className="lista-pesos">
                  <div className="item mudo" style={{ fontSize: 14 }}><span>{individual ? 'Brinco' : 'Nº'}</span><span>Peso (kg)</span><span /></div>
                  {linhas.map((l, i) => (
                    <div className="item" key={i}>
                      <input aria-label={`Brinco ${i + 1}`} value={l.brinco} onChange={(e) => setLinha(i, 'brinco', e.target.value)} placeholder={individual ? 'brinco' : String(i + 1)} />
                      <input aria-label={`Peso ${i + 1}`} inputMode="decimal" value={l.peso} onChange={(e) => setLinha(i, 'peso', e.target.value.replace(/[^\d.,]/g, ''))}
                        onKeyDown={(e) => { if (e.key === 'Enter' && i === linhas.length - 1) novaLinha(); }} placeholder="kg" />
                      <button className="remover" aria-label="Remover" onClick={() => setLinhas((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [{ brinco: '', peso: '' }]))}>×</button>
                    </div>
                  ))}
                </div>
                <div className="botoes" style={{ marginBottom: 0 }}>
                  <button className="btn sec pequeno" onClick={novaLinha}>+ Animal</button>
                </div>
                <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                  <BotaoBalanca aoPesar={(kg) => colocarPeso(null, kg)} aoErro={(m) => aviso(m, true)} />
                  <BotaoFoto<LeituraBalanca> tipo="balanca" rotulo="Ler o visor da balança pela foto" aoErro={(m) => aviso(m, true)}
                    aoLer={(r) => (r.legivel && r.peso ? colocarPeso(r.brinco, r.peso) : aviso('Não deu para ler o peso. Tente de novo.', true))} />
                </div>
              </div>
            )}

            <CampoTexto rotulo="Observação (opcional)" valor={obs} aoMudar={setObs} nome="pesagemObs" placeholder="Ex.: chuva, troca de pasto" />

            {mediaAtual ? (
              <div className="cartao">
                <div className="grade">
                  <div><div className="mudo">Peso médio</div><b style={{ fontSize: 22 }}>{fmtKg(mediaAtual)}</b></div>
                  <div><div className="mudo">GMD desde a última</div><b style={{ fontSize: 22, color: gmdPrevia != null && gmdPrevia < 0 ? 'var(--alerta)' : undefined }}>{fmtGmd(gmdPrevia)}</b></div>
                </div>
              </div>
            ) : null}

            <button className="btn largo" onClick={salvar} disabled={salvando}>Salvar pesagem</button>
          </>
        )}
      </main>
    </>
  );
}
