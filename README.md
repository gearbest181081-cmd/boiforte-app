# BoiForte

Aplicativo de gestão de **cria, recria e engorda** (a pasto, TIP e confinamento) feito para o produtor usar no celular, **mesmo sem internet**.

## Etapa 1 (esta versão)

- Cadastro de fazenda, módulos (retiros) e piquetes, com lotação em cab/ha.
- Lotes por fase (cria, recria, engorda a pasto, TIP, confinamento), controlados **pelo lote** (peso médio) ou **por cabeça** (brinco).
- Pesagens: peso médio, um a um (o app tira a média) ou por brinco.
- GMD por período e desde a entrada, GMD individual por animal, arrobas de carcaça.
- Curva de crescimento com meta de GMD e projeção da data em que o lote chega ao peso alvo.
- Avisos: GMD 10% abaixo da meta, perda de peso, muitos dias sem pesar, peso alvo perto ou atingido.
- Entrada por voz em português ("trezentos e vinte e meio", "brinco doze peso trezentos e dezoito").
- Funciona offline (service worker) e guarda tudo no aparelho (IndexedDB), com cópia de segurança em arquivo.

## Etapa 2

- Biblioteca de ingredientes (MS, PB, NDT, Ca, P, preço) com valores de partida.
- Formulação em kg ou %: PB, NDT, Ca, P, Ca:P e custo/kg, na matéria natural e na seca.
- Alertas por tipo (sal mineral, proteinado, proteico energético, RIP, TIP, creep, confinamento) com o risco explicado, incluindo limite de ureia.
- Consumo por % do peso vivo, diária por cabeça e custo da @ produzida comparado com o preço da @.
- Calculadora de batida; misturas batidas vão para o estoque.
- Trato do dia por lote, ajustado pelo peso estimado, com checkbox para o vaqueiro.
- Estoque de insumos e misturas: compras com preço médio, baixa automática no trato e na batida, contagem e aviso de reposição.
- Custo de nutrição por lote.

## Etapa 3

- Compra do lote com a fórmula da planilha (preço × cabeças × (1 + comissão) + frete + NF/GTA).
- Venda por @ ou por cabeça (comissão e frete descontados) e baixa por morte; o lote encerra sozinho quando zera.
- Despesas e receitas por lote ou gerais da fazenda; as gerais e os custos fixos mensais são **rateados por cabeça-dia**.
- DRE por lote (com custo de oportunidade, valor do gado no pasto, custo da @ produzida e custo por cabeça), DRE da fazenda por mês, ano ou safra e fluxo de caixa mensal.
- Sanidade: aplicações e agendamentos por lote, próxima dose automática, **carência para abate** e calendário anual (declaração do rebanho, brucelose) editável.
- Simulação: mudar o GMD, segurar o lote com a @ travada, simulador de compra (igual à aba SIMULADOR da planilha) e comparar produtos
  (fórmulas da biblioteca ou dois rótulos pela foto/digitados), mostrando o mais adequado ao tipo e o melhor custo-benefício.
- Relatórios de desempenho, resultado e ranking em **PDF e Excel**, com envio pelo WhatsApp.
- Avisos inteligentes: custo da @ subindo 5% no mês, @ produzida mais cara que a vendida, carência antes da data prevista de saída, doses atrasadas e prazos do calendário.

## Etapa 4

- **Nuvem e equipe**: entrar com e-mail e senha (primeiro acesso por link de confirmação no e-mail), criar a fazenda na nuvem ou entrar por convite. O celular continua funcionando sem sinal e sincroniza sozinho quando pega internet.
- **Papéis**: dono, gerente, vaqueiro (pesa, trata e vacina, sem ver dinheiro) e consultor (só olha). Tudo conferido no servidor.
- **Funcionários**: nome, função e salário (com 13º, férias e encargos). A folha entra sozinha no custo da fazenda e no custo da @ produzida, rateada entre os lotes pelas cabeças. O dono chama o funcionário para o app pela própria ficha dele. O vaqueiro não vê salários.
- **Cálculos de dinheiro refeitos no servidor**: se um celular mandar valor errado, volta corrigido.
- **Leitura por foto**: rótulo do núcleo/suplemento (preenche MS, PB, NDT, Ca, P e ureia) e visor da balança.
- **Balança Bluetooth** (experimental): o peso parado entra sozinho na próxima linha da pesagem.
- **Android**: arquivos e guia para publicar na Play Store em [android/LEIAME.md](android/LEIAME.md).

## Cria (separada da Recria/Engorda)

