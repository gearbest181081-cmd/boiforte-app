// Dados de exemplo baseados na planilha de recria/TIP. Os pesos são ilustrativos.
import { criarLote, db, registrarPesagemIndividual } from './db';

export async function carregarExemplo() {
  const pid = await db.propriedades.add({ nome: 'Fazenda Exemplo', municipio: 'Exemplo', uf: 'TO', areaHa: 120, criadoEm: Date.now() });
  const mod = await db.modulos.add({ propriedadeId: pid, nome: 'Retiro 1', criadoEm: Date.now() });
  const pq1 = await db.piquetes.add({ moduloId: mod, nome: 'Piquete 1', areaHa: 15, capim: 'Mombaça', criadoEm: Date.now() });
  const pq2 = await db.piquetes.add({ moduloId: mod, nome: 'Piquete 2', areaHa: 20, capim: 'Brizantha', criadoEm: Date.now() });

  const machos = await criarLote({ propriedadeId: pid, piqueteId: pq1, nome: 'Macho — 1º lote', fase: 'recria', sexo: 'macho', controle: 'lote', qtdCabecas: 30, dataEntrada: '2026-09-28', pesoAlvo: 360, gmdMeta: 0.75, obs: 'Exemplo. Compra a R$ 3.260/cab, proteinado 0,1% e depois proteico energético.' }, 200);
  await db.pesagens.bulkAdd([
    { loteId: machos, data: '2026-10-28', tipo: 'media', pesoMedio: 222.5, qtdPesada: 30, criadoEm: Date.now() },
    { loteId: machos, data: '2026-11-17', tipo: 'media', pesoMedio: 235.8, qtdPesada: 30, criadoEm: Date.now() },
  ]);

  const femeas = await criarLote({ propriedadeId: pid, piqueteId: pq2, nome: 'Fêmea — 4º lote', fase: 'recria', sexo: 'femea', controle: 'individual', qtdCabecas: 0, dataEntrada: '2026-09-30', pesoAlvo: 330, gmdMeta: 0.6, obs: 'Exemplo. Compra a R$ 2.610/cab, RIP com milho, soja e núcleo.' });
  const base = [182, 175, 190, 168, 186, 179, 195, 171];
  await registrarPesagemIndividual(femeas, '2026-09-30', base.map((p, i) => ({ brinco: String(101 + i), peso: p })), 'Entrada');
  await registrarPesagemIndividual(femeas, '2026-10-30', base.map((p, i) => ({ brinco: String(101 + i), peso: p + [19, 16, 21, 9, 18, 17, 20, 12][i] })));
  await registrarPesagemIndividual(femeas, '2026-11-18', base.map((p, i) => ({ brinco: String(101 + i), peso: p + [31, 27, 34, 14, 30, 28, 33, 20][i] })));
  return pid;
}
