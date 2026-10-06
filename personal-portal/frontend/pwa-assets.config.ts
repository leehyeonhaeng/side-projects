import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

// 앱 아이콘 원본: public/app-icon.png = 사용자 제공 이미지에서 안쪽 둥근 사각형만 잘라내고 모서리를 투명하게 한 1024px.
// 바꾸면 `npm run icons`
const CARD = "#1d1d21"; // 아이콘 바탕색: 여백을 이 색으로 채워 경계가 보이지 않게

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    // 안드로이드가 원·둥근 사각형으로 자르므로 여백 없이 꽉 채운다 (그림은 안전 영역 안에 있음)
    maskable: { ...minimal2023Preset.maskable, padding: 0, resizeOptions: { background: CARD } },
    // iOS는 자체로 모서리를 둥글게 깎으므로 여백 없이
    apple: { ...minimal2023Preset.apple, padding: 0, resizeOptions: { background: CARD } },
  },
  images: ["public/app-icon.png"],
});
