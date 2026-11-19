import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { nuvemConfigurada, sb } from './nuvem/cliente';

// Chegou pelo link do e-mail de entrada: a biblioteca da nuvem lê a sessão do endereço e leva para a tela da nuvem.
if (nuvemConfigurada() && /access_token=|error_description=/.test(location.hash)) {
  sb().then((c) => c.auth.getSession()).finally(() => { location.replace(location.pathname + '#/nuvem'); });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Guarda o app no celular para abrir sem internet.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
// Pede ao navegador para não apagar os dados quando o celular ficar sem espaço.
navigator.storage?.persist?.().catch(() => {});
