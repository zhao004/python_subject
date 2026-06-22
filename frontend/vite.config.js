import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig, loadEnv} from 'vite';
import react from '@vitejs/plugin-react';

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDir, '..');

export default defineConfig(({mode}) => {
    const rootEnv = loadEnv(mode, projectRoot, '');
    const frontendEnv = loadEnv(mode, currentDir, 'VITE_');
    const siteTitle = frontendEnv.VITE_SITE_TITLE || rootEnv.SITE_TITLE || '配对检测系统';

    return {
        plugins: [react(), {
            name: 'site-title-html',
            transformIndexHtml(html) {
                return html.replaceAll('%VITE_SITE_TITLE%', siteTitle);
            },
        }], define: {
            'import.meta.env.VITE_SITE_TITLE': JSON.stringify(siteTitle),
        }, build: {
            outDir: '../static', emptyOutDir: true,
        }, server: {
            port: 5173, proxy: {
                '/api': 'http://127.0.0.1:8000',
            },
        },
    };
});
