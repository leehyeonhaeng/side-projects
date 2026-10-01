import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchMFAPreference, getCurrentUser, signOut } from "aws-amplify/auth";

export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      try {
        return await getCurrentUser();
      } catch {
        return null;
      }
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export function useTotpEnabled(enabled: boolean) {
  return useQuery({
    queryKey: ["mfa"],
    queryFn: async () => (await fetchMFAPreference()).enabled?.includes("TOTP") ?? false,
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * 로그인·로그아웃 뒤 이전 사용자의 캐시가 남지 않게 전부 지운다.
 * resetQueries는 화면에 붙은 쿼리를 다시 요청해서, 로그아웃 직후 401 → 로그아웃 반복을 만든다. clear만 쓴다.
 */
export function useClearAuthCache() {
  const qc = useQueryClient();
  return () => qc.clear();
}

export function useSignOut() {
  const clear = useClearAuthCache();
  return async () => {
    try {
      await signOut();
    } finally {
      // 토큰 폐기 요청이 실패해도 로컬 상태는 비운다
      clear();
    }
  };
}
