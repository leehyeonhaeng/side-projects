import { createBrowserRouter } from "react-router";
import { GuestOnly, RequireAuth, RequireHost } from "./auth/guards";
import { AppLayout } from "./components/AppLayout";
import { AdminPage } from "./modules/admin/AdminPage";
import { ConfirmSignupPage } from "./modules/auth/ConfirmSignupPage";
import { ForgotPasswordPage } from "./modules/auth/ForgotPasswordPage";
import { LoginPage } from "./modules/auth/LoginPage";
import { MfaSetupPage } from "./modules/auth/MfaSetupPage";
import { SignupPage } from "./modules/auth/SignupPage";
import { HomePage } from "./modules/home/HomePage";
import { NotFoundPage } from "./modules/home/NotFoundPage";
import { MODULES } from "./modules/meta";
import { ModulePlaceholderPage } from "./modules/ModulePlaceholderPage";
import { SettingsPage } from "./modules/settings/SettingsPage";

export const router = createBrowserRouter([
  { path: "/login", element: <GuestOnly><LoginPage /></GuestOnly> },
  { path: "/signup", element: <GuestOnly><SignupPage /></GuestOnly> },
  { path: "/signup/confirm", element: <ConfirmSignupPage /> },
  { path: "/forgot-password", element: <ForgotPasswordPage /> },
  { path: "/mfa-setup", element: <RequireAuth><MfaSetupPage /></RequireAuth> },
  {
    element: <RequireAuth><AppLayout /></RequireAuth>,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "/admin", element: <RequireHost><AdminPage /></RequireHost> },
      // 각 모듈 화면은 해당 Phase에서 실제 페이지로 바꾼다
      ...MODULES.map((m) => ({ path: m.path, element: <ModulePlaceholderPage module={m.id} /> })),
    ],
  },
  { path: "*", element: <NotFoundPage /> },
]);