- Trabalha com **grupo de manejo** em vez de lote; um piquete recebe um lote ou grupo de cada vez.
- **Matriz** lançada uma a uma; **touro** um a um ou por lote (quantidade). Brinco, chip, SISBOV, raça, nascimento, foto, mãe e pai (rastreabilidade do nascimento à venda: na desmama o bezerro continua o mesmo registro).
- **Estação de monta** (monta, IA, IATF, IA com repasse), cobertura em várias vacas de uma vez, **diagnóstico de gestação**, **parto** (cria o bezerro com mãe e pai) e aborto.
- **Bezerros**: projeção da desmama (data e peso, com ou sem creep feed), pesagens e curva do nascimento à desmama, P205.
- **Desmama**: pacote congelado e numerado no ano (versão 1, 2…) que vira lote de **Recria ou RIP** com o peso médio ponderado; fêmeas podem ficar como novilhas de reposição. Dá para desfazer enquanto o lote não teve outro lançamento.
- **Histórico da vaca**: crias, % machos e fêmeas, intervalo entre partos, idade ao primeiro parto, parto na época certa.
- **Período de permanência** no lugar do peso alvo, com aviso perto do fim e quando passa.
- **IPM** (kg de bezerro desmamado ajustado a 205 dias por ano de vaca) com ranking e possíveis descartes com o motivo.
- **Custo do bezerro desmamado** por cabeça, kg e @ (30 kg vivo): despesas lançadas nos grupos + parte da Cria nos custos gerais e na folha (a Cria entra no rateio por cabeça junto com os lotes).
- **Decisões**: descarte, compra de touros (1 para 25), novilhas a reter, diagnóstico pendente, bezerros na idade de desmamar, partos próximos.
- **Simulador**: vender na desmama ou recriar, reter novilhas ou vender, projeção do rebanho em 5 anos (desfrute e retenção).
- Sanidade por grupo ou por animal; leitura do brinco pela foto.
- Contas em `src/cria.ts`, gravações em `src/criaDb.ts`, telas em `src/pages/Cria*.tsx`. Migração `20261124160000_cria.sql`.

## Pasto (módulos e piquetes)

- O **módulo** é o conjunto de piquetes (rotacionado ou contínuo, com dias de ocupação, de descanso e capacidade de suporte em UA/ha); o **piquete** é a variável de decisão.
- **Um lote ou grupo por piquete**: o app só oferece piquetes vazios e o servidor recusa o segundo ocupante.
- **Mudar de piquete**: altura do capim, nota (com voz), fotos e áudio na saída e na entrada. O histórico fica na ficha do piquete.
- **Indicadores**: UA/ha do piquete e do módulo, pressão de pastejo e oferta de forragem na entrada (massa estimada pela altura), dias ocupado e de descanso, ocupação ideal para fechar o descanso, próximo piquete sugerido e aviso de lotação alta (também usado pela Cria).
- **Satélite (NDVI do Sentinel-2)** por piquete, com aviso quando o verde cai em relação ao próprio piquete ou aos vizinhos depois do descanso. O contorno do piquete é gravado andando em volta com o GPS ou importando um KML.

Para ligar a nuvem, siga [CONFIGURAR.md](CONFIGURAR.md). Segurança em [SEGURANCA.md](SEGURANCA.md) e privacidade em [PRIVACIDADE.md](PRIVACIDADE.md).

## Para desenvolver

```bash
npm install
npm run dev        # abre em http://localhost:5173
npm test           # testes dos cálculos, da voz, do banco local e do servidor (Postgres em memória)
npm run build
node e2e/run.cjs   # teste de ponta a ponta num celular simulado (precisa do Playwright)
```

A cada envio para `main`, o GitHub Actions roda os testes e publica o app no GitHub Pages.

## Organização

- `src/calc.ts`: GMD, projeção, arrobas (mesmas fórmulas da planilha de recria/TIP).
- `src/alertas.ts`: avisos do rebanho.
- `src/voz.ts`: reconhecimento de voz e leitura de números, datas, textos e escolhas faladas.
- `src/nutricao.ts` e `src/estoque.ts`: formulação, faixas de referência, estoque.
- `src/validar.ts`: validação de tudo que é gravado.
- `src/financeiro.ts`, `src/sanidade.ts`, `src/simulacao.ts`: dinheiro, saúde do rebanho e Simulação.
- `src/faixas.ts`: faixa adequada de cada nutriente por tipo de fórmula (com as fontes); `src/comparar.ts`: comparação de produtos.
- `src/relatorios.ts` e `src/exportar.ts`: tabelas dos relatórios, Excel e PDF gerados no próprio celular.
- `src/db.ts`: banco local (Dexie/IndexedDB), regras de estoque/trato e cópia de segurança.
- `src/nuvem/`: sincronização, login e equipe (`sinc.ts`, `cliente.ts`) e os testes do servidor.
- `src/balanca.ts`: balança Bluetooth.
- `src/pasto.ts` e `src/pastoGeo.ts`: contas do pasto, ocupação dos piquetes, leitura do NDVI e contorno do piquete; `supabase/functions/ndvi`: busca do satélite.
- `supabase/`: banco (migrações com todas as regras) e funções do servidor (leitura por foto).
- `src/pages/`: telas.

### Regras para telas novas

- **Todo campo de escrever tem microfone.** Use os componentes de `src/components/ui.tsx` em vez de `<input>`, `<select>` ou `<textarea>` soltos:
  `CampoTexto` (texto; `multilinha` para observações; `formato="email" | "codigo" | "digitos"`), `CampoNumero`, `CampoData`, `CampoEscolha`
  e, quando não houver rótulo visível, `Entrada`, `EntradaData` e `Escolha`. Só caixa de marcar, arquivo e senha (`CampoSenha`: falar a senha em voz alta deixa os outros ouvirem) ficam sem microfone.
  Nas 3 primeiras vezes que a pessoa toca num microfone, aparece a explicação de como falar.
- **Toda tela tem Voltar.** O `Topo` já mostra o botão "Voltar" (só o Início fica sem). Se a tela abrir um formulário dentro dela, ponha também um botão "Cancelar".
- O teste de ponta a ponta (passo 20) confere as duas regras em todas as telas da lista `telas`: acrescente lá as telas novas.
