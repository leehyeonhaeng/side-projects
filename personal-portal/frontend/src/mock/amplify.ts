// mock 모드 전용 (vite --mode mock): "aws-amplify" 대신. 화면 점검용으로 로그인 없이 앱을 띄운다
export const Amplify = { configure: () => undefined };
