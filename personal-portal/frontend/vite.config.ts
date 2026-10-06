import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// --mode mock: 로그인·API 없이 가짜 데이터로 띄우는 화면 점검 모드 (scripts/screens.mjs). 배포에는 쓰지 않는다
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    // DESIGN.md 9.2: 홈 화면 설치 + 새 버전 감지 → "새로고침" 배너 (오프라인 동작은 범위 밖)
    VitePWA({
      disable: mode === "mock",
      registerType: "prompt",
      injectRegister: false,
      pwaAssets: { config: true, overrideManifestIcons: true },
      manifest: {
        name: "Personal Portal",
        short_name: "Portal",
        description: "개인·가족·팀 통합 포털",
        lang: "ko",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#faf8f4",
        theme_color: "#4f86e0",
      },
      workbox: {
        // 앱 껍데기(JS·CSS·HTML·아이콘)만 미리 받는다. 글꼴 조각(92개)은 쓸 때 받아서 캐시
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === "font",
            handler: "CacheFirst",
            options: { cacheName: "fonts", expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: [
      ...(mode === "mock"
        ? [
            { find: /^aws-amplify\/auth$/, replacement: fileURLToPath(new URL("./src/mock/amplify-auth.ts", import.meta.url)) },
            { find: /^aws-amplify$/, replacement: fileURLToPath(new URL("./src/mock/amplify.ts", import.meta.url)) },
          ]
        : []),
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
    ],
  },
}));
