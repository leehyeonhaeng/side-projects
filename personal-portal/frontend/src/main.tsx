import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { signOut } from "aws-amplify/auth";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { ApiError } from "./api/client";
import { configureAuth } from "./auth/amplify";
import "./index.css";
import { followSystemTheme } from "./lib/theme";
import { router } from "./router";

configureAuth();
followSystemTheme();

// 401(토큰 없음·만료·거부)이면 로컬 세션을 정리하고 RequireAuth가 로그인 화면으로 보내게 한다
let signingOut = false;
const onAuthError = (error: unknown) => {
  if (!(error instanceof ApiError && error.status === 401) || signingOut) return;
  signingOut = true;
  void signOut()
    .catch(() => undefined)
    .finally(() => {
      signingOut = false;
      void queryClient.resetQueries();
    });
};

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onAuthError }),
  mutationCache: new MutationCache({ onError: onAuthError }),
  defaultOptions: {
    queries: {
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
