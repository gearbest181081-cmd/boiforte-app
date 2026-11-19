# Segurança do BoiForte

Regra do projeto: **o servidor nunca confia no aplicativo**. Tudo que o celular mandar pode ter sido
alterado, então toda regra de acesso, validação e cálculo que importa é feita (de novo) no servidor.

## Situação hoje (Etapas 1 e 2)

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
| Perda de dados | Pedido de armazenamento persistente ao navegador e cópia de segurança em arquivo. |

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
   saldo de estoque, preço médio e DRE. O app pode mostrar uma prévia, mas o número oficial é o do servidor.
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
