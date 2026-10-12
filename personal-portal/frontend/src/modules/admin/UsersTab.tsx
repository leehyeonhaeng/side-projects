import { useState } from "react";
import {
  type AdminUser,
  type IssuedAccount,
  type UserStatus,
  useAdminUsers,
  useCreateAccount,
  useDeleteUser,
  usePresets,
  useReactivate,
  useResetPassword,
  useSuspend,
} from "@/api/admin";
import { ConfirmButton } from "@/components/ConfirmButton";
import { CredentialsCard } from "@/components/CredentialsCard";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert, FormError, InlineSpinner } from "@/components/states";
import { Input } from "@/components/ui/input";
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
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<IssuedAccount | null>(null);

  return (
    <div className="grid gap-3">
      {issued ? (
        <CredentialsCard heading="[행포털] 계정" label={`${issued.name ? `${issued.name}님 ` : ""}계정 정보`} sub={issued.presetName} email={issued.email} password={issued.temporaryPassword} onClose={() => setIssued(null)} />
      ) : creating ? (
        <NewAccountForm onDone={(a) => (setCreating(false), setIssued(a))} onCancel={() => setCreating(false)} />
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3">
          <p className="min-w-0 flex-1 text-sm">인증 메일·승인 없이 바로 쓰는 계정을 만들어 아이디·임시 비밀번호를 전해 줄 수 있습니다.</p>
          <Button size="sm" onClick={() => setCreating(true)}>
            계정 만들어 주기
          </Button>
        </div>
      )}
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
                <UserRow key={u.sub} user={u} onIssued={setIssued} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function UserRow({ user, onIssued }: { user: AdminUser; onIssued: (a: IssuedAccount) => void }) {
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
              title="임시 비밀번호로 초기화할까요?"
              description={`${user.email} — 지금 비밀번호는 더 이상 쓸 수 없습니다. 화면에 나오는 임시 비밀번호를 전해 주면, 그걸로 로그인해 새 비밀번호를 정합니다 (메일은 보내지 않음).`}
              confirmLabel="초기화"
              onConfirm={() => reset.mutateAsync(user.sub).then((r) => onIssued({ ...r, name: user.name }))}
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

function NewAccountForm({ onDone, onCancel }: { onDone: (a: IssuedAccount) => void; onCancel: () => void }) {
  const presets = usePresets();
  const create = useCreateAccount();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [presetId, setPresetId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const list = presets.data ?? [];
  const chosen = presetId || list.find((p) => p.id === "family")?.id || list[0]?.id || "";
  return (
    <form
      className="grid gap-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (!name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError("이름과 올바른 이메일을 넣으세요.");
        if (!chosen) return setError("권한 프리셋을 고르세요.");
        create.mutate({ name: name.trim(), email: email.trim(), presetId: chosen, note: note.trim() }, { onSuccess: (r) => onDone({ ...r, presetName: list.find((p) => p.id === chosen)?.name ?? r.presetName }) });
      }}
    >
      <p className="text-sm font-medium">행포털 계정 만들어 주기</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs text-muted-foreground">
          이름
          <Input id="new-acc-name" maxLength={50} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          이메일 (로그인 아이디)
          <Input id="new-acc-email" type="email" autoComplete="off" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          권한 프리셋
          <NativeSelect id="new-acc-preset" value={chosen} onChange={(e) => setPresetId(e.target.value)} className="h-9">
            {list.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          메모 (선택)
          <Input id="new-acc-note" maxLength={100} value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 가족, 고객사 시험용" />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">인증 메일·가입 승인 없이 바로 활성 계정이 됩니다. 만들면 임시 비밀번호가 한 번 나오고, 처음 로그인할 때 새 비밀번호를 정합니다 (7일 안에). 회사 직원으로 넣으려면 행컴퍼니 → 직원·권한에서 만드세요.</p>
      <FormError message={error} />
      <ErrorAlert error={create.error ?? presets.error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={create.isPending || presets.isPending}>
          만들기
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          취소
        </Button>
      </div>
    </form>
  );
}
