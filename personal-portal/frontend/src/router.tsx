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
      { path: "/admin", element: <RequireHost><AdminPage /></RequireHost> },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
]);
