import { createBrowserRouter } from "react-router";
import { GuestOnly, RequireAuth, RequireHost } from "./auth/guards";
import { AppLayout } from "./components/AppLayout";
import { AdminPage } from "./modules/admin/AdminPage";
import { BoardPage } from "./modules/boards/BoardPage";
import { BoardsPage } from "./modules/boards/BoardsPage";
import { ConfirmSignupPage } from "./modules/auth/ConfirmSignupPage";
import { ForgotPasswordPage } from "./modules/auth/ForgotPasswordPage";
import { LoginPage } from "./modules/auth/LoginPage";
import { MfaSetupPage } from "./modules/auth/MfaSetupPage";
import { SignupPage } from "./modules/auth/SignupPage";
import { HomePage } from "./modules/home/HomePage";
import { NotFoundPage } from "./modules/home/NotFoundPage";
import { CalendarPage } from "./modules/calendar/CalendarPage";
import { HealthPage } from "./modules/health/HealthPage";
import { MODULES } from "./modules/meta";
import { RequireModule } from "./modules/RequireModule";
import { TodoPage } from "./modules/todo/TodoPage";
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
      { path: "/todo", element: <RequireModule module="todo"><TodoPage /></RequireModule> },
      { path: "/calendar", element: <RequireModule module="calendar"><CalendarPage /></RequireModule> },
      { path: "/health", element: <RequireModule module="health"><HealthPage /></RequireModule> },
      { path: "/boards", element: <RequireModule module="boards"><BoardsPage /></RequireModule> },
      { path: "/boards/:id", element: <RequireModule module="boards"><BoardPage /></RequireModule> },
      // 나머지 모듈 화면은 해당 Phase에서 실제 페이지로 바꾼다
      ...MODULES.filter((m) => !["todo", "calendar", "health", "boards"].includes(m.id)).map((m) => ({ path: m.path, element: <ModulePlaceholderPage module={m.id} /> })),
    ],
  },
  { path: "*", element: <NotFoundPage /> },
]);
