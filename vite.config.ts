import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// Gera o service worker com a lista de todos os arquivos do build,
// para que o app inteiro fique guardado no celular já na primeira visita.
function serviceWorker(): Plugin {
  return {
    name: 'boiforte-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const pub = ['manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];
      const version = Date.now().toString(36);
      const template = readFileSync(new URL('./src/sw-template.js', import.meta.url), 'utf8');
      const source = template
        .replace('__VERSION__', version)
        .replace('__FILES__', JSON.stringify(['./', ...files, ...pub].map((f) => (f === './' ? f : './' + f))));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), serviceWorker()],
  test: { environment: 'node' },
} as any);
