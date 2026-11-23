// Teste de ponta a ponta: abre o app num celular simulado e faz o caminho do produtor.
// Uso: npm run build && node e2e/run.cjs
const { chromium, devices } = require('playwright');
const { spawn } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const path = require('node:path');

const PORTA = 4179;
const URL = `http://localhost:${PORTA}/`;
const FOTOS = path.join(__dirname, 'screens');
mkdirSync(FOTOS, { recursive: true });

let falhas = 0;
function confere(cond, msg) {
  if (cond) console.log('  ✓ ' + msg);
  else { console.log('  ✗ ' + msg); falhas++; }
}

(async () => {
  const srv = spawn(path.join(__dirname, '..', 'node_modules', '.bin', 'vite'), ['preview', '--port', String(PORTA), '--strictPort'], { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
  await new Promise((ok, falha) => {
    srv.stdout.on('data', (d) => d.toString().includes('Local') && ok());
    srv.on('exit', (c) => falha(new Error('servidor de teste não abriu (porta ocupada?) código ' + c)));
  }).catch((e) => { console.log('ERRO: ' + e.message); process.exit(1); });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], locale: 'pt-BR' });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('dialog', (d) => d.accept());
  const foto = (n) => page.screenshot({ path: path.join(FOTOS, n + '.png'), fullPage: true });
  // O teste não fala com o servidor de verdade: toda chamada à nuvem falha como se estivesse sem sinal.
  await ctx.route(/supabase\.co/, (r) => r.abort());
  // Sessão de mentira guardada no celular (como a biblioteca guarda depois da entrada pelo e-mail).
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const sessaoFalsa = (id, email) => {
    const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    return JSON.stringify({
      access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: id, email, role: 'authenticated', exp })}.x`,
      token_type: 'bearer', expires_in: 30 * 24 * 3600, expires_at: exp, refresh_token: 'teste-' + id,
      user: { id, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: '2026-11-23T00:00:00Z' },
    });
  };
  const entrarComo = (id, email) => page.evaluate((v) => localStorage.setItem('boiforte-sessao', v), sessaoFalsa(id, email));

  try {
    console.log('0. Tela de entrada');
    await page.goto(URL);
    const nuvemNoBuild = await page.getByRole('button', { name: 'Mandar e-mail de entrada' }).waitFor({ timeout: 4000 }).then(() => true, () => false);
    if (nuvemNoBuild) {
      confere(!(await page.locator('nav.baixo').count()), 'sem entrar, o app não mostra o menu nem os dados');
      await page.locator('input[name=email]').fill('produtor@exemplo.com');
      await page.getByRole('button', { name: 'Mandar e-mail de entrada' }).click();
      await page.getByText('Sem internet agora').waitFor();
      confere(true, 'sem sinal, a entrada avisa em português simples');
      await foto('00-entrada');
      await entrarComo('11111111-1111-4111-8111-111111111111', 'produtor@exemplo.com');
      await page.reload();
    } else console.log('  (build sem nuvem: o app abre direto)');

    console.log('1. Primeira abertura');
    await page.getByText('Bem-vindo ao BoiForte').waitFor();
    confere(true, 'tela de boas-vindas aparece');
    await foto('01-boas-vindas');

    console.log('2. Cadastrar fazenda, módulo e piquete');
    await page.getByRole('link', { name: /cadastrar minha fazenda/i }).click();
    await page.locator('input[name=fazendaNome]').fill('Fazenda Boa Vista');
    await page.getByRole('button', { name: 'Salvar fazenda' }).click();
    await page.getByRole('heading', { name: 'Fazenda Boa Vista' }).waitFor();
    await page.getByLabel('Nome do novo módulo', { exact: true }).fill('Retiro de cima');
    await page.getByRole('button', { name: '+ Módulo' }).click();
    await page.getByRole('button', { name: '+ Piquete' }).click();
    await page.getByLabel('Nome do piquete', { exact: true }).fill('Piquete 3');
    await page.getByLabel('Área', { exact: true }).fill('12');
    await page.getByRole('button', { name: 'Salvar piquete' }).click();
    await page.getByText('Piquete 3').waitFor();
    confere(true, 'fazenda, módulo e piquete salvos');
    await foto('02-fazenda');

    console.log('3. Criar lote pelo peso médio');
    await page.goto(URL + '#/lotes/novo');
    await page.locator('input[name=nome]').fill('Lote 5');
    await page.getByRole('radio', { name: /TIP/ }).click();
    await page.locator('input[name=qtd]').fill('40');
    await page.locator('input[type=date]').fill('2026-09-01');
    await page.locator('input[name=pesoEntrada]').fill('300');
    await page.locator('input[name=pesoAlvo]').fill('450');
    await page.locator('input[name=gmdMeta]').fill('0,9');
    await page.locator('select[name=piquete]').selectOption({ label: 'Retiro de cima › Piquete 3' });
    await page.getByRole('button', { name: 'Salvar lote' }).click();
    await page.getByRole('heading', { name: 'Lote 5' }).waitFor();
    confere(await page.getByText('300 kg').first().isVisible(), 'pesagem de entrada registrada (300 kg)');

    console.log('4. Pesagem do lote (peso médio) e GMD');
    await page.getByRole('link', { name: 'Nova pesagem' }).click();
    await page.locator('input[type=date]').fill('2026-10-01');
    await page.locator('input[name=pesoMedio]').fill('324');
    const previa = await page.getByText('0,800 kg/dia').isVisible();
    confere(previa, 'prévia do GMD = 0,800 kg/dia antes de salvar');
    await page.getByRole('button', { name: 'Salvar pesagem' }).click();
    await page.getByRole('heading', { name: 'Lote 5' }).waitFor();
    const txt = await page.locator('main').innerText();
    confere(txt.includes('0,800 kg/dia'), 'GMD do período aparece no resumo');
    confere(/11% abaixo do GMD projetado/.test(txt), 'alerta "11% abaixo do GMD projetado" aparece');
    // (450-324)/0,8 = 157,5 → 158 dias depois de 01/10/2026 = 08/03/2027
    confere(txt.includes('08/03/2027'), 'projeção de saída em 08/03/2027');
    confere(txt.includes('Retiro de cima › Piquete 3'), 'lote ligado ao piquete');
    confere(await page.locator('svg.grafico').isVisible(), 'curva de crescimento desenhada');
    await foto('03-lote-resumo');

    console.log('5. Pesagem um a um com média automática');
    await page.getByRole('link', { name: 'Nova pesagem' }).click();
    await page.locator('input[type=date]').fill('2026-10-31');
    await page.getByRole('radio', { name: /Um a um/ }).click();
    const pesos = ['350', '340', '352'];
    for (let i = 0; i < pesos.length; i++) {
      if (i > 0) await page.getByRole('button', { name: '+ Animal' }).click();
      await page.getByLabel(`Peso ${i + 1}`, { exact: true }).fill(pesos[i]);
    }
    confere(await page.getByText('347,3 kg').isVisible(), 'média de 3 animais = 347,3 kg');
    await page.getByRole('button', { name: 'Salvar pesagem' }).click();
    await page.getByRole('heading', { name: 'Lote 5' }).waitFor();
    await page.getByRole('radio', { name: /Pesagens/ }).click();
    confere((await page.locator('table.tab tbody tr').count()) === 3, 'histórico com 3 pesagens');
    await foto('04-lote-pesagens');

    console.log('6. Lote por cabeça (brinco)');
    await page.goto(URL + '#/lotes/novo');
    await page.locator('input[name=nome]').fill('Novilhas');
    await page.getByRole('radio', { name: 'Fêmea' }).click();
    await page.getByRole('radio', { name: /Por cabeça/ }).click();
    await page.locator('input[type=date]').fill('2026-10-01');
    await page.getByRole('button', { name: 'Salvar lote' }).click();
    await page.getByRole('heading', { name: 'Pesagem' }).waitFor();
    await page.locator('input[type=date]').fill('2026-10-01');
    const ent = [['A1', '200'], ['A2', '210']];
    for (let i = 0; i < ent.length; i++) {
      if (i > 0) await page.getByRole('button', { name: '+ Animal' }).click();
      await page.getByLabel(`Brinco ${i + 1}`, { exact: true }).fill(ent[i][0]);
      await page.getByLabel(`Peso ${i + 1}`, { exact: true }).fill(ent[i][1]);
    }
    await page.getByRole('button', { name: 'Salvar pesagem' }).click();
    await page.getByRole('heading', { name: 'Novilhas' }).waitFor();
    await page.getByRole('link', { name: 'Nova pesagem' }).click();
    await page.getByLabel('Peso 1', { exact: true }).waitFor();
    confere((await page.getByLabel('Brinco 1', { exact: true }).inputValue()) === 'A1', 'brincos já vêm preenchidos na segunda pesagem');
    await page.locator('input[type=date]').fill('2026-10-31');
    await page.getByLabel('Peso 1', { exact: true }).fill('221');
    await page.getByLabel('Peso 2', { exact: true }).fill('225');
    await page.getByRole('button', { name: 'Salvar pesagem' }).click();
    await page.getByRole('heading', { name: 'Novilhas' }).waitFor();
    await page.getByRole('radio', { name: /Animais/ }).click();
    const tab = await page.locator('table.tab').innerText();
    confere(tab.includes('A1') && tab.includes('0,700'), 'GMD individual do A1 = 0,700');
    confere(tab.includes('0,500'), 'GMD individual do A2 = 0,500');
    await foto('05-animais');

    console.log('7. Início com avisos');
    await page.goto(URL);
    await page.getByText('Lotes ativos').waitFor();
    const ini = await page.locator('main').innerText();
    confere(ini.includes('Fazenda Boa Vista') || (await page.locator('header').innerText()).includes('Fazenda Boa Vista'), 'nome da fazenda no topo');
    confere(/42/.test(ini), 'total de cabeças = 42');
    await foto('06-inicio');

    console.log('8. Sem internet');
    await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 10000 }).catch(() => {});
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 });
    await ctx.setOffline(true);
    await page.reload();
    await page.getByText('Lotes ativos').waitFor({ timeout: 8000 });
    confere(true, 'app abre sem internet');
    confere(await page.getByText('Sem internet').isVisible(), 'mostra o selo "Sem internet"');
    await page.goto(URL + '#/pesar');
    await page.locator('select[name=lote]').selectOption({ label: 'Lote 5 (40 cab)' });
    await page.locator('input[type=date]').fill(new Date().toISOString().slice(0, 10)); // hoje: o trato usa o peso estimado para hoje
    await page.locator('input[name=pesoMedio]').fill('366');
    await page.getByRole('button', { name: 'Salvar pesagem' }).click();
    await page.getByRole('heading', { name: 'Lote 5' }).waitFor();
    confere(true, 'pesagem salva sem internet');
    await foto('07-offline');
    await ctx.setOffline(false);
    await page.reload();
    await page.getByRole('radio', { name: /Pesagens/ }).click();
    confere((await page.locator('table.tab tbody tr').count()) === 4, 'pesagem feita offline continua lá depois');

    console.log('9. Cópia de segurança');
    await page.goto(URL + '#/mais');
    const [down] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Fazer cópia' }).click()]);
    const caminho = path.join(FOTOS, 'copia.json');
    await down.saveAs(caminho);
    const bk = JSON.parse(require('node:fs').readFileSync(caminho, 'utf8'));
    confere(bk.app === 'BoiForte' && bk.dados.lotes.length === 2, 'cópia baixada com os 2 lotes');
    await page.getByRole('button', { name: 'Apagar todos os dados' }).click();
    await page.getByText('Bem-vindo ao BoiForte').waitFor();
    await page.goto(URL + '#/mais');
    await page.locator('input[type=file]').setInputFiles(caminho);
    await page.getByText('Lotes ativos').waitFor();
    confere(true, 'cópia restaurada depois de apagar tudo');

    console.log('10. Formulação (Etapa 2)');
    await page.goto(URL + '#/nutricao/formula/nova');
    await page.locator('input[name=formulaNome]').fill('RIP teste');
    await page.locator('select[name=tipo]').selectOption('rip');
    const receita = [['Milho grão moído', '575'], ['Farelo de soja', '275'], ['Núcleo TIP (preencha pelo rótulo)', '150']];
    for (let i = 0; i < receita.length; i++) {
      if (i > 0) await page.getByRole('button', { name: '+ Ingrediente' }).click();
      await page.getByLabel(`Ingrediente ${i + 1}`, { exact: true }).selectOption({ label: receita[i][0] });
      await page.getByLabel(`Quantidade ${i + 1}`, { exact: true }).fill(receita[i][1]);
    }
    confere((await page.getByTestId('custoKg').innerText()).includes('1,874'), 'custo da RIP = R$ 1,874/kg (igual à planilha)');
    confere(await page.getByText('Fórmula dentro das faixas de referência.').isVisible(), 'RIP dentro das faixas');
    confere((await page.getByTestId('nut-pb').innerText()).includes('Faixa: 16 a 24%'), 'faixa adequada da PB para RIP embaixo do resultado');
    const cu = await page.getByTestId('nut-cobre').innerText();
    confere(cu.includes('Faixa:') && cu.includes('Incompleto'), 'cobre aparece com faixa e avisa que o núcleo não informou');
    confere((await page.getByTestId('nut-fb').innerText()).includes('até 10%'), 'fibra bruta com faixa da RIP');
    await page.locator('select[name=tipo]').selectOption('tip');
    confere((await page.getByTestId('nut-pb').innerText()).includes('Faixa: 13 a 18%'), 'faixa muda quando o tipo vira TIP');
    await page.locator('select[name=tipo]').selectOption('rip');
    await foto('10-formula');
    await page.getByRole('button', { name: 'Salvar fórmula' }).click();
    await page.getByRole('link', { name: /RIP teste/ }).waitFor();

    await page.goto(URL + '#/nutricao/formula/nova');
    await page.locator('input[name=formulaNome]').fill('Só milho');
    await page.locator('select[name=tipo]').selectOption('tip');
    await page.getByLabel('Ingrediente 1', { exact: true }).selectOption({ label: 'Milho grão moído' });
    await page.getByLabel('Quantidade 1', { exact: true }).fill('100');
    const txtF = await page.locator('main').innerText();
    confere(txtF.includes('cálculo urinário'), 'só milho avisa risco de cálculo urinário');
    confere(txtF.includes('PB (proteína) muito baixo'), 'só milho avisa proteína baixa');

    console.log('11. Dieta no lote, estoque e trato');
    await page.goto(URL + '#/lotes');
    await page.getByRole('link', { name: /Lote 5/ }).click();
    await page.getByRole('link', { name: 'Editar lote' }).click();
    await page.locator('select[name=formula]').selectOption({ label: 'RIP teste' });
    await page.getByRole('button', { name: 'Salvar lote' }).click();
    await page.getByRole('heading', { name: 'Lote 5' }).waitFor();
    confere((await page.locator('main').innerText()).includes('RIP teste'), 'dieta aparece no lote');

    await page.goto(URL + '#/estoque');
    await page.getByRole('button', { name: 'Entrada (compra)' }).click();
    await page.locator('select[name=insumo]').selectOption({ label: 'Milho grão moído' });
    await page.locator('input[name=compraKg]').fill('1000');
    await page.locator('input[name=compraValor]').fill('1200');
    await page.getByRole('button', { name: 'Lançar compra' }).click();
    await page.getByRole('heading', { name: 'Milho grão moído' }).waitFor();
    await page.getByRole('button', { name: 'Bater ração' }).click();
    await page.locator('select[name=mistura]').selectOption({ label: 'RIP teste' });
    await page.locator('input[name=batidaKg]').fill('500');
    await page.getByRole('button', { name: 'Lançar batida' }).click();
    await page.getByRole('heading', { name: 'RIP teste' }).waitFor();
    await page.waitForFunction(() => /RIP teste[\s\S]*?500 kg/.test(document.querySelector('main').innerText), null, { timeout: 5000 }).catch(() => {});
    const est = await page.locator('main').innerText();
    confere(/RIP teste[\s\S]*?500 kg/.test(est), 'mistura batida entrou no estoque (500 kg)');
    confere(/Milho grão moído[\s\S]*?713 kg/.test(est), 'milho baixou 287,5 kg na batida (sobrou 713 kg)');

    await page.goto(URL + '#/trato');
    await page.getByRole('heading', { name: 'Lote 5' }).waitFor();
    const kgTrato = await page.getByLabel('kg para Lote 5', { exact: true }).inputValue();
    confere(kgTrato === '102,5', `trato ajustado pelo peso: 366 kg × 0,7% × 40 cab = 102,5 kg (deu ${kgTrato})`);
    await page.getByRole('checkbox', { name: 'Trato Lote 5' }).click();
    await page.getByText('Fornecido: 102,5 kg').waitFor();
    confere(true, 'checkbox do vaqueiro marca o trato');
    await foto('11-trato');
    await page.goto(URL + '#/estoque');
    await page.getByRole('heading', { name: 'RIP teste' }).waitFor();
    confere(/RIP teste[\s\S]*?398 kg/.test(await page.locator('main').innerText()), 'mistura baixou depois do trato (398 kg)');
    await foto('12-estoque');
    await page.goto(URL + '#/lotes');
    await page.getByRole('link', { name: /Lote 5/ }).click();
    await page.getByText('Gasto com trato').waitFor();
    const nutri = await page.locator('main').innerText();
    confere(/R\$\s192,/.test(nutri), 'custo do trato aparece no lote (R$ 192,…)');
    await foto('13-lote-nutricao');

    console.log('12. Dinheiro do lote: compra e venda (Etapa 3)');
    await page.getByRole('radio', { name: 'Dinheiro' }).click();
    await page.getByText('Falta lançar a compra do lote').waitFor();
    await page.getByRole('button', { name: 'Lançar compra' }).click();
    await page.locator('input[name=compraPreco]').fill('3000');
    await page.locator('input[name=compraFrete]').fill('1000');
    await page.getByRole('button', { name: 'Salvar compra' }).click();
    await page.getByText('Falta lançar a compra do lote').waitFor({ state: 'detached' });
    // 40 × 3.000 × 1,02 + 1.000 = 123.400
    confere(/Compra de animais[\s\S]*?R\$\s123\.400,00/.test(await page.locator('main').innerText()), 'compra do lote = R$ 123.400,00 (comissão e frete)');
    await page.getByRole('button', { name: 'Venda / baixa' }).click();
    await page.locator('input[name=saidaCab]').fill('10');
    await page.locator('input[name=saidaPeso]').fill('366');
    await page.locator('input[name=saidaPreco]').fill('320');
    // 10 × 366 × 50% ÷ 15 × 320 = 39.040 − 2% = 38.259,20
    confere(/Líquido: R\$\s38\.259,20/.test(await page.locator('main').innerText()), 'prévia da venda líquida = R$ 38.259,20');
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.getByRole('heading', { name: 'Saídas' }).waitFor();
    const fin = await page.locator('main').innerText();
    confere(fin.includes('30 cab'), 'lote ficou com 30 cabeças depois da venda');
    confere(/Vendas \(líquido\)[\s\S]*?R\$\s38\.259,20/.test(fin), 'venda entra no DRE do lote');
    confere((await page.getByTestId('resultadoLote').innerText()).includes('R$'), 'resultado do lote calculado');
    await foto('14-lote-dinheiro');

    console.log('13. Saúde do lote: carência');
    await page.getByRole('radio', { name: 'Saúde' }).click();
    await page.getByRole('button', { name: '+ Aplicação ou agendamento' }).click();
    await page.locator('select[name=sanTipo]').selectOption('vermifugo');
    await page.locator('input[name=sanProduto]').fill('Ivermectina 1%');
    await page.locator('input[name=sanCusto]').fill('240');
    await page.locator('input[name=sanCarencia]').fill('35');
    await page.locator('input[name=sanRepetir]').fill('90');
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.getByText('Em carência até').waitFor();
    await page.getByRole('heading', { name: 'Agendado' }).waitFor({ timeout: 5000 }).catch(() => {});
    const sau = await page.locator('main').innerText();
    confere(/Agendado[\s\S]*Ivermectina 1%/.test(sau), 'próxima dose agendada (repete em 90 dias)');
    confere(/Histórico[\s\S]*Ivermectina 1%[\s\S]*35 d/.test(sau), 'aplicação no histórico com 35 dias de carência');
    await foto('15-lote-saude');

    console.log('14. Financeiro da fazenda');
    await page.goto(URL + '#/financeiro');
    await page.getByRole('radio', { name: 'Tudo' }).click();
    await page.getByTestId('resultadoPeriodo').waitFor();
    const fz = await page.locator('main').innerText();
    confere(/Venda de animais/.test(fz) && /Sanidade/.test(fz), 'DRE da fazenda mostra venda e sanidade');
    await page.getByRole('radio', { name: 'Custos fixos' }).click();
    await page.locator('input[name=fixoNome]').fill('Vaqueiro');
    await page.locator('input[name=fixoValor]').fill('3000');
    await page.getByRole('button', { name: 'Salvar custo fixo' }).click();
    await page.getByText('Vaqueiro').first().waitFor();
    confere(true, 'custo fixo cadastrado');
    await foto('16-financeiro');

    console.log('15. Simulação');
    await page.goto(URL + '#/simular');
    await page.locator('input[name=simPeso]').fill('300');
    await page.locator('input[name=simAlvo]').fill('450');
    await page.locator('input[name=simGmd1]').fill('0,600');
    await page.locator('input[name=simGmd2]').fill('0,800');
    confere((await page.getByTestId('resultadoGmd').innerText()).includes('Antecipa a saída em 62 dias'), 'GMD 0,600 → 0,800 antecipa 62 dias');
    await page.getByRole('radio', { name: 'Segurar lote' }).click();
    await page.locator('input[name=segPeso]').fill('450');
    await page.locator('input[name=segGmd]').fill('0,8');
    await page.locator('input[name=segCusto]').fill('5');
    await page.locator('input[name=segArrobaTravada]').fill('340');
    // hoje: 15 @ × 320 = 4.800; em 30 dias: 474 kg = 15,8 @ × 340 = 5.372; − 150 = 422
    confere(/Ganha R\$\s422,00/.test(await page.getByTestId('resultadoSegurar').innerText()), 'segurar 30 dias com @ travada a R$ 340 = + R$ 422,00/cab');
    await page.getByRole('radio', { name: 'Comprar gado' }).click();
    confere(/Prejuízo de R\$\s608,53/.test(await page.getByTestId('resultadoCompra').innerText()), 'simulador de compra igual à planilha (− R$ 608,53/cab)');
    await foto('17-simular');
    await page.getByRole('radio', { name: /Comparar produtos/ }).click();
    await page.getByRole('radio', { name: /Dois rótulos/ }).click();
    await page.locator('input[name=cmpNome0]').fill('Prot A');
    await page.locator('input[name=cmpPreco0]').fill('2,4');
    await page.locator('input[name=cmpPb0]').fill('25');
    await page.locator('input[name=cmpNome1]').fill('Prot B');
    await page.locator('input[name=cmpPreco1]').fill('3,6');
    await page.locator('input[name=cmpPb1]').fill('40');
    confere((await page.getByTestId('melhorTipo').innerText()).includes('Prot B'), 'comparar: o proteinado com 40% de PB é o mais adequado');
    const mc = await page.getByTestId('melhorCusto').innerText();
    confere(mc.includes('Prot B') && /R\$\s9,00/.test(mc), 'comparar: melhor custo-benefício = R$ 9,00 por kg de proteína');
    await foto('17b-comparar');

    console.log('16. Relatórios em PDF e Excel');
    await page.goto(URL + '#/relatorios');
    await page.getByRole('heading', { name: 'Desempenho dos lotes' }).waitFor();
    const fs = require('node:fs');
    const [dPdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PDF' }).click()]);
    const cPdf = path.join(FOTOS, 'relatorio.pdf');
    await dPdf.saveAs(cPdf);
    confere(fs.readFileSync(cPdf).subarray(0, 5).toString() === '%PDF-', 'PDF gerado');
    const [dX] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Excel' }).click()]);
    const cX = path.join(FOTOS, 'relatorio.xlsx');
    await dX.saveAs(cX);
    confere(fs.readFileSync(cX).subarray(0, 2).toString() === 'PK', 'Excel gerado');
    const wa = await page.getByRole('link', { name: 'Mandar resumo no WhatsApp' }).getAttribute('href');
    confere(wa.startsWith('https://wa.me/?text=') && decodeURIComponent(wa).includes('Fazenda Boa Vista'), 'link do WhatsApp com o resumo');
    await foto('18-relatorios');

    console.log('17. Nuvem e cotações sem estar logado');
    await page.goto(URL + '#/nuvem');
    await page.getByText(/Nuvem ainda não ligada|Entrou como produtor@exemplo.com/).first().waitFor();
    confere(true, 'tela da nuvem: mostra a conta que entrou (ou explica que não está ligada)');
    await page.goto(URL + '#/cotacoes');
    await page.getByText(nuvemNoBuild ? 'Sem atualizar agora' : 'Entre na nuvem para receber as cotações').waitFor();
    confere(true, 'cotações: sem sinal, avisa e mostra as guardadas');
    await page.goto(URL + '#/nutricao/ingrediente/novo');
    await page.getByRole('button', { name: 'Salvar ingrediente' }).waitFor();
    await page.getByRole('button', { name: /Tirar foto da tabela nutricional/ }).click();
    await page.getByTestId('fotoPrecisaNuvem').waitFor();
    confere(true, 'foto da tabela nutricional explica que precisa da nuvem');
    await page.locator('select[name=ingCategoria]').selectOption('proteinado');
    await page.locator('input[name=ingNome]').fill('Proteinado Águas');
    await page.locator('input[name=ing_ms]').fill('92');
    await page.locator('input[name=ing_pb]').fill('40');
    await page.locator('input[name=ing_preco]').fill('3,2');
    await page.locator('input[name=ingConsumo]').fill('1 g por kg de PV');
    await page.locator('input[name=ing_consumoPct]').fill('0,1');
    await page.getByRole('button', { name: 'Salvar ingrediente' }).click();
    await page.getByText('Produto salvo e já pronto para usar no trato.').waitFor();
    await page.goto(URL + '#/nutricao');
    await page.getByText('Proteinado Águas').first().waitFor();
    confere(true, 'proteinado pronto vira ingrediente e fórmula de uma vez');
    await foto('19-nuvem');

    console.log('18. Exemplo e tela escura');
    await page.getByRole('link', { name: 'Mais' }).click();
    await page.getByRole('button', { name: 'Carregar exemplo' }).click();
    await page.getByText('Fêmea — 4º lote').waitFor();
    confere(true, 'exemplo carregado');
    await foto('08-inicio-exemplo');
    await page.emulateMedia({ colorScheme: 'dark' });
    await foto('09-escuro');
    await page.emulateMedia({ colorScheme: 'light' });

    if (nuvemNoBuild) {
      console.log('19. Perfil, sair e outra conta no mesmo celular');
      await page.getByRole('button', { name: /^Perfil de / }).click();
      await page.getByRole('dialog', { name: 'Seu perfil' }).getByText('produtor@exemplo.com').waitFor();
      confere(true, 'perfil no canto de cima mostra a conta');
      await foto('20-perfil');
      await page.getByRole('button', { name: 'Sair da conta' }).click();
      await page.getByRole('button', { name: 'Mandar e-mail de entrada' }).waitFor();
      confere(true, 'depois de sair, volta para a tela de entrada');
      await page.context().setOffline(true);
      await entrarComo('11111111-1111-4111-8111-111111111111', 'produtor@exemplo.com');
      await page.reload().catch(() => {});
      await page.getByText('Fêmea — 4º lote').waitFor();
      confere(true, 'sem internet, quem já entrou abre o app direto com os dados');
      await page.context().setOffline(false);
      await entrarComo('22222222-2222-4222-8222-222222222222', 'outra@exemplo.com');
      await page.reload();
      await page.getByTestId('outraConta').waitFor();
      confere(!(await page.getByText('Fêmea — 4º lote').count()), 'outra conta no mesmo celular não vê os dados de quem usava antes');
      await foto('21-outra-conta');
      await page.getByRole('button', { name: /Voltar e entrar com/ }).click();
      await page.getByRole('button', { name: 'Mandar e-mail de entrada' }).waitFor();
      confere(true, 'pode voltar sem apagar nada');
    }

    confere(erros.length === 0, 'nenhum erro de JavaScript' + (erros.length ? ': ' + erros.join(' | ') : ''));
  } catch (e) {
    console.log('ERRO: ' + e.message);
    await foto('erro').catch(() => {});
    falhas++;
  } finally {
    await browser.close();
    srv.kill();
  }
  console.log(falhas ? `\n${falhas} verificação(ões) falharam` : '\nTudo certo');
  process.exit(falhas ? 1 : 0);
})();
