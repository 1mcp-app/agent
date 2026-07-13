interface ImportMetaEnv {
  readonly VITE_ADMIN_UI_BUILD_VERSION?: string;
  readonly VITE_ADMIN_UI_PROTOCOL_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
