/** 배포 환경. prod가 아니면 화면에 DEV 표시, OTP 앱 이름에 (dev)를 붙인다 */
export const APP_ENV = import.meta.env.VITE_APP_ENV ?? "dev";
export const IS_PROD = APP_ENV === "prod";

/** 인증 앱(Google Authenticator 등)에 보이는 서비스 이름 */
export const OTP_ISSUER = IS_PROD ? "Personal Portal" : "Personal Portal (dev)";
