# Como ligar a nuvem do BoiForte

Sem estes passos o app funciona normalmente, só que sem nuvem (cada celular sozinho).
Leva uns 30 minutos. Você só faz uma vez.

## 1. Criar o projeto no Supabase

1. Crie uma conta em https://supabase.com e um projeto novo.
   - Região: **South America (São Paulo)**.
   - Guarde a senha do banco em lugar seguro.
2. Em *Project Settings › API*, copie:
   - **Project URL** (algo como `https://abcd.supabase.co`)
   - **anon public key** (pode ficar no app; as regras do servidor protegem tudo)
   - **service_role key** (SECRETA: nunca coloque no app nem no GitHub)

## 2. Criar o banco (regras de segurança)

No *SQL Editor* do Supabase, rode **na ordem** o conteúdo de cada arquivo de `supabase/migrations/`:
`20261119000001_boiforte.sql`, `20261119000002_esquemas.sql`, `20261119000003_foto_cotacoes.sql`.

(Ou, com o Supabase CLI: `supabase link` e `supabase db push`.)

### Anotações e tarefas (fotos no Storage)

A migração `20261123170000_anotacoes.sql` cria o balde **privado** `anotacoes` no Storage, as regras de quem vê,
envia e apaga as fotos, e o carimbo de quem anotou/resolveu. Rode-a no *SQL Editor* depois das anteriores (ela já traz as regras
de validação atualizadas, com a tabela `anotacoes`). Para conferir:

```sql
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'anotacoes';  -- public = false
select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'bf_anotacoes%';
```

As fotos são diminuídas no celular (lado maior 1280 px, uns 100 a 300 KB). Limite de 5.000 fotos por fazenda
(cerca de 1 GB no pior caso); para mudar, troque o número numa migração nova.

### Plano de cada fazenda (Básico / Pro)

Fazenda nova começa no **Básico**. Os dois planos incluem quem assina + 1 pessoa; cada pessoa a mais é paga (`usuarios_extras`). As fazendas que já existiam quando a migração
`20261123140000_planos_usuarios.sql` rodou viraram **Pro** com vaga para todos que já estavam nelas.
Enquanto não há cobrança automática, mude o plano no *SQL Editor*:

```sql
-- ver as fazendas
select id, nome, plano, usuarios_extras from public.fazendas order by nome;
-- Pro com 2 pessoas extras (4 no total). Básico sem extra: 'basico', 0
select public.definir_plano('<id da fazenda>', 'pro', 2);
```

A leitura por foto é só do Pro: 150 por mês por fazenda (volta no dia 1º, horário de Brasília).
Para vender um pacote extra, aumente a cota do mês daquela fazenda:

```sql
select public.definir_cota_foto('<id da fazenda>', 250); -- 150 do plano + 100 do pacote
```

Existe também um teto de 300 leituras por dia no sistema todo (proteção de custo). Com muitas fazendas
no Pro, aumente esse número numa migração nova.

Se o plano diminuir, quem passar do limite fica pausado (ninguém é apagado) até o dono tirar alguém
ou o plano aumentar.

## 3. Entrada com e-mail e senha

Como funciona no app: no **primeiro acesso** a pessoa digita o e-mail, recebe um link de confirmação, toca nele
e cadastra a senha. Nas próximas vezes entra com **e-mail e senha**. Se esquecer, toca em "Esqueci minha senha",
recebe outro link e cadastra uma senha nova. Quem já usava o app pelo link do e-mail cria a senha na próxima vez que abrir com internet.

Rode a migração `20261124120000_login_senha.sql` no *SQL Editor* (depois das anteriores). Ela libera contas com senha
**só depois que o e-mail é confirmado**, apaga a senha que alguém tenha posto antes da confirmação (assim ninguém
"reserva" a conta de outro com uma senha) e cria a função `tenho_senha`. Ela também apaga senhas antigas (até hoje o
app nunca cadastrou senha, então nada de bom se perde).

No painel do Supabase, em *Authentication*:
- *Sign In / Providers › Email*: ligado, **"Confirm email" LIGADO**, "Secure email change" ligado,
  validade do link/código (*Email OTP Expiration*) 3600 s, 6 dígitos.
  Não desligue o "Confirm email": sem ele, qualquer pessoa cria pela API uma conta com senha usando o e-mail de outra.
- *Sign In / Providers › Email › Password*: **mínimo 8** caracteres e exigência **"Letters and digits"** (letras e números).
  Se o plano do Supabase tiver, ligue também *"Prevent use of leaked passwords"*.
- *Rate Limits*: deixe os limites de login (sign-ins/sign-ups e verificações) em 30 a cada 5 minutos por IP.
  Isso trava quem tenta adivinhar senhas.
- *Emails › Templates* (só dá para editar com SMTP próprio, ver abaixo):
  - *Confirm signup* e *Magic Link*: assunto "Confirme seu e-mail no BoiForte", corpo de `supabase/templates/confirmar.html`.
  - *Reset Password*: assunto "Criar senha nova no BoiForte", corpo de `supabase/templates/nova-senha.html`.
  Sem SMTP próprio, os e-mails chegam com o texto padrão do Supabase (em inglês), mas o link funciona igual.
- *URL Configuration*: *Site URL* = endereço do app (ex.: `https://SEU-USUARIO.github.io/boiforte-app/`) e em
  *Redirect URLs* o mesmo endereço com `**` no fim.
- **SMTP próprio** (*Project Settings › Auth › SMTP*, ex.: Resend com o domínio do BoiForte): sem ele o Supabase só
  manda e-mail para quem é da equipe da conta do Supabase e poucos por hora. Para clientes e funcionários receberem o
  link de primeiro acesso, o SMTP próprio é obrigatório.

## 4. Função do servidor (leitura por foto)

Com o Supabase CLI (https://supabase.com/docs/guides/cli):

```
supabase functions deploy ler-foto
supabase secrets set APP_ORIGIN=https://SEU-USUARIO.github.io
supabase secrets set ANTHROPIC_API_KEY=sua-chave-da-anthropic
```

- `APP_ORIGIN` é só o começo do endereço do app (sem `/boiforte-app/`). Outros sites não conseguem usar a função pelo navegador; a proteção principal é o login e a cota no banco.
- A chave da Anthropic é criada em https://console.anthropic.com. Cada pessoa pode ler até 30 fotos por dia.
- Sempre que a pasta `supabase/functions` mudar (ex.: a foto da balança com o lote todo), rode de novo `supabase functions deploy ler-foto`. Não precisa de migração.

## 5. Ligar o app à nuvem (GitHub)

O endereço e a chave pública ficam no arquivo `.env.production` do repositório (já preenchido com o projeto da BoiForte).
Se trocar de projeto, edite esse arquivo. **Nunca** coloque nele a chave secreta.

E em *Settings › Pages › Source*, escolha **GitHub Actions** (se ainda não fez).

Pronto: o próximo envio para `main` publica o app já com a nuvem.

## 6. Conferir

1. Abra o app, *Mais › Nuvem e equipe*, entre com seu e-mail e o código.
2. *Criar fazenda na nuvem*: os dados do celular sobem e você vira o dono.
3. *Convidar* gera um código de 10 letras. No outro celular, entre e use o código.
