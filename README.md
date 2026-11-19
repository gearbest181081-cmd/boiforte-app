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
- Simulações "E se": mudar o GMD, segurar o lote com a @ travada e simulador de compra (igual à aba SIMULADOR da planilha).
- Relatórios de desempenho, resultado e ranking em **PDF e Excel**, com envio pelo WhatsApp.
- Avisos inteligentes: custo da @ subindo 5% no mês, @ produzida mais cara que a vendida, carência antes da data prevista de saída, doses atrasadas e prazos do calendário.

Próxima etapa: recursos com internet (nuvem, vários usuários, cotações, balança). Veja o plano de segurança em [SEGURANCA.md](SEGURANCA.md).

## Para desenvolver

```bash
npm install
npm run dev        # abre em http://localhost:5173
npm test           # testes dos cálculos, da voz e do banco local
npm run build
node e2e/run.cjs   # teste de ponta a ponta num celular simulado (precisa do Playwright)
```

A cada envio para `main`, o GitHub Actions roda os testes e publica o app no GitHub Pages.

## Organização

- `src/calc.ts`: GMD, projeção, arrobas (mesmas fórmulas da planilha de recria/TIP).
- `src/alertas.ts`: avisos do rebanho.
- `src/voz.ts`: reconhecimento de voz e leitura de números falados.
- `src/nutricao.ts` e `src/estoque.ts`: formulação, faixas de referência, estoque.
- `src/validar.ts`: validação de tudo que é gravado.
- `src/financeiro.ts`, `src/sanidade.ts`, `src/simulacao.ts`: dinheiro, saúde do rebanho e "E se".
- `src/relatorios.ts` e `src/exportar.ts`: tabelas dos relatórios, Excel e PDF gerados no próprio celular.
- `src/db.ts`: banco local (Dexie/IndexedDB), regras de estoque/trato e cópia de segurança.
- `src/pages/`: telas.
