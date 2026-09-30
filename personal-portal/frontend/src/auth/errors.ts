/** 풀은 이메일 대소문자를 무시하지만, 저장·표시를 일관되게 하려고 소문자로 맞춘다. */
export const normalizeEmail = (value: string) => value.trim().toLowerCase();

export const PASSWORD_RULE = "8자 이상, 소문자·숫자·특수문자 포함";

export function authErrorMessage(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : "";
  if (name === "NotAuthorizedException" && /disabled/i.test(message)) {
    return "승인 대기 중이거나 정지된 계정입니다.";
  }
  switch (name) {
    case "NotAuthorizedException":
    case "UserNotFoundException":
      return "이메일 또는 비밀번호가 올바르지 않습니다.";
    case "UsernameExistsException":
      return "이미 가입된 이메일입니다.";
    case "CodeMismatchException":
      return "인증 코드가 올바르지 않습니다.";
    case "ExpiredCodeException":
      return "인증 코드가 만료되었습니다. 코드를 다시 받아주세요.";
    case "InvalidPasswordException":
      return `비밀번호 규칙: ${PASSWORD_RULE}`;
    case "LimitExceededException":
    case "TooManyRequestsException":
      return "요청이 너무 많습니다. 잠시 후 다시 시도하세요.";
    case "EnableSoftwareTokenMFAException":
      return "OTP 코드가 올바르지 않습니다.";
    default:
      return message || "알 수 없는 오류가 발생했습니다.";
  }
}
