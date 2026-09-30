import { useState } from "react";
import { type AdminUser, useAdminUsers, useApprove, usePresets, useReject } from "@/api/admin";
import { ConfirmButton } from "@/components/ConfirmButton";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "./format";

export function PendingTab() {
  const users = useAdminUsers("pending");
  const presets = usePresets();

  if (users.isPending || presets.isPending) return <InlineSpinner />;
  if (users.isError || presets.isError) return <ErrorAlert error={users.error ?? presets.error} />;
  if (users.data.length === 0) return <p className="text-sm text-muted-foreground">승인 대기 중인 가입 신청이 없습니다.</p>;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {users.data.map((u) => (
        <PendingCard key={u.sub} user={u} presets={presets.data} />
      ))}
    </div>
  );
}

function PendingCard({ user, presets }: { user: AdminUser; presets: { id: string; name: string }[] }) {
  const [presetId, setPresetId] = useState(presets[0]?.id ?? "");
  const approve = useApprove();
  const reject = useReject();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{user.name}</CardTitle>
        <CardDescription>
          {user.email} · {formatDateTime(user.createdAt)}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {user.signupNote && <p className="rounded-md bg-muted p-2 text-sm">{user.signupNote}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect aria-label="권한 프리셋" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
          <Button disabled={!presetId || approve.isPending} onClick={() => approve.mutate({ sub: user.sub, presetId })}>
            승인
          </Button>
          <ConfirmButton
            variant="outline"
            title="가입을 거절할까요?"
            description={`${user.email} 계정과 가입 정보가 삭제됩니다. 같은 이메일로 다시 가입할 수 있습니다.`}
            confirmLabel="거절"
            onConfirm={() => reject.mutateAsync(user.sub)}
          >
            거절
          </ConfirmButton>
        </div>
        <ErrorAlert error={approve.error ?? reject.error} />
      </CardContent>
    </Card>
  );
}
