import { createBrowserRouter } from "react-router";
import { GuestOnly, RequireAuth, RequireHost } from "./auth/guards";
import { AppLayout } from "./components/AppLayout";
import { AdminPage } from "./modules/admin/AdminPage";
import { BoardPage } from "./modules/boards/BoardPage";
import { BoardsPage } from "./modules/boards/BoardsPage";
import { ChecklistPage } from "./modules/checklists/ChecklistPage";
import { ChecklistsPage } from "./modules/checklists/ChecklistsPage";
import { HubPage } from "./modules/hub/HubPage";
import { AccountsPage } from "./modules/company/AccountsPage";
import { AssetDetailPage, AssetsPage } from "./modules/company/AssetsPage";
import { CompanyAuditPage } from "./modules/company/CompanyAuditPage";
import { CompanyMorePage } from "./modules/company/CompanyMorePage";
import { ItemsPage } from "./modules/company/ItemsPage";
import { MoneyPage } from "./modules/company/MoneyPage";
import { TxnNewPage } from "./modules/company/TxnNewPage";
import { TxnDetailPage, TxnsPage } from "./modules/company/TxnsPage";
import { PartnerDetailPage, PartnersPage } from "./modules/company/PartnersPage";
import { CompanyHomePage } from "./modules/company/CompanyHomePage";
import { CompanyLayout } from "./modules/company/CompanyLayout";
import { CompanyListPage } from "./modules/company/CompanyListPage";
import { CompanyMembersPage } from "./modules/company/CompanyMembersPage";
import { CompanySettingsPage } from "./modules/company/CompanySettingsPage";
import { InvitePage } from "./modules/company/InvitePage";
import { LedgerPage } from "./modules/ledger/LedgerPage";
import { NoteEditorPage } from "./modules/notes/NoteEditorPage";
import { NotesPage } from "./modules/notes/NotesPage";
import { ConfirmSignupPage } from "./modules/auth/ConfirmSignupPage";
import { ForgotPasswordPage } from "./modules/auth/ForgotPasswordPage";
import { LoginPage } from "./modules/auth/LoginPage";
import { MfaSetupPage } from "./modules/auth/MfaSetupPage";
import { SignupPage } from "./modules/auth/SignupPage";
import { HomePage } from "./modules/home/HomePage";
import { MenuPage } from "./modules/home/MenuPage";
import { NotFoundPage } from "./modules/home/NotFoundPage";
import { CalendarPage } from "./modules/calendar/CalendarPage";
import { HealthPage } from "./modules/health/HealthPage";
import { RequireModule } from "./modules/RequireModule";
import { TodoPage } from "./modules/todo/TodoPage";
import { SettingsPage } from "./modules/settings/SettingsPage";

export const router = createBrowserRouter([
  { path: "/login", element: <GuestOnly><LoginPage /></GuestOnly> },
  { path: "/signup", element: <GuestOnly><SignupPage /></GuestOnly> },
  { path: "/signup/confirm", element: <ConfirmSignupPage /> },
  { path: "/forgot-password", element: <ForgotPasswordPage /> },
  { path: "/invite/:code", element: <InvitePage /> },
  // 행컴퍼니 (docs/COMPANY.md): 회사 안은 행포털 메뉴 대신 회사 메뉴
  {
    path: "/company/:cid",
    element: <RequireAuth><CompanyLayout /></RequireAuth>,
    children: [
      { index: true, element: <CompanyHomePage /> },
      { path: "members", element: <CompanyMembersPage /> },
      { path: "audit", element: <CompanyAuditPage /> },
      { path: "settings", element: <CompanySettingsPage /> },
      { path: "partners", element: <PartnersPage /> },
      { path: "partners/:pid", element: <PartnerDetailPage /> },
      { path: "items", element: <ItemsPage /> },
      { path: "assets", element: <AssetsPage /> },
      { path: "assets/:aid", element: <AssetDetailPage /> },
      { path: "accounts", element: <AccountsPage /> },
      { path: "more", element: <CompanyMorePage /> },
      { path: "txns", element: <TxnsPage /> },
      { path: "txns/new", element: <TxnNewPage /> },
      { path: "txns/:day/:tid", element: <TxnDetailPage /> },
      { path: "money", element: <MoneyPage /> },
    ],
  },
  { path: "/mfa-setup", element: <RequireAuth><MfaSetupPage /></RequireAuth> },
  {
    element: <RequireAuth><AppLayout /></RequireAuth>,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "/menu", element: <MenuPage /> },
      { path: "/company", element: <CompanyListPage /> },
      { path: "/admin", element: <RequireHost><AdminPage /></RequireHost> },
      { path: "/todo", element: <RequireModule module="todo"><TodoPage /></RequireModule> },
      { path: "/calendar", element: <RequireModule module="calendar"><CalendarPage /></RequireModule> },
      { path: "/health", element: <RequireModule module="health"><HealthPage /></RequireModule> },
      { path: "/boards", element: <RequireModule module="boards"><BoardsPage /></RequireModule> },
      { path: "/boards/:id", element: <RequireModule module="boards"><BoardPage /></RequireModule> },
      { path: "/notes", element: <RequireModule module="notes"><NotesPage /></RequireModule> },
      { path: "/notes/:id", element: <RequireModule module="notes"><NoteEditorPage /></RequireModule> },
      { path: "/ledger", element: <RequireModule module="ledger"><LedgerPage /></RequireModule> },
      { path: "/hub", element: <RequireModule module="hub"><HubPage /></RequireModule> },
      { path: "/checklists", element: <RequireModule module="checklists"><ChecklistsPage /></RequireModule> },
      { path: "/checklists/:id", element: <RequireModule module="checklists"><ChecklistPage /></RequireModule> },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
]);
