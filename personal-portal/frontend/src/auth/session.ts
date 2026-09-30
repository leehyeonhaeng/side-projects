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

/** 로그인·로그아웃 뒤 이전 사용자의 캐시가 남지 않게 전부 비운다 */
export function useResetAuthCache() {
  const qc = useQueryClient();
  return () => qc.resetQueries();
}

export function useSignOut() {
  const reset = useResetAuthCache();
  return async () => {
    await signOut();
    await reset();
  };
}
