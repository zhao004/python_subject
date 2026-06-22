/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SITE_TITLE?: string;
  readonly VITE_ADMIN_SIDEBAR_TITLE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
