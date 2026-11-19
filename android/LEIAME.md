# BoiForte na Play Store (Android)

O app da loja é o mesmo app do site, aberto em tela cheia por um "Trusted Web Activity" (TWA).
Assim, toda atualização do site chega no app da loja sem publicar de novo.

## O que você precisa

1. **Conta de desenvolvedor do Google Play** (taxa única de US$ 25): https://play.google.com/console
2. **Um endereço próprio** para o app (ex.: `app.boiforte.com.br`). O Android exige o arquivo
   `/.well-known/assetlinks.json` na **raiz** do endereço, e o GitHub Pages do repositório fica em
   `/boiforte-app/`, que não é a raiz. Com domínio próprio no GitHub Pages, a raiz passa a ser o app.
3. Um computador com Node 22 e Java 17 (o Bubblewrap baixa o resto sozinho).

## Passo a passo

1. Configure o domínio no GitHub (Settings › Pages › Custom domain) e confira que o app abre nele.
2. No `twa-manifest.json` desta pasta, troque `SEU-DOMINIO` pelo endereço.
3. Rode:
   ```
   npx @bubblewrap/cli@1.24.1 init --manifest https://SEU-DOMINIO/manifest.webmanifest
   npx @bubblewrap/cli@1.24.1 build
   ```
   Guarde o arquivo `boiforte.keystore` e a senha em lugar seguro. **Sem ele não dá para atualizar o app na loja.**
4. Envie o `app-release-bundle.aab` no Play Console (Teste interno primeiro).
5. No Play Console, em *Integridade do app › Assinatura*, copie a **digital SHA-256** e cole em
   `assetlinks.json` desta pasta. Copie o arquivo para `public/.well-known/assetlinks.json` e publique o site.
   Sem isso o app abre com uma barra de endereço em cima.
6. Ficha da loja: use os ícones de `public/`, prints do celular e a política de privacidade (`PRIVACIDADE.md`).

## Observações

- Ao subir de versão, aumente `appVersionCode` e `appVersionName`.
- A balança Bluetooth funciona dentro do app da loja (usa o Chrome do celular).
