# Segurança do BoiForte

Regra do projeto: **o servidor nunca confia no aplicativo**. Tudo que o celular mandar pode ter sido
alterado, então toda regra de acesso, validação e cálculo que importa é feita (de novo) no servidor.

## No celular

Sem a nuvem ligada, os dados ficam só no celular do produtor (IndexedDB) e não saem dele, a não ser
pela cópia de segurança que o próprio produtor gera. Com a nuvem, veja a seção do servidor abaixo.

O que já está protegido:

| Risco | Proteção |
| --- | --- |
| Dado inválido gravado por qualquer tela ou por código | Validação dentro do banco (`src/validar.ts`, ganchos do Dexie): tipos, limites, datas reais, listas, campos obrigatórios. Campos desconhecidos são descartados. |
| Arquivo de cópia adulterado ou corrompido | Limite de tamanho (50 MB) e de linhas, conferência de formato e versão, cada linha passa pela mesma validação, e a restauração é uma transação única: se uma linha falhar, nada é alterado. |
| Texto malicioso (XSS) | A interface usa React, que escapa todo texto. Não há `innerHTML` nem `eval`. Caracteres de controle são removidos na gravação. |
| Código de terceiros | Nenhum script externo é carregado. O app é servido como arquivos estáticos e o service worker só guarda arquivos do próprio site. |
| Estoque e custo inconsistentes | Compra, batida, trato e seus estornos são transações atômicas: ou grava tudo, ou nada. |
| Fórmula maliciosa no Excel exportado | Todo texto vai como texto puro (`inlineStr`), que o Excel não executa; números vão como número. |
| PDF/Excel com dados de terceiros | Os arquivos são gerados no próprio celular, sem enviar nada para servidor; o resumo do WhatsApp só sai se o produtor tocar no botão. |
| Dinheiro e sanidade inconsistentes | Compra, venda/baixa (com volta das cabeças ao desfazer) e aplicação com custo são transações atômicas; valores e datas passam pela validação do banco. |
| Perda de dados | Pedido de armazenamento persistente ao navegador e cópia de segurança em arquivo. |

### Tela de entrada (login)

Com o app ligado ao servidor, ele só abre depois de entrar com e-mail e senha (no primeiro acesso, pelo link de confirmação do e-mail, e então a pessoa cadastra a senha). A sessão fica guardada no aparelho,
então o app abre direto (inclusive sem internet) até a pessoa tocar em "Sair da conta" ou o servidor recusar a sessão.
A tela de entrada protege a **tela**, não os dados: quem protege os dados da nuvem continua sendo o servidor, que confere
a sessão em cada chamada. Os dados guardados no próprio celular não são criptografados.
Se outra conta entrar no mesmo celular, o app não mostra os dados de quem usava antes: pede para apagá-los do celular
ou voltar para a outra conta.

### Dependências

As versões são fixas (sem `^`). Desde 23/11/2026 o app usa `react-router-dom` 7.18.6 e `npm audit --omit=dev` não aponta nada.

## Servidor (Etapa 4: nuvem, sincronização e equipe)

O servidor é um Postgres no Supabase. **O app não grava em nenhuma tabela**: toda gravação passa por funções
do banco (`supabase/migrations/`) que conferem login, fazenda, papel e cada campo, e refazem as contas.
Os testes `src/nuvem/servidor.test.ts` sobem essas mesmas migrações e tentam furar as regras como um app adulterado faria.

