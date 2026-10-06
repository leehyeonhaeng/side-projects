import { useState } from "react";
import { CheckIcon, ChevronDownIcon, CopyIcon, EyeOffIcon, Share2Icon } from "lucide-react";
import {
  AREAS,
  type AreaLevel,
  type AreaPerms,
  type CompanyMember,
  type CompanyRole,
  type Invite,
  LEVEL_LABEL,
  inviteUrl,
  useCompanyMembers,
  useCompanyMutations,
  useCompanyRoles,
  useInvites,
} from "@/api/company";
import { useMe } from "@/api/me";
import { copyText } from "@/api/hub";
import { ConfirmButton } from "@/components/ConfirmButton";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useCompanyOutlet } from "./CompanyLayout";

/** 직원·권한 (COMPANY.md 8장, 관리자만): 직원 / 초대 / 역할 */
export function CompanyMembersPage() {
  const { cid, detail } = useCompanyOutlet();
  const isAdmin = detail.me.isAdmin;
  const roles = useCompanyRoles(cid, isAdmin);

  if (!isAdmin) return <main className="p-4 text-sm text-muted-foreground">회사 관리자만 볼 수 있습니다.</main>;
  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <h1 className="text-xl font-bold tracking-tight">직원·권한</h1>
      {roles.isPending ? (
        <InlineSpinner />
      ) : roles.isError ? (
        <ErrorAlert error={roles.error} />
      ) : (
        <Tabs defaultValue="members">
          <TabsList>
            <TabsTrigger value="members">직원</TabsTrigger>
            <TabsTrigger value="invites">초대</TabsTrigger>
            <TabsTrigger value="roles">역할</TabsTrigger>
          </TabsList>
          <TabsContent value="members" className="pt-3">
            <Members cid={cid} roles={roles.data} />
          </TabsContent>
          <TabsContent value="invites" className="pt-3">
            <Invites cid={cid} roles={roles.data} />
          </TabsContent>
          <TabsContent value="roles" className="pt-3">
            <Roles cid={cid} roles={roles.data} />
          </TabsContent>
        </Tabs>
      )}
    </main>
  );
}

function Members({ cid, roles }: { cid: string; roles: CompanyRole[] }) {
  const members = useCompanyMembers(cid, true);
  const mut = useCompanyMutations(cid);
  const me = useMe();
  const [open, setOpen] = useState<string | null>(null);
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? id;

  if (members.isPending) return <InlineSpinner />;
  if (members.isError) return <ErrorAlert error={members.error} />;
  return (
    <div className="grid gap-2">
      <ul className="grid gap-2">
        {members.data.map((m) => (
          <li key={m.sub} className="grid gap-2 rounded-2xl border bg-card p-3">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {m.name || m.email} {m.sub === me.data?.sub && <span className="text-xs text-muted-foreground">(나)</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {m.email} · {m.isAdmin ? "관리자" : roleName(m.roleId)}
                  {!m.showAmounts && " · 금액 숨김"}
                </p>
              </div>
              <Button size="xs" variant="ghost" onClick={() => setOpen(open === m.sub ? null : m.sub)} aria-expanded={open === m.sub}>
                권한 <ChevronDownIcon className={cn("transition-transform", open === m.sub && "rotate-180")} />
              </Button>
            </div>
            {open === m.sub && <MemberEditor member={m} roles={roles} mut={mut} self={m.sub === me.data?.sub} />}
          </li>
        ))}
      </ul>
      <ErrorAlert error={mut.patchMember.error ?? mut.removeMember.error} />
    </div>
  );
}

function MemberEditor({ member: m, roles, mut, self }: { member: CompanyMember; roles: CompanyRole[]; mut: ReturnType<typeof useCompanyMutations>; self: boolean }) {
  const [perms, setPerms] = useState<AreaPerms>(m.perms);
  const dirty = AREAS.some((a) => perms[a.id] !== m.perms[a.id]);
  return (
    <div className="grid gap-3 border-t pt-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          역할
          <NativeSelect value={m.roleId} onChange={(e) => mut.patchMember.mutate({ sub: m.sub, roleId: e.target.value })}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4 accent-primary" checked={m.showAmounts} onChange={(e) => mut.patchMember.mutate({ sub: m.sub, showAmounts: e.target.checked })} />
          금액 보기
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4 accent-primary" checked={m.isAdmin} onChange={(e) => mut.patchMember.mutate({ sub: m.sub, isAdmin: e.target.checked })} />
          관리자
        </label>
      </div>
      <p className="text-xs text-muted-foreground">역할을 바꾸면 그 역할의 권한으로 바뀝니다. 아래에서 이 직원만 따로 조정할 수 있습니다.</p>
      <PermGrid perms={perms} onChange={setPerms} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!dirty || mut.patchMember.isPending} onClick={() => mut.patchMember.mutate({ sub: m.sub, perms })}>
          권한 저장
        </Button>
        <ConfirmButton
          size="sm"
          variant="ghost"
          className="ml-auto"
          title={self ? "회사에서 나갈까요?" : "직원을 내보낼까요?"}
          description={`${m.name || m.email} — 회사 화면에 더 이상 들어올 수 없습니다. 행포털 계정은 그대로입니다.`}
          confirmLabel={self ? "나가기" : "내보내기"}
          onConfirm={() => mut.removeMember.mutateAsync(m.sub)}
        >
          {self ? "나가기" : "내보내기"}
        </ConfirmButton>
      </div>
    </div>
  );
}

