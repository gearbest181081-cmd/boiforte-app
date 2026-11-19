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

  try {
    console.log('1. Primeira abertura');
    await page.goto(URL);
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
    await page.locator('select').last().selectOption({ label: 'Retiro de cima › Piquete 3' });
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
    await page.locator('input[type=date]').fill('2026-11-20');
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

    console.log('10. Exemplo e tela escura');
    await page.getByRole('link', { name: 'Mais' }).click();
    await page.getByRole('button', { name: 'Carregar exemplo' }).click();
    await page.getByText('Fêmea — 4º lote').waitFor();
    confere(true, 'exemplo carregado');
    await foto('08-inicio-exemplo');
    await page.emulateMedia({ colorScheme: 'dark' });
    await foto('09-escuro');

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