| Risco | Proteção no servidor |
| --- | --- |
| Ver ou mexer na fazenda de outra pessoa | Row Level Security em todas as tabelas; o usuário vem sempre da sessão (`auth.uid()`), nunca do app. Referências a registros de outra fazenda são recusadas. |
| App adulterado gravando direto | Permissões de tabela retiradas de `anon` e `authenticated`; só funções específicas podem ser chamadas, e as auxiliares não. |
| Papel burlado (vaqueiro, consultor) | Conferido em cada registro enviado: vaqueiro só grava pesagem, trato, sanidade, animais, movimentos e a contagem de cabeças; consultor só lê. O vaqueiro não recebe as tabelas de dinheiro e, nas tabelas do trato, recebe os preços e custos zerados (preço de ingrediente, custo de estoque, de batida, de trato e o valor das compras) e não recebe o preço da @ nem outras configurações de dinheiro. O custo do trato que ele marca é calculado no servidor; o lançamento de vacina dele vira sempre despesa de sanidade com o valor da aplicação. A tabela de registros não pode ser lida direto pela API, só por `baixar_alteracoes`, que aplica esse filtro. |
| Salário dos funcionários | A tabela de funcionários não vai para o vaqueiro (nem lida direto, nem por `baixar_alteracoes`) e ele não grava nela; consultor só lê. Dono e gerente cadastram, mas só o dono liga um funcionário a uma conta do app, e só a quem já é da equipe (uma conta por funcionário). Ninguém além do dono mexe no próprio cadastro, então ninguém aumenta o próprio salário. Toda gravação fica na auditoria (só o dono lê), com o salário de antes e de depois. Travas em `supabase/migrations/20261123160000_funcionarios.sql`. |
| Dado inválido | As regras de `src/validar.ts` são geradas em SQL (`npm run gerar-sql`, conferido em teste) e validadas no banco: tipo, faixa, data, texto, listas; campos desconhecidos descartados. |
| Valor de dinheiro adulterado | Venda (bruto e líquido), compra do lote e custo da batida são recalculados no servidor; o app recebe o valor corrigido. |
| Excesso de uso / força bruta | Limites contados no banco: envio 120/min (até 500 itens e 4 MB), fazendas 5/dia, convites 30/dia, tentar código de convite 10/hora, foto 30/dia; até 2 milhões de registros por fazenda. Códigos de convite de 10 caracteres, válidos por 7 dias e de uso único. |
| Fazenda sem dono / exclusão acidental | O último dono não pode sair nem ser rebaixado; apagar a fazenda exige o nome exato. |
| Rastro | Auditoria de alterações de dinheiro e de exclusões (quem, quando, o quê). |
| Login | E-mail e senha (Supabase Auth). Primeiro acesso e "esqueci a senha" por link (ou código de 6 números) no e-mail, com "Confirm email" ligado. Senha mínima de 8 com letras e números, conferida pelo servidor; tentativas limitadas por IP no Supabase. No banco: conta sem e-mail confirmado não vê nem grava nada, e a senha posta antes da confirmação é apagada quando o dono do e-mail confirma (ninguém "reserva" a conta de outro com uma senha). Trocar senha pelo perfil manda link ao e-mail (celular destravado na mão de outro não troca a senha). Sessão com renovação automática. |
| Posse da fazenda | Fica só na tabela de membros. Apagar a conta de quem criou a fazenda não apaga a fazenda dos outros. |
| Plano e número de pessoas | O plano fica na fazenda e só o servidor muda (`definir_plano`, chave de serviço); o app não tem permissão de alterar a tabela. Básico e Pro: quem assina + 1 pessoa; cada pessoa a mais é paga (até 50 no total). Uma trava no banco (gatilho em `membros`) recusa quem passar do limite, por qualquer caminho, trancando a linha da fazenda antes de contar (dois convites aceitos ao mesmo tempo não passam juntos). Convites em aberto ocupam vaga. Se o plano diminuir, ninguém é apagado: quem passou do limite fica pausado (não baixa, não envia, não usa foto); donos têm prioridade, depois quem entrou antes. |
| Convite vazado | O dono vê os convites ainda não usados e pode cancelar cada um. |
| Leitura por foto | Função no servidor: exige login e ser da fazenda (sem estar pausado), só no plano Pro, confere tipo e tamanho da imagem; cotas no banco: 150 por mês por fazenda (contador atômico, recusa não gasta), 30 por pessoa por dia e teto de 300 por dia no sistema todo; chave da IA só no servidor. O CORS só deixa o endereço do app usar a função pelo navegador; não é a proteção principal. A resposta é limpa por faixas plausíveis (peso de um animal até 2.000 kg; peso do lote todo até 200 t, quantidade inteira, e a média só vale se bater com total ÷ quantidade) e o app mostra para a pessoa conferir antes de salvar. A foto não é guardada. |
| Anotações e tarefas (com foto) | O vaqueiro vê e grava anotações, mas só apaga as que ele mesmo fez. Quem anotou e quem resolveu são carimbados no servidor (gatilho em `registros`, nome da pessoa na equipe); o que o app mandar nesses campos é ignorado. Os ids das fotos são conferidos no formato. As fotos ficam no Storage, balde **privado** `anotacoes`, pasta por fazenda (`<fazenda>/<foto>.jpg`), com RLS: só quem é da fazenda (sem estar pausado) vê; dono, gerente e vaqueiro enviam; só JPEG até 1 MB; nome conferido; 300 fotos por pessoa por dia e 5.000 por fazenda; ninguém troca uma foto já enviada; apagar só dono, gerente ou quem enviou. As funções dessas regras ficam no schema `bf_privado` (fora da API). Testes em `src/nuvem/anotacoes.servidor.test.ts`. |
| Pasto: um lote por piquete | Gatilhos em `registros` (`20261124150000_pasto.sql`): lote ou grupo de manejo ativo não entra em piquete que já tem outro, ocupações do mesmo piquete (e do mesmo lote/grupo) não se cruzam no tempo, saída não pode ser antes da entrada; tranca o piquete durante a conferência (dois celulares ao mesmo tempo não passam juntos). O vaqueiro grava entradas e saídas e muda só o piquete e as cabeças do lote; só dono e gerente apagam um registro. Fotos e áudios do pasto usam o mesmo balde privado `anotacoes` (JPEG e áudio webm/ogg/m4a, até 1 MB). Testes em `src/nuvem/pasto.servidor.test.ts`. |
| NDVI do satélite | Só o servidor grava (o gatilho recusa qualquer gravação vinda do app). A função `ndvi` roda agendada (cabeçalho secreto comparado em tempo constante) ou a pedido do dono/gerente (login conferido, papel e limite de 2 por hora no banco). As chaves do Copernicus ficam só nos segredos do servidor. O contorno é conferido (até 500 pontos, latitude/longitude válidas) e cada leitura passa por faixas (-1 a 1) antes e dentro do banco. A **foto do satélite** do piquete (`ndvi` com `foto`) é pedida por quem é da fazenda: o banco (`pedir_foto_satelite`) confere a pessoa e o piquete, limita a 40 fotos por hora e devolve o contorno guardado na nuvem, então a função nunca usa contorno vindo do celular; a resposta só passa se for PNG de até 3 MB. |
| Cotações | Gravadas só pela função agendada (cabeçalho secreto comparado em tempo constante, chave de serviço); números fora da faixa plausível são descartados no banco. O app só lê. |
| Página adulterada / scripts de fora | Content-Security-Policy: só scripts do próprio site; conexões só com o próprio site e o Supabase. |
| LGPD | Exportação pela cópia de segurança; "Apagar minha conta" apaga conta e fazendas só da pessoa. Ver `PRIVACIDADE.md`. |

