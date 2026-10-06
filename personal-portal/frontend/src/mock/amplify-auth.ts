// mock 모드 전용 (vite --mode mock): "aws-amplify/auth" 대신. 항상 로그인된 Host + TOTP 등록 상태
/* eslint-disable @typescript-eslint/no-unused-vars */
const ok = async () => undefined;

export type SignInOutput = { isSignedIn: boolean; nextStep: { signInStep: string } };

export const getCurrentUser = async () => ({ userId: "mock-host", username: "mock-host" });
export const fetchMFAPreference = async () => ({ enabled: ["TOTP"], preferred: "TOTP" });
export const fetchAuthSession = async () => ({ tokens: { accessToken: { toString: () => "mock-token" } } });
export const signOut = ok;
export const signIn = async (_: unknown): Promise<SignInOutput> => ({ isSignedIn: true, nextStep: { signInStep: "DONE" } });
export const confirmSignIn = async (_: unknown): Promise<SignInOutput> => ({ isSignedIn: true, nextStep: { signInStep: "DONE" } });
export const signUp = async (_: unknown) => ({ isSignUpComplete: false, nextStep: { signUpStep: "CONFIRM_SIGN_UP" } });
export const confirmSignUp = async (_: unknown) => ({ isSignUpComplete: true });
export const resendSignUpCode = ok;
export const resetPassword = async (_: unknown) => ({ nextStep: { resetPasswordStep: "CONFIRM_RESET_PASSWORD_WITH_CODE" } });
export const confirmResetPassword = ok;
export const updatePassword = ok;
export const updateMFAPreference = ok;
export const verifyTOTPSetup = ok;
export const setUpTOTP = async () => ({ sharedSecret: "MOCKSECRET", getSetupUri: () => new URL("otpauth://totp/Portal:mock?secret=MOCKSECRET") });
