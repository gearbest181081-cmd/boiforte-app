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

Se o plano diminuir, quem passar do limite fica pausado (ninguém é apagado) até o dono tirar alguém
ou o plano aumentar.

## 3. Login por código no e-mail

Em *Authentication*:
- *Providers › Email*: ligado, **"Confirm email" LIGADO**, OTP com 6 dígitos e validade de 600 s.
  Não desligue o "Confirm email": sem ele, qualquer pessoa cria pela API uma conta com senha usando o e-mail de outra
  e entra na conta dela depois. O login por código continua funcionando, porque o código já confirma o e-mail.
  (O banco também bloqueia contas com senha, mas isso é a segunda tranca.)
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

- `APP_ORIGIN` é só o começo do endereço do app (sem `/boiforte-app/`). Outros sites não conseguem usar a função pelo navegador; a proteção principal é o login e a cota no banco.
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
