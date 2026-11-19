# Segurança do BoiForte

Regra do projeto: **o servidor nunca confia no aplicativo**. Tudo que o celular mandar pode ter sido
alterado, então toda regra de acesso, validação e cálculo que importa é feita (de novo) no servidor.

## Situação hoje (Etapas 1 a 3)

O BoiForte ainda **não tem servidor**. Os dados ficam só no celular do produtor (IndexedDB) e não
saem dele, a não ser pela cópia de segurança que o próprio produtor gera.

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

As versões são fixas (sem `^`). O `npm audit` aponta dois avisos no `react-router` (redirecionamento com barra invertida em `<Link>` e desserialização de erros no SSR). Nenhum se aplica: o app só usa caminhos internos fixos e não tem SSR. Serão eliminados ao migrar para a versão 7 junto com a Etapa 4.

## Plano para o servidor (Etapa 4: nuvem, sincronização e multiusuário)

1. **Autenticação**: login com provedor gerenciado (e-mail com código ou Google). Senhas nunca passam
   pelo nosso código. Sessões com tokens de vida curta e renovação; logout invalida no servidor.
2. **Autorização no banco**: cada registro pertence a uma *conta/fazenda*. O isolamento é feito no
   servidor com Row Level Security (Postgres): o usuário só lê e grava linhas das fazendas em que
   tem papel. O servidor ignora qualquer `fazendaId`/`usuarioId` vindo do app e usa o da sessão.
3. **Papéis**: dono, gerente, vaqueiro (só trato e pesagem), leitura (consultor). Checados no servidor
   em cada operação, não apenas escondendo botões.
4. **Validação no servidor**: os mesmos esquemas de `src/validar.ts` (compartilhados) rodam no
   servidor antes de qualquer gravação. Limites de tamanho de requisição e de quantidade de registros.
5. **Cálculos que valem dinheiro são refeitos no servidor**: custo de batida, custo do trato,
   saldo de estoque, preço médio, valor de compra e de venda do lote (a partir de cabeças, peso, preço,
   comissão e frete, nunca do total que o app mandar), rateio, DRE e carência. O app pode mostrar uma
   prévia, mas o número oficial é o do servidor. Relatórios compartilhados pela nuvem são gerados lá.
6. **Sincronização offline**: o celular grava localmente e envia uma fila de operações. O servidor
   aplica cada operação validando dono, papel e regras; conflitos são resolvidos no servidor com
   registro de quem alterou o quê (auditoria).
7. **Proteções de API**: HTTPS obrigatório, CORS restrito ao domínio do app, limite de requisições
   por usuário e por IP, cabeçalhos de segurança (CSP, HSTS), sem chaves secretas no app.
8. **Segredos**: chaves de serviços (cotações, leitura de rótulo por foto, WhatsApp) ficam só no
   servidor, em variáveis de ambiente, nunca no código do app nem no repositório.
9. **Arquivos enviados** (fotos de rótulo, balança): tipo e tamanho conferidos no servidor,
   armazenados em área privada por fazenda, com links temporários.
10. **Auditoria e LGPD**: registro de ações sensíveis, exportação e exclusão de conta a pedido do
    produtor, dados mínimos de pessoas (nome e contato do usuário).

Antes de abrir o app para outros produtores, esta lista vira uma checagem obrigatória.
