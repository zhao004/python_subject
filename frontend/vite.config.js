import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig, loadEnv} from 'vite';
import react from '@vitejs/plugin-react';

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDir, '..');
const srcDir = resolve(currentDir, 'src');

export default defineConfig(({mode}) => {
    // 网站标题与侧边栏标题统一从项目根目录 .env 读取，前端目录不再单独配置
    const rootEnv = loadEnv(mode, projectRoot, '');
    const siteTitle = rootEnv.SITE_TITLE || '配对检测系统';
    const sidebarTitle = rootEnv.ADMIN_SIDEBAR_TITLE || '后台管理';

    return {
        plugins: [react(), {
            name: 'site-title-html',
            transformIndexHtml(html) {
                return html.replaceAll('%VITE_SITE_TITLE%', siteTitle);
            },
        }], define: {
            'import.meta.env.VITE_SITE_TITLE': JSON.stringify(siteTitle),
            'import.meta.env.VITE_ADMIN_SIDEBAR_TITLE': JSON.stringify(sidebarTitle),
        },         resolve: {
            alias: {
                '@': srcDir,
            },
        }, build: {
            outDir: '../static', emptyOutDir: true,
        }, server: {
            port: 5173, proxy: {
                '/api': 'http://127.0.0.1:8000',
            },
        },
    };
});