function PermGrid({ perms, onChange, disabled }: { perms: AreaPerms; onChange: (p: AreaPerms) => void; disabled?: boolean }) {
  return (
    <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
      {AREAS.map((a) => (
        <label key={a.id} className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate">{a.label}</span>
          <NativeSelect value={perms[a.id]} disabled={disabled} onChange={(e) => onChange({ ...perms, [a.id]: e.target.value as AreaLevel })} className={cn(perms[a.id] === "none" && "text-muted-foreground")}>
            {(["none", "view", "edit"] as const).map((l) => (
              <option key={l} value={l}>
                {LEVEL_LABEL[l]}
              </option>
            ))}
          </NativeSelect>
        </label>
      ))}
    </div>
  );
}

function Invites({ cid, roles }: { cid: string; roles: CompanyRole[] }) {
  const invites = useInvites(cid, true);
  const mut = useCompanyMutations(cid);
  const [roleId, setRoleId] = useState(roles.find((r) => r.id === "field")?.id ?? roles[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [created, setCreated] = useState<Invite | null>(null);

  return (
    <div className="grid gap-4">
      <form
        className="grid gap-3 rounded-2xl border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          mut.createInvite.mutate({ roleId, note: note.trim() }, { onSuccess: (inv) => (setCreated(inv), setNote("")) });
        }}
      >
        <p className="text-sm font-medium">초대 링크 만들기</p>
        <div className="flex flex-wrap gap-2">
          <NativeSelect value={roleId} onChange={(e) => setRoleId(e.target.value)} className="h-9" aria-label="역할">
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
          <Input placeholder="누구 초대인지 메모 (예: 김기사)" maxLength={60} value={note} onChange={(e) => setNote(e.target.value)} className="h-9 min-w-40 flex-1" />
          <Button type="submit" className="h-9" disabled={!roleId || mut.createInvite.isPending}>
            만들기
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">링크는 한 사람이 한 번만 쓸 수 있고 7일 뒤 만료됩니다. 받은 사람이 링크로 가입하면 승인 없이 바로 이 회사 직원이 됩니다.</p>
        {created && <InviteLink invite={created} highlight />}
        <ErrorAlert error={mut.createInvite.error} />
      </form>

      <section className="grid gap-2">
        <h2 className="text-sm font-medium">사용 전 초대</h2>
        {invites.isPending ? (
          <InlineSpinner />
        ) : invites.data?.length ? (
          <ul className="grid gap-2">
            {invites.data.map((i) => (
              <li key={i.code} className="grid gap-2 rounded-xl border bg-card p-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {i.note || "메모 없음"} <span className="text-xs text-muted-foreground">· {i.roleName} · {formatTime(new Date(i.expiresAt * 1000).toISOString())}까지</span>
                  </span>
                  <ConfirmButton size="xs" variant="ghost" title="초대를 취소할까요?" description="이 링크로는 더 이상 가입할 수 없습니다." confirmLabel="취소하기" onConfirm={() => mut.deleteInvite.mutateAsync(i.code)}>
                    취소
                  </ConfirmButton>
                </div>
                <InviteLink invite={i} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">사용 전 초대가 없습니다.</p>
        )}
      </section>
    </div>
  );
}

function InviteLink({ invite, highlight }: { invite: Invite; highlight?: boolean }) {
  const [copied, setCopied] = useState(false);
  const url = inviteUrl(invite.code);
  const canShare = typeof navigator !== "undefined" && "share" in navigator;
  return (
    <div className={cn("flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 p-2", highlight && "ring-2 ring-primary/40")}>
      <code className="min-w-0 flex-1 truncate text-xs">{url}</code>
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={async () => {
          if (await copyText(url)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />} {copied ? "복사됨" : "복사"}
      </Button>
      {canShare && (
        <Button type="button" size="xs" variant="outline" onClick={() => void navigator.share({ title: `${invite.companyName} 초대`, text: `${invite.companyName}에 ${invite.roleName}(으)로 초대합니다.`, url }).catch(() => undefined)}>
          <Share2Icon /> 공유
        </Button>
      )}
    </div>
  );
}

function Roles({ cid, roles }: { cid: string; roles: CompanyRole[] }) {
  const mut = useCompanyMutations(cid);
  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">역할은 초대하거나 역할을 바꿀 때 채워지는 기본 권한입니다. 고쳐도 이미 그 역할인 직원의 권한은 그대로입니다.</p>
      {roles.map((r) => (
        <RoleCard key={r.id} role={r} mut={mut} />
      ))}
      <ErrorAlert error={mut.putRole.error} />
    </div>
  );
}

function RoleCard({ role, mut }: { role: CompanyRole; mut: ReturnType<typeof useCompanyMutations> }) {
  const [name, setName] = useState(role.name);
  const [perms, setPerms] = useState(role.perms);
  const [showAmounts, setShowAmounts] = useState(role.showAmounts);
  const locked = role.isAdmin;
  const dirty = name !== role.name || showAmounts !== role.showAmounts || AREAS.some((a) => perms[a.id] !== role.perms[a.id]);
  return (
    <section className="grid gap-3 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={name} readOnly={locked} maxLength={20} onChange={(e) => setName(e.target.value)} className="h-8 w-40 font-medium" aria-label="역할 이름" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" disabled={locked} checked={showAmounts} onChange={(e) => setShowAmounts(e.target.checked)} />
          금액 보기
        </label>
        {!showAmounts && <EyeOffIcon className="size-4 text-muted-foreground" aria-label="금액 숨김" />}
        {locked && <span className="text-xs text-muted-foreground">관리자 역할은 모든 권한 (변경 불가)</span>}
      </div>
      <PermGrid perms={perms} onChange={setPerms} disabled={locked} />
      {!locked && (
        <Button size="sm" className="justify-self-start" disabled={!dirty || !name.trim() || mut.putRole.isPending} onClick={() => mut.putRole.mutate({ id: role.id, name: name.trim(), showAmounts, perms })}>
          역할 저장
        </Button>
      )}
    </section>
  );
}
