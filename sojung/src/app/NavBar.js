import { countUnread } from "@/lib/notifications";
import { getLoginPasswordHash } from "@/lib/settings";
import NavBarClient from "@/app/NavBarClient";

export default function NavBar() {
  const unread = countUnread();
  const hasPassword = !!getLoginPasswordHash();
  return <NavBarClient unread={unread} hasPassword={hasPassword} />;
}
