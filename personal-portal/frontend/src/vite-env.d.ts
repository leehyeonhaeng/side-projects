/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_USER_POOL_ID: string;
  readonly VITE_USER_POOL_CLIENT_ID: string;
  /** 배포 환경 (CI가 넣음). 없으면 dev */
  readonly VITE_APP_ENV?: "dev" | "prod";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
