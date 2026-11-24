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
    const nuvemNoBuild = await page.getByTestId('entrarSenha').waitFor({ timeout: 4000 }).then(() => true, () => false);
    if (nuvemNoBuild) {
      confere(!(await page.locator('nav.baixo').count()), 'sem entrar, o app não mostra o menu nem os dados');
      await foto('00-entrada');
      await page.locator('input[name=email]').fill('produtor@exemplo.com');
      await page.locator('input[name=senha]').fill('boi2026forte');
      confere(await page.locator('input[name=senha]').getAttribute('type') === 'password', 'a senha aparece escondida');
      await page.getByRole('button', { name: 'Mostrar a senha' }).click();
      confere(await page.locator('input[name=senha]').getAttribute('type') === 'text', 'botão Ver mostra a senha');
      await page.getByRole('button', { name: 'Entrar', exact: true }).click();
      await page.getByText('Sem internet agora').first().waitFor();
      confere(true, 'sem sinal, a entrada avisa em português simples');
      await page.getByRole('button', { name: 'Primeiro acesso? Criar minha senha' }).click();
      await page.getByTestId('primeiroAcesso').waitFor();
      confere((await page.locator('input[name=email]').inputValue()) === 'produtor@exemplo.com', 'primeiro acesso já traz o e-mail digitado');
      await foto('00b-primeiro-acesso');
      await page.getByRole('button', { name: 'Mandar link de confirmação' }).click();
      await page.getByText('Sem internet agora').first().waitFor();
      await page.getByRole('button', { name: 'Já tenho senha: entrar' }).click();
      await page.getByRole('button', { name: 'Esqueci minha senha' }).click();
      await page.getByRole('button', { name: 'Mandar link para nova senha' }).waitFor();
      confere(true, 'tela de esqueci a senha manda link');
      // Entrou pelo link do e-mail: o app pede para cadastrar a senha antes de abrir.
      await entrarComo('11111111-1111-4111-8111-111111111111', 'produtor@exemplo.com');
      await page.evaluate(() => localStorage.setItem('boiforte-cadastrar-senha', '1'));
      await page.reload();
      await page.getByTestId('criarSenha').waitFor();
      confere(!(await page.locator('nav.baixo').count()), 'depois do link, pede a senha antes de abrir o app');
      await page.locator('input[name=nova-senha]').fill('abc');
      await page.getByText('pelo menos 8').waitFor();
      await page.locator('input[name=nova-senha]').fill('boi2026forte');
      await page.locator('input[name=repetir-senha]').fill('boi2026fort');
      await page.getByText('As duas senhas não estão iguais.').waitFor();
      confere(true, 'cadastro de senha explica senha curta e senhas diferentes');
      await foto('00c-criar-senha');
      await page.evaluate(() => localStorage.removeItem('boiforte-cadastrar-senha'));
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
    await page.getByTestId('pesagemSalva').waitFor();
    const relTxt = await page.locator('main').innerText();
    confere(relTxt.includes('GMD desde a pesagem anterior') && relTxt.includes('0,800 kg/dia'), 'depois de salvar, abre o relatório da pesagem com o GMD');
    confere((await page.locator('svg.grafico').count()) === 2, 'relatório mostra a curva de ganho e o GMD por período');
    await foto('03a-relatorio-pesagem');
    await page.getByRole('link', { name: 'Ver o lote' }).click();
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
    await page.getByRole('radio', { name: /Lote todo/ }).click();
    await page.locator('input[name=pesoTotal]').fill('3480');
    await page.locator('input[name=qtdPesada]').fill('10');
    confere((await page.getByTestId('contaMedia').innerText()).includes('348 kg por cabeça'), 'lote todo na balança: 3.480 kg ÷ 10 cab = 348 kg por cabeça');
    await page.getByRole('button', { name: /Ler o peso pela foto da balança/ }).click();
    confere(await page.getByTestId('fotoPrecisaNuvem').isVisible(), 'foto da balança explica que precisa da nuvem (plano Pro)');
    await foto('04a-pesar-lote-todo');
    await page.getByRole('radio', { name: /Um a um/ }).click();
    const pesos = ['350', '340', '352'];
    for (let i = 0; i < pesos.length; i++) {
      if (i > 0) await page.getByRole('button', { name: '+ Animal' }).click();
      await page.getByLabel(`Peso ${i + 1}`, { exact: true }).fill(pesos[i]);
    }
    confere(await page.getByText('347,3 kg').isVisible(), 'média de 3 animais = 347,3 kg');
    await page.getByRole('button', { name: 'Salvar pesagem' }).click();
    await page.getByTestId('pesagemSalva').waitFor();
    {
      const fs = require('node:fs');
      const [dP] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Enviar PDF (com gráficos)' }).click()]);
      confere(dP.suggestedFilename() === 'pesagem-lote-5-2026-10-31.pdf', 'PDF da pesagem com nome do lote e data');
      const cP = path.join(FOTOS, 'pesagem.pdf');
      await dP.saveAs(cP);
      const pdf = fs.readFileSync(cP).toString('latin1');
      confere(pdf.startsWith('%PDF-') && pdf.includes('(Curva de ganho de peso) Tj'), 'PDF da pesagem com a curva de ganho');
      const [dX] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Enviar Excel' }).click()]);
      const cX = path.join(FOTOS, 'pesagem.xlsx');
      await dX.saveAs(cX);
      confere(fs.readFileSync(cX).subarray(0, 2).toString() === 'PK', 'Excel da pesagem gerado');
      const wa = decodeURIComponent(await page.getByRole('link', { name: 'Mandar resumo em texto no WhatsApp' }).getAttribute('href'));
      confere(wa.includes('Pesagem do lote *Lote 5*') && wa.includes('347 kg'), 'resumo da pesagem pronto para o WhatsApp');
    }
    await page.getByRole('link', { name: 'Ver o lote' }).click();
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
    await page.getByTestId('pesagemSalva').waitFor();
    await page.getByRole('link', { name: 'Ver o lote' }).click();
    await page.getByRole('heading', { name: 'Novilhas' }).waitFor();
    await page.getByRole('link', { name: 'Nova pesagem' }).click();
    await page.getByLabel('Peso 1', { exact: true }).waitFor();
    confere((await page.getByLabel('Brinco 1', { exact: true }).inputValue()) === 'A1', 'brincos já vêm preenchidos na segunda pesagem');
    await page.locator('input[type=date]').fill('2026-10-31');
    await page.getByLabel('Peso 1', { exact: true }).fill('221');
    await page.getByLabel('Peso 2', { exact: true }).fill('225');
    await page.getByRole('button', { name: 'Salvar pesagem' }).click();
    await page.getByTestId('pesagemSalva').waitFor();
    confere((await page.locator('main').innerText()).includes('Melhor animal'), 'relatório do lote por cabeça mostra o melhor animal');
    await page.getByRole('button', { name: 'A2' }).click();
    await page.getByText('Posição no lote (GMD)').waitFor();
    confere((await page.locator('main').innerText()).includes('2º de 2'), 'relatório do animal A2: posição no lote');
    await foto('05a-relatorio-animal');
    await page.getByRole('link', { name: 'Ver o lote' }).click();
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
    await page.getByTestId('pesagemSalva').waitFor();
    confere(true, 'pesagem salva sem internet');
    {
      const [dOff] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Enviar PDF (com gráficos)' }).click()]);
      confere(/\.pdf$/.test(dOff.suggestedFilename()), 'relatório em PDF sai mesmo sem internet');
    }
    await foto('07-offline');
    await page.getByRole('link', { name: 'Ver o lote' }).click();
    await page.getByRole('heading', { name: 'Lote 5' }).waitFor();
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
    await page.locator('input[name=fixoNome]').fill('Energia');
    await page.locator('input[name=fixoValor]').fill('300');
    await page.getByRole('button', { name: 'Salvar custo fixo' }).click();
    await page.getByText('Energia').first().waitFor();
    confere(true, 'custo fixo cadastrado');
    await foto('16-financeiro');

    console.log('14b. Funcionários com salário');
    await page.goto(URL + '#/mais');
    await page.getByRole('link', { name: 'Funcionários' }).click();
    await page.getByRole('link', { name: '+ Cadastrar funcionário' }).click();
    await page.locator('input[name=funcNome]').fill('João');
    await page.getByRole('button', { name: 'Vaqueiro', exact: true }).click();
    await page.locator('input[name=funcSalario]').fill('2400');
    await page.getByRole('button', { name: /Somar 13º e férias/ }).click();
    confere(/Total: R\$\s2\.866,67 por mês/.test(await page.getByTestId('funcCusto').innerText()), 'salário + 13º e férias = R$ 2.866,67 por mês');
    await page.locator('input[name=funcAdmissao]').fill('2026-09-01');
    confere((await page.getByTestId('acessoApp').innerText()).includes('Nuvem e equipe'), 'sem nuvem, explica como chamar o funcionário para o app');
    await foto('16b-funcionario');
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.getByTestId('cartaoFuncionario').waitFor();
    confere(/Folha deste mês: R\$\s2\.866,67/.test(await page.getByTestId('folhaTotal').innerText()), 'folha do mês na lista');
    await foto('16c-funcionarios');
    await page.getByRole('button', { name: 'Voltar' }).click();
    await page.getByRole('button', { name: 'Carregar exemplo' }).waitFor();
    confere(true, 'botão voltar sai dos funcionários');
    await page.goto(URL + '#/financeiro');
    await page.getByRole('radio', { name: 'Tudo' }).click();
    await page.getByTestId('resultadoPeriodo').waitFor();
    confere((await page.locator('main').innerText()).includes('Salários dos funcionários'), 'salário entra no DRE da fazenda');

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

    console.log('17. Nuvem sem estar logado');
    await page.goto(URL + '#/nuvem');
    await page.getByText(/Nuvem ainda não ligada|Entrou como produtor@exemplo.com/).first().waitFor();
    confere(true, 'tela da nuvem: mostra a conta que entrou (ou explica que não está ligada)');
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

    console.log('17b. Anotações e tarefas (sem internet, com foto, módulo e piquete)');
    await page.goto(URL + '#/');
    await page.getByTestId('cartaoAnotacoes').click();
    await page.getByText('Nada para corrigir').waitFor();
    await ctx.setOffline(true);
    await page.getByRole('link', { name: '+ Anotar o que precisa corrigir' }).click();
    await page.locator('textarea[name=anotTexto]').fill('Cerca caída perto da porteira');
    await page.getByTestId('fotoCamera').setInputFiles(path.join(__dirname, '..', 'public', 'icon-512.png'));
    await page.locator('.foto-com-x img').first().waitFor();
    confere((await page.getByText('Fotos (1 de 4)').count()) === 1, 'foto tirada entra na anotação (diminuída no celular)');
    await page.locator('select[name=anotPiquete]').selectOption({ label: 'Piquete 3 (Retiro de cima)' });
    confere((await page.locator('select[name=anotModulo] option:checked').textContent()) === 'Retiro de cima', 'escolher o piquete já marca o módulo');
    await page.getByRole('radio', { name: /Cerca/ }).click();
    await page.getByRole('radio', { name: /Urgente/ }).click();
    await foto('20-anotacao-nova');
    await page.getByRole('button', { name: 'Salvar anotação' }).click();
    await page.getByTestId('anotacao').first().waitFor();
    const card = await page.getByTestId('anotacao').first().innerText();
    confere(card.includes('Cerca caída perto da porteira') && card.includes('urgente') && card.includes('Retiro de cima · Piquete 3'), 'anotação aparece na lista com lugar e urgência, mesmo sem internet');
    const mini = page.locator('.anotacao img').first();
    await mini.waitFor();
    let carregou = false; // (sem waitForFunction: a CSP do app bloqueia eval no CI)
    for (let i = 0; i < 50 && !(carregou = await mini.evaluate((im) => im.complete && im.naturalWidth > 0)); i++) await page.waitForTimeout(100);
    confere(carregou, 'miniatura da foto aparece na lista');
    const foto1 = await page.evaluate(() => new Promise((ok) => {
      const r = indexedDB.open('boiforte');
      r.onsuccess = () => {
        const g = r.result.transaction('fotosAnotacao').objectStore('fotosAnotacao').getAll();
        g.onsuccess = () => ok(g.result.map((f) => ({ estado: f.estado, kb: f.dados.byteLength / 1024, jpeg: new Uint8Array(f.dados)[0] === 0xff })));
      };
    }));
    confere(foto1.length === 1 && foto1[0].jpeg && foto1[0].kb < 1024 && foto1[0].estado === 'enviar', `foto guardada no celular como JPEG de ${Math.round(foto1[0]?.kb ?? 0)} KB, esperando para subir`);
    await foto('21-anotacoes');
    await page.goto(URL + '#/');
    await page.getByText('Tarefas a fazer: 1 (1 urgente)').waitFor();
    confere(true, 'início mostra as tarefas a fazer');
    await page.getByTestId('cartaoAnotacoes').click();
    await page.getByTestId('anotacao').first().locator('a').click();
    await page.getByRole('button', { name: 'Ver foto' }).first().click();
    await page.locator('.foto-cheia img').waitFor();
    confere(true, 'foto abre em tela cheia');
    await page.getByRole('button', { name: 'Fechar' }).click();
    await foto('22-anotacao-detalhe');
    await page.getByRole('button', { name: '✓ Marcar como feita' }).click();
    await page.getByRole('button', { name: 'Voltar para "a fazer"' }).waitFor();
    await page.getByRole('button', { name: 'Voltar', exact: true }).click();
    await page.getByRole('radio', { name: 'Feitas (1)' }).waitFor();
    confere((await page.getByRole('radio', { name: 'A fazer (0)' }).count()) === 1, 'marcada como feita sai da lista de "a fazer"');
    await ctx.setOffline(false);

    console.log('18. Exemplo e tela escura');
    await page.getByRole('link', { name: 'Mais' }).click();
    await page.getByRole('button', { name: 'Carregar exemplo' }).click();
    await page.getByText('Fêmea — 4º lote').waitFor();
    confere(true, 'exemplo carregado');
    await foto('08-inicio-exemplo');
    await page.emulateMedia({ colorScheme: 'dark' });
    await foto('09-escuro');
    await page.emulateMedia({ colorScheme: 'light' });

    console.log('18b. Lote passa de recria (RIP) para TIP');
    await page.locator('a.cartao', { hasText: 'Macho — 1º lote' }).click();
    await page.getByRole('link', { name: 'Passar para TIP' }).click();
    await page.getByRole('radio', { name: 'TIP' }).waitFor();
    confere((await page.getByRole('radio', { name: 'TIP' }).getAttribute('aria-checked')) === 'true', 'a próxima fase sugerida é a TIP');
    confere((await page.locator('input[name=pesoAlvoNovo]').inputValue()) === '540', 'peso alvo sugerido para a TIP');
    await page.locator('input[name=pesoMudanca]').fill('242');
    await foto('21-mudar-fase');
    await page.getByRole('button', { name: 'Passar lote para TIP' }).click();
    await page.getByRole('heading', { name: 'Fases do lote' }).waitFor();
    const fasesTxt = await page.locator('table').filter({ hasText: 'Fase' }).first().innerText();
    confere(/Recria/.test(fasesTxt) && /TIP/.test(fasesTxt) && /242/.test(fasesTxt), 'histórico mostra a recria e a TIP com o peso da troca');
    confere(/TIP \(terminação intensiva a pasto\)/.test(await page.locator('main p.mudo').first().innerText()), 'lote agora está na TIP');
    await foto('22-fases-do-lote');
    await page.getByRole('link', { name: 'Início' }).click();

    if (nuvemNoBuild) {
      console.log('19. Perfil, sair e outra conta no mesmo celular');
      await page.getByRole('button', { name: /^Perfil de / }).click();
      await page.getByRole('dialog', { name: 'Seu perfil' }).getByText('produtor@exemplo.com').waitFor();
      confere(true, 'perfil no canto de cima mostra a conta');
      await foto('20-perfil');
      await page.getByRole('button', { name: 'Sair da conta' }).click();
      await page.getByTestId('entrarSenha').waitFor();
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
      await page.getByTestId('entrarSenha').waitFor();
      confere(true, 'pode voltar sem apagar nada');
    }

    console.log('20. Voltar em todas as telas e microfone em todos os campos');
    {
      const ctx2 = await browser.newContext({ ...devices['Pixel 7'], locale: 'pt-BR' });
      await ctx2.route(/supabase\.co/, (r) => r.abort());
      // Reconhecimento de voz de mentira: devolve o que estiver em window.__fala.
      await ctx2.addInitScript(() => {
        class Falso {
          start() { setTimeout(() => { const t = window.__fala || ''; this.onresult && this.onresult({ results: [[{ transcript: t }]] }); this.onend && this.onend(); }, 30); }
          stop() { this.onend && this.onend(); }
        }
        window.SpeechRecognition = Falso; window.webkitSpeechRecognition = Falso;
      });
      const p2 = await ctx2.newPage();
      p2.on('pageerror', (e) => erros.push(e.message));
      p2.on('dialog', (d) => d.accept());
      await p2.goto(URL);
      if (nuvemNoBuild) { await p2.evaluate((v) => localStorage.setItem('boiforte-sessao', v), sessaoFalsa('11111111-1111-4111-8111-111111111111', 'produtor@exemplo.com')); await p2.reload(); }
      await p2.getByRole('link', { name: 'Mais' }).click();
      await p2.getByRole('button', { name: 'Carregar exemplo' }).click();
      await p2.getByText('Fêmea — 4º lote').waitFor();
      const loteId = await p2.evaluate(() => new Promise((ok) => { const r = indexedDB.open('boiforte'); r.onsuccess = () => { const t = r.result.transaction('lotes').objectStore('lotes').getAll(); t.onsuccess = () => ok(t.result[0].id); }; }));
      const formulaId = await p2.evaluate(() => new Promise((ok) => { const r = indexedDB.open('boiforte'); r.onsuccess = () => { const t = r.result.transaction('formulas').objectStore('formulas').getAll(); t.onsuccess = () => ok(t.result[0]?.id ?? 'nova'); }; }));
      const telas = ['/lotes', '/lotes/novo', `/lotes/${loteId}`, `/lotes/${loteId}/editar`, `/lotes/${loteId}/relatorio`, '/pesar', `/pesar/${loteId}`, '/fazenda', '/mais', '/nutricao',
        `/nutricao/formula/${formulaId}`, '/nutricao/formula/nova', '/nutricao/ingrediente/novo', '/estoque', '/trato', '/financeiro', '/sanidade', '/simular', '/relatorios', '/nuvem', '/funcionarios', '/funcionarios/novo', '/anotacoes', '/anotacoes/nova'];
      const semVoltar = [], semMic = [];
      for (const t of telas) {
        await p2.goto(URL + '#' + t);
        await p2.locator('header.topo h1').waitFor();
        await p2.waitForTimeout(250);
        if (!(await p2.getByRole('button', { name: 'Voltar', exact: true }).count())) semVoltar.push(t);
        const faltam = await p2.evaluate(() => [...document.querySelectorAll('main input, main select, main textarea')]
          .filter((e) => !['checkbox', 'file', 'hidden', 'radio'].includes(e.type) && e.offsetParent !== null && !e.closest('.lista-pesos'))
          .filter((e) => !e.closest('.com-mic')?.querySelector(':scope > .mic'))
          .map((e) => e.name || e.getAttribute('aria-label') || e.id));
        if (faltam.length) semMic.push(`${t}: ${faltam.join(', ')}`);
      }
      confere(semVoltar.length === 0, 'botão Voltar em todas as telas' + (semVoltar.length ? ' (falta em ' + semVoltar.join(', ') + ')' : ''));
      confere(semMic.length === 0, 'microfone em todos os campos de escrever' + (semMic.length ? ' (falta em ' + semMic.join(' | ') + ')' : ''));
      await p2.goto(URL + '#/simular');
      await p2.getByRole('radio', { name: /Comparar produtos/ }).click();
      await p2.getByRole('radio', { name: /Dois rótulos/ }).click();
      const semMicCmp = await p2.evaluate(() => [...document.querySelectorAll('main input, main select, main textarea')]
        .filter((e) => !['checkbox', 'file', 'hidden', 'radio'].includes(e.type) && e.offsetParent !== null)
        .filter((e) => !e.closest('.com-mic')?.querySelector(':scope > .mic'))
        .map((e) => e.name || e.getAttribute('aria-label') || e.id));
      confere(semMicCmp.length === 0, 'Simulação › Comparar produtos: microfone em todos os campos' + (semMicCmp.length ? ' (falta em ' + semMicCmp.join(', ') + ')' : ''));
      await p2.goto(URL);
      confere(!(await p2.getByRole('button', { name: 'Voltar', exact: true }).count()), 'Início não tem Voltar');
      await p2.goto(URL + '#/fazenda');
      await p2.getByRole('button', { name: 'Voltar', exact: true }).click();
      await p2.getByRole('button', { name: 'Carregar exemplo' }).waitFor();
      confere(true, 'aberto direto na Fazenda, o Voltar leva ao Mais');
      await p2.getByRole('link', { name: 'Mais' }).click();
      await p2.getByRole('link', { name: 'Fazenda' }).click();
      await p2.getByRole('button', { name: '+ Outra fazenda' }).click();
      await p2.getByRole('button', { name: 'Cancelar' }).click();
      confere(await p2.getByRole('button', { name: '+ Outra fazenda' }).isVisible(), 'cadastro de outra fazenda tem Cancelar');
      await p2.getByRole('button', { name: 'Voltar', exact: true }).click();
      await p2.getByRole('button', { name: 'Carregar exemplo' }).waitFor();
      confere(true, 'Voltar da Fazenda volta para o Mais');

      // Microfone: explicação nas 3 primeiras vezes
      await p2.goto(URL + `#/pesar/${loteId}`);
      await p2.evaluate(() => { window.__fala = 'ontem'; });
      await p2.getByRole('button', { name: 'Falar data da pesagem' }).click();
      await p2.getByTestId('dicaMic').waitFor();
      confere((await p2.getByTestId('dicaMic').innerText()).includes('1 de 3'), 'primeiro toque no microfone mostra a explicação (1 de 3)');
      await foto('22-dica-microfone');
      await p2.getByRole('button', { name: 'Entendi, falar agora' }).click();
      const ontem = await p2.evaluate(() => { const d = new Date(Date.now() - 86400000); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); });
      // Espera no Node (waitForFunction pode cair em eval e a CSP do app bloqueia).
      const esperarValor = async (sel, v) => {
        for (const fim = Date.now() + 5000; Date.now() < fim; await p2.waitForTimeout(50)) if ((await p2.locator(sel).inputValue()) === v) return;
        throw new Error(`${sel} não ficou "${v}"`);
      };
      await esperarValor('input[name=pesagemData]', ontem);
      confere(true, 'falar "ontem" preenche a data');
      await p2.evaluate(() => { window.__fala = 'trezentos e vinte vírgula cinco'; });
      const mic = p2.locator('.com-mic').filter({ has: p2.locator('input[name=pesoMedio]') }).locator('.mic');
      if (await mic.count()) {
        await mic.click();
        await p2.getByTestId('dicaMic').waitFor();
        confere((await p2.getByTestId('dicaMic').innerText()).includes('2 de 3'), 'segundo toque: explicação 2 de 3');
        await p2.getByRole('button', { name: 'Entendi, falar agora' }).click();
        await esperarValor('input[name=pesoMedio]', '320,5');
        confere(true, 'falar número preenche o peso');
        await mic.click(); await p2.getByRole('button', { name: 'Entendi, falar agora' }).click();
        await p2.waitForTimeout(200);
        await mic.click(); await p2.waitForTimeout(200);
        confere(!(await p2.getByTestId('dicaMic').count()), 'do quarto uso em diante a explicação não aparece');
        await p2.evaluate(() => { window.__fala = 'quinze arrobas'; });
        await mic.click();
        await esperarValor('input[name=pesoMedio]', '450');
        confere(true, 'falar "quinze arrobas" vira 450 kg');
        await p2.evaluate(() => { window.__fala = 'umas arrobas'; });
        await mic.click(); await p2.waitForTimeout(300);
        confere((await p2.locator('body').innerText()).includes('Este peso é em kg, não em arroba'), 'arroba sem número avisa que o peso é em kg');
        await p2.locator('input[name=pesoMedio]').fill('18');
        await p2.getByTestId('pareceArroba').waitFor();
        await p2.getByTestId('pareceArroba').scrollIntoViewIfNeeded();
        await p2.screenshot({ path: path.join(FOTOS, '23-parece-arroba.png') });
        await p2.getByRole('button', { name: /Era arroba: usar 540 kg/ }).click();
        await esperarValor('input[name=pesoMedio]', '540');
        confere(!(await p2.getByTestId('pareceArroba').count()), '18 digitado: aviso de arroba converte para 540 kg');
      }
      await p2.evaluate(() => { window.__fala = 'fêmea'; });
      await p2.getByRole('button', { name: 'Falar lote' }).click();
      await p2.waitForTimeout(300);
      const loteSel = await p2.locator('select[name=lote]').evaluate((s) => s.options[s.selectedIndex].text);
      confere(/fêmea/i.test(loteSel), `falar o nome escolhe na lista (${loteSel})`);
      await ctx2.close();
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