### Pendências conhecidas

- O app ainda é servido no GitHub Pages, cujo endereço (`gearbest181081-cmd.github.io`) é dividido com qualquer outro site Pages da mesma conta: não publique outros sites Pages nesta conta. Com o domínio próprio, servir com cabeçalhos HTTP (CSP com `frame-ancestors 'none'`).
- A versão de sincronização é uma sequência única para todas as fazendas: revela só o volume total de gravações, nenhum conteúdo.
- Os limites de login por e-mail são os do Supabase Auth; para muitos usuários, configure um SMTP próprio (ver `CONFIGURAR.md`).
- O limite do plano conta **pessoas (contas)**, não aparelhos: a mesma conta pode entrar em mais de um celular. O servidor não tem como identificar um aparelho com segurança (quem informa é o próprio celular).
- Quem fica pausado ou é tirado da equipe continua com os dados que já estavam no celular (o app funciona sem internet); só deixa de sincronizar.
- Fotos de anotações: o banco não consegue apagar arquivos do Storage. O app apaga as fotos da fazenda antes de "Apagar minha conta"; se a fazenda for apagada por outro caminho, as fotos ficam órfãs (sem ninguém com acesso) até uma limpeza pela chave de serviço. Foto de anotação apagada por quem não tem permissão de apagar o arquivo (ex.: vaqueiro tirando a foto de outra pessoa) também fica órfã.
- A balança Bluetooth é experimental: o peso entra na tela e a pessoa confere antes de salvar.
