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

### Dependências

As versões são fixas (sem `^`). O `npm audit` aponta dois avisos no `react-router` (redirecionamento com barra invertida em `<Link>` e desserialização de erros no SSR). Nenhum se aplica: o app só usa caminhos internos fixos e não tem SSR. A troca para a versão 7 fica para uma próxima versão.

## Servidor (Etapa 4: nuvem, sincronização e equipe)

O servidor é um Postgres no Supabase. **O app não grava em nenhuma tabela**: toda gravação passa por funções
do banco (`supabase/migrations/`) que conferem login, fazenda, papel e cada campo, e refazem as contas.
Os testes `src/nuvem/servidor.test.ts` sobem essas mesmas migrações e tentam furar as regras como um app adulterado faria.

| Risco | Proteção no servidor |
| --- | --- |
| Ver ou mexer na fazenda de outra pessoa | Row Level Security em todas as tabelas; o usuário vem sempre da sessão (`auth.uid()`), nunca do app. Referências a registros de outra fazenda são recusadas. |
| App adulterado gravando direto | Permissões de tabela retiradas de `anon` e `authenticated`; só funções específicas podem ser chamadas, e as auxiliares não. |
| Papel burlado (vaqueiro, consultor) | Conferido em cada registro enviado: vaqueiro só grava pesagem, trato, sanidade, animais, movimentos e a contagem de cabeças, e não recebe as tabelas de dinheiro; consultor só lê. |
| Dado inválido | As regras de `src/validar.ts` são geradas em SQL (`npm run gerar-sql`, conferido em teste) e validadas no banco: tipo, faixa, data, texto, listas; campos desconhecidos descartados. |
| Valor de dinheiro adulterado | Venda (bruto e líquido), compra do lote e custo da batida são recalculados no servidor; o app recebe o valor corrigido. |
| Excesso de uso / força bruta | Limites contados no banco: envio 120/min (até 500 itens e 4 MB), fazendas 5/dia, convites 30/dia, tentar código de convite 10/hora, foto 30/dia; até 2 milhões de registros por fazenda. Códigos de convite de 10 caracteres, válidos por 7 dias e de uso único. |
| Fazenda sem dono / exclusão acidental | O último dono não pode sair nem ser rebaixado; apagar a fazenda exige o nome exato. |
| Rastro | Auditoria de alterações de dinheiro e de exclusões (quem, quando, o quê). |
| Login | Código de 6 números por e-mail (Supabase Auth). Nenhuma senha passa pelo app. Sessão com renovação automática. |
| Leitura por foto | Função no servidor: só aceita do endereço do app (CORS), exige login e ser de uma fazenda, confere tipo e tamanho da imagem, cota diária, chave da IA só no servidor. A resposta é limpa por faixas plausíveis e o app mostra para a pessoa conferir antes de salvar. A foto não é guardada. |
| Cotações | Gravadas só pela função agendada (cabeçalho secreto comparado em tempo constante, chave de serviço); números fora da faixa plausível são descartados no banco. O app só lê. |
| Página adulterada / scripts de fora | Content-Security-Policy: só scripts do próprio site; conexões só com o próprio site e o Supabase. |
| LGPD | Exportação pela cópia de segurança; "Apagar minha conta" apaga conta e fazendas só da pessoa. Ver `PRIVACIDADE.md`. |

### Pendências conhecidas

- O `npm audit` ainda aponta os dois avisos do `react-router` 6 citados acima (não se aplicam ao app). A troca para a versão 7 fica para uma próxima versão.
- Os limites de login por e-mail são os do Supabase Auth; para muitos usuários, configure um SMTP próprio (ver `CONFIGURAR.md`).
- A balança Bluetooth é experimental: o peso entra na tela e a pessoa confere antes de salvar.
