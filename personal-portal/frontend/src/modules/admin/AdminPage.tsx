import { useAdminUsers } from "@/api/admin";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AuditTab } from "./AuditTab";
import { PendingTab } from "./PendingTab";
import { PermissionsTab } from "./PermissionsTab";
import { PresetsTab } from "./PresetsTab";
import { UsersTab } from "./UsersTab";

/** DESIGN.md 4.4 관리자 화면 (Host 전용) */
export function AdminPage() {
  const pending = useAdminUsers("pending");
  const pendingCount = pending.data?.length ?? 0;

  return (
    <main className="mx-auto grid max-w-5xl gap-4 p-4">
      <h1 className="text-xl font-semibold">관리자</h1>
      <Tabs defaultValue="pending">
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="pending">
              승인 대기
              {pendingCount > 0 && <Badge variant="destructive">{pendingCount}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="users">계정</TabsTrigger>
            <TabsTrigger value="permissions">권한</TabsTrigger>
            <TabsTrigger value="presets">프리셋</TabsTrigger>
            <TabsTrigger value="audit">활동 로그</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="pending" className="pt-2">
          <PendingTab />
        </TabsContent>
        <TabsContent value="users" className="pt-2">
          <UsersTab />
        </TabsContent>
        <TabsContent value="permissions" className="pt-2">
          <PermissionsTab />
        </TabsContent>
        <TabsContent value="presets" className="pt-2">
          <PresetsTab />
        </TabsContent>
        <TabsContent value="audit" className="pt-2">
          <AuditTab />
        </TabsContent>
      </Tabs>
    </main>
  );
}
