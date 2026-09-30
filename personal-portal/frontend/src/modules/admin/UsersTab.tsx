import { useState } from "react";
import {
  type AdminUser,
  type UserStatus,
  useAdminUsers,
  useDeleteUser,
  useReactivate,
  useResetPassword,
  useSuspend,
} from "@/api/admin";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { STATUS_LABEL, formatDateTime } from "./format";

const FILTERS: { value: UserStatus | undefined; label: string }[] = [
  { value: undefined, label: "전체" },
  { value: "pending", label: "승인 대기" },
  { value: "active", label: "활성" },
  { value: "suspended", label: "정지" },
];

export function UsersTab() {
  const [status, setStatus] = useState<UserStatus | undefined>();
  const users = useAdminUsers(status);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <Button key={f.label} size="sm" variant={status === f.value ? "default" : "outline"} onClick={() => setStatus(f.value)}>
            {f.label}
          </Button>
        ))}
      </div>
      {users.isPending ? (
        <InlineSpinner />
      ) : users.isError ? (
        <ErrorAlert error={users.error} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>이름</TableHead>
                <TableHead>이메일</TableHead>
                <TableHead>상태</TableHead>
                <TableHead>가입일</TableHead>
                <TableHead className="text-right">관리</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.data.map((u) => (
                <UserRow key={u.sub} user={u} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function UserRow({ user }: { user: AdminUser }) {
  const suspend = useSuspend();
  const reactivate = useReactivate();
  const reset = useResetPassword();
  const remove = useDeleteUser();
  const isHost = user.role === "host";
  const error = suspend.error ?? reactivate.error ?? reset.error ?? remove.error;

  return (
    <TableRow>
      <TableCell className="font-medium">{user.name}</TableCell>
      <TableCell>{user.email}</TableCell>
      <TableCell>
        <div className="flex gap-1">
          <Badge variant={user.status === "active" ? "secondary" : user.status === "pending" ? "outline" : "destructive"}>
            {STATUS_LABEL[user.status]}
          </Badge>
          {isHost && <Badge>Host</Badge>}
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">{formatDateTime(user.createdAt)}</TableCell>
      <TableCell>
        {!isHost && user.status !== "pending" && (
          <div className="flex justify-end gap-1">
            {user.status === "active" ? (
              <ConfirmButton
                size="sm"
                variant="outline"
                title="계정을 정지할까요?"
                description={`${user.email}은(는) 즉시 로그아웃되고 로그인할 수 없게 됩니다.`}
                confirmLabel="정지"
                onConfirm={() => suspend.mutateAsync(user.sub)}
              >
                정지
              </ConfirmButton>
            ) : (
              <Button size="sm" variant="outline" disabled={reactivate.isPending} onClick={() => reactivate.mutate(user.sub)}>
                재활성
              </Button>
            )}
            <ConfirmButton
              size="sm"
              variant="outline"
              title="비밀번호를 초기화할까요?"
              description={`${user.email}로 인증 코드가 발송되고, 다음 로그인 때 새 비밀번호를 정해야 합니다.`}
              confirmLabel="초기화"
              onConfirm={() => reset.mutateAsync(user.sub)}
            >
              비밀번호 초기화
            </ConfirmButton>
            <ConfirmButton
              size="sm"
              variant="destructive"
              title="계정을 삭제할까요?"
              description={`${user.email} 계정과 개인 데이터가 모두 삭제되며 되돌릴 수 없습니다.`}
              confirmLabel="삭제"
              onConfirm={() => remove.mutateAsync(user.sub)}
            >
              삭제
            </ConfirmButton>
          </div>
        )}
        {error && <p className="text-right text-xs text-destructive">{error.message}</p>}
      </TableCell>
    </TableRow>
  );
}
