// Dados de exemplo baseados na planilha de recria/TIP. Os pesos são ilustrativos.
import { comprarInsumo, criarLote, db, garantirLembretesPadrao, registrarCompraLote, salvarEventoSanitario, garantirIngredientesPadrao, registrarBatida, registrarFornecimento, registrarPesagemIndividual } from './db';
import { hojeISO, pesoEstimado, somaDias } from './calc';
import { pontosDoLote } from './db';
import { entrarNoPiquete } from './pasto';

export async function carregarExemplo() {
  const pid = await db.propriedades.add({ nome: 'Fazenda Exemplo', municipio: 'Exemplo', uf: 'TO', areaHa: 120, criadoEm: Date.now() });
  const mod = await db.modulos.add({ propriedadeId: pid, nome: 'Retiro 1', areaHa: 50, sistema: 'rotacionado', diasOcupacao: 5, diasDescanso: 30, capacidadeUA: 3, criadoEm: Date.now() });
  const pq1 = await db.piquetes.add({ moduloId: mod, nome: 'Piquete 1', areaHa: 15, capim: 'Mombaça', criadoEm: Date.now() });
  const pq2 = await db.piquetes.add({ moduloId: mod, nome: 'Piquete 2', areaHa: 20, capim: 'Brizantha', criadoEm: Date.now() });
  const pq3 = await db.piquetes.add({ moduloId: mod, nome: 'Piquete 3', areaHa: 15, capim: 'Mombaça', criadoEm: Date.now() });

  const machos = await criarLote({ propriedadeId: pid, nome: 'Macho — 1º lote', fase: 'recria', sexo: 'macho', controle: 'lote', qtdCabecas: 30, dataEntrada: '2026-09-28', pesoAlvo: 360, gmdMeta: 0.75, obs: 'Exemplo. Compra a R$ 3.260/cab, proteinado 0,1% e depois proteico energético.' }, 200);
  await db.pesagens.bulkAdd([
    { loteId: machos, data: '2026-10-28', tipo: 'media', pesoMedio: 222.5, qtdPesada: 30, criadoEm: Date.now() },
    { loteId: machos, data: '2026-11-17', tipo: 'media', pesoMedio: 235.8, qtdPesada: 30, criadoEm: Date.now() },
  ]);

  const femeas = await criarLote({ propriedadeId: pid, nome: 'Fêmea — 4º lote', fase: 'recria', sexo: 'femea', controle: 'individual', qtdCabecas: 0, dataEntrada: '2026-09-30', pesoAlvo: 330, gmdMeta: 0.6, obs: 'Exemplo. Compra a R$ 2.610/cab, RIP com milho, soja e núcleo.' });
  const base = [182, 175, 190, 168, 186, 179, 195, 171];
  await registrarPesagemIndividual(femeas, '2026-09-30', base.map((p, i) => ({ brinco: String(101 + i), peso: p })), 'Entrada');
  await registrarPesagemIndividual(femeas, '2026-10-30', base.map((p, i) => ({ brinco: String(101 + i), peso: p + [19, 16, 21, 9, 18, 17, 20, 12][i] })));
  await registrarPesagemIndividual(femeas, '2026-11-18', base.map((p, i) => ({ brinco: String(101 + i), peso: p + [31, 27, 34, 14, 30, 28, 33, 20][i] })));

  // Pasto: os machos passaram pelo piquete 3 e estão no 1; as fêmeas, no 2.
  await entrarNoPiquete({ tipo: 'lote', ocupanteId: machos, piqueteId: pq3, data: somaDias(hojeISO(), -8), cabecas: 30, pesoMedio: 215, altura: 85 });
  await entrarNoPiquete({ tipo: 'lote', ocupanteId: machos, piqueteId: pq1, data: somaDias(hojeISO(), -3), cabecas: 30, pesoMedio: 238, altura: 92 });
  await entrarNoPiquete({ tipo: 'lote', ocupanteId: femeas, piqueteId: pq2, data: somaDias(hojeISO(), -4), cabecas: 8, pesoMedio: 205, altura: 28 });

  // Nutrição: fórmulas da planilha, compras, batida e o trato de ontem
  await garantirIngredientesPadrao();
  const ings = await db.ingredientes.toArray();
  const ing = (p: string) => ings.find((i) => i.nome.startsWith(p))!.id!;
  const hoje = hojeISO();
  const rip = await db.formulas.add({ nome: 'RIP fêmeas (planilha)', tipo: 'rip', unidade: 'kg', modo: 'batida', consumoPctPV: 0.007,
    itens: [{ ingredienteId: ing('Milho'), qtd: 575 }, { ingredienteId: ing('Farelo de soja'), qtd: 275 }, { ingredienteId: ing('Núcleo TIP'), qtd: 150 }], criadoEm: Date.now() });
  const pe = await db.formulas.add({ nome: 'Proteico energético machos', tipo: 'proteico_energetico', unidade: 'pct', modo: 'direto', consumoPctPV: 0.003,
    itens: [{ ingredienteId: ing('Milho'), qtd: 58 }, { ingredienteId: ing('Farelo de soja'), qtd: 25 }, { ingredienteId: ing('Ureia'), qtd: 3 }, { ingredienteId: ing('Sal mineral'), qtd: 14 }], criadoEm: Date.now() });
  await db.lotes.update(femeas, { formulaId: rip });
  await db.lotes.update(machos, { formulaId: pe });
  const d = somaDias(hoje, -6);
  await comprarInsumo(ing('Milho'), d, 1500, 1800);
  await comprarInsumo(ing('Farelo de soja'), d, 600, 1602);
  await comprarInsumo(ing('Núcleo TIP'), d, 150, 450);
  await comprarInsumo(ing('Sal mineral'), d, 120, 384);
  await comprarInsumo(ing('Ureia'), d, 25, 112.5);
  await registrarBatida(rip, somaDias(hoje, -5), 950);
  for (const [loteId, n] of [[machos, 30], [femeas, 8]] as const) {
    const pes = await db.pesagens.where('loteId').equals(loteId).toArray();
    for (let k = 5; k >= 1; k--) {
      const dia = somaDias(hoje, -k);
      const peso = pesoEstimado(pontosDoLote(pes), dia) ?? 0;
      const lote = (await db.lotes.get(loteId))!;
      const consumo = loteId === machos ? 0.003 : 0.007;
      const kg = Math.round(peso * consumo * n * 10) / 10;
      if (lote.dataEntrada <= dia) await registrarFornecimento({ loteId, data: dia, kgFornecido: kg, kgPrevisto: kg, cabecas: n, pesoRef: Math.round(peso * 10) / 10 });
    }
  }

  // Financeiro: compra dos lotes (planilha), custos fixos, o vaqueiro e uma despesa rateada
  await registrarCompraLote(machos, { data: '2026-09-28', precoCab: 3260, comissaoPct: 0.02, frete: 1200, nfGta: 210 });
  await registrarCompraLote(femeas, { data: '2026-09-30', precoCab: 2610, comissaoPct: 0.02, frete: 450, nfGta: 90 });
  await db.custosFixos.add({ nome: 'Arrendamento do pasto', valorMensal: 1500, desde: '2026-09-01', criadoEm: Date.now() });
  await db.funcionarios.add({ nome: 'João', funcao: 'Vaqueiro', salario: 2400, encargos: 800, admissao: '2026-09-01', criadoEm: Date.now() });
  await db.lancamentos.add({ data: '2026-10-15', tipo: 'despesa', categoria: 'manutencao', descricao: 'Conserto da cerca', valor: 640, loteId: null, origem: 'manual', criadoEm: Date.now() });

  // Sanidade: vermífugo na entrada, reforço agendado e um carrapaticida com carência
  await salvarEventoSanitario({ loteId: machos, data: '2026-09-28', feito: true, tipo: 'vermifugo', produto: 'Ivermectina 1%', dose: '1 ml / 50 kg', qtdAnimais: 30, custo: 186, carenciaDias: 35 });
  await salvarEventoSanitario({ loteId: machos, data: somaDias(hoje, 5), feito: false, tipo: 'vacina', produto: 'Clostridiose (reforço)', qtdAnimais: 30, custo: 96 });
  await salvarEventoSanitario({ loteId: femeas, data: somaDias(hoje, -3), feito: true, tipo: 'carrapaticida', produto: 'Fluazuron pour-on', qtdAnimais: 8, custo: 72, carenciaDias: 42 });
  await garantirLembretesPadrao();
  return pid;
}
