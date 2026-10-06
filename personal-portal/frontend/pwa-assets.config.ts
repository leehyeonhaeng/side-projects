import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

// 앱 아이콘 원본: public/logo.svg (임시). 사용자 이미지로 바꿀 때는 images만 바꾸고 `npm run icons`
const BRAND = "#4f86e0";

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    // 안드로이드가 원·둥근 사각형으로 자르는 아이콘과 iOS 아이콘의 여백을 흰색 대신 브랜드 색으로
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: BRAND } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: BRAND } },
  },
  images: ["public/logo.svg"],
});
