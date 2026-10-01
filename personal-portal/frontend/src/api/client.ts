import { fetchAuthSession } from "aws-amplify/auth";

const baseUrl = import.meta.env.VITE_API_BASE_URL;

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Options = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  auth?: boolean;
};

async function authHeader(): Promise<Record<string, string>> {
  // 만료된 access token은 Amplify가 refresh token으로 자동 갱신한다
  const session = await fetchAuthSession();
  const token = session.tokens?.accessToken?.toString();
  if (!token) {
    // 토큰 없이 요청하지 않는다 → 401로 처리해서 로그인 화면으로 보낸다 (main.tsx)
    throw new ApiError(401, "로그인이 만료되었습니다. 다시 로그인하세요.");
  }
  return { authorization: `Bearer ${token}` };
}

/** 모든 API 호출의 단일 진입점 */
export async function apiFetch<T>(path: string, { method = "GET", body, auth = true }: Options = {}): Promise<T> {
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: { "content-type": "application/json", ...(auth ? await authHeader() : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const data = (await res.json()) as { message?: string };
      message = data.message ?? message;
    } catch {
      // 본문이 JSON이 아니면 상태 코드만 쓴다
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "POST", body }),
  put: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "PUT", body }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "PATCH", body }),
  del: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};
