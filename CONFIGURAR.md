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

## 3. Login por código no e-mail

Em *Authentication*:
- *Providers › Email*: ligado, "Confirm email" desligado, OTP com 6 dígitos e validade de 600 s.
- *Email Templates › Magic Link*: cole o conteúdo de `supabase/templates/codigo.html`
  (o importante é ter `{{ .Token }}`, que é o código de 6 números).
- *URL Configuration › Site URL*: o endereço do app (ex.: `https://SEU-USUARIO.github.io/boiforte-app/`).
- Para muitos usuários, configure um SMTP próprio em *Project Settings › Auth › SMTP* (o envio grátis do Supabase é limitado a poucos e-mails por hora).

## 4. Funções do servidor (foto e cotações)

Com o Supabase CLI (https://supabase.com/docs/guides/cli):

```
supabase functions deploy ler-foto
supabase functions deploy atualizar-cotacoes --no-verify-jwt
supabase secrets set APP_ORIGIN=https://SEU-USUARIO.github.io
supabase secrets set ANTHROPIC_API_KEY=sua-chave-da-anthropic
supabase secrets set CRON_SECRET=uma-senha-longa-e-aleatoria
```

- `APP_ORIGIN` é só o começo do endereço do app (sem `/boiforte-app/`). A foto só é aceita vinda dele.
- A chave da Anthropic é criada em https://console.anthropic.com. Cada pessoa pode ler até 30 fotos por dia.
- As cotações vêm das páginas de indicadores do Cepea/Esalq. Antes de abrir ao público, confira as
  condições de uso do Cepea (citar a fonte é obrigatório; o app já mostra "Fonte: Cepea/Esalq").
  Para trocar as fontes sem mexer no código: `supabase secrets set FONTES_COTACOES='[...]'` (ver `supabase/functions/_shared/cotacoes.ts`).

## 5. Ligar o app à nuvem (GitHub)

O endereço e a chave pública ficam no arquivo `.env.production` do repositório (já preenchido com o projeto da BoiForte).
Se trocar de projeto, edite esse arquivo. **Nunca** coloque nele a chave secreta.

No repositório, em *Settings › Secrets and variables › Actions*, aba **Secrets**: `CRON_SECRET` (a mesma senha do passo 4).

E em *Settings › Pages › Source*, escolha **GitHub Actions** (se ainda não fez).

Pronto: o próximo envio para `main` publica o app já com a nuvem. As cotações atualizam sozinhas de segunda a sexta às 18h30.
Para testar na hora: *Actions › Atualizar cotações › Run workflow*.

## 6. Conferir

1. Abra o app, *Mais › Nuvem e equipe*, entre com seu e-mail e o código.
2. *Criar fazenda na nuvem*: os dados do celular sobem e você vira o dono.
3. *Convidar* gera um código de 10 letras. No outro celular, entre e use o código.
