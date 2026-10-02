import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ListChecksIcon, PlusIcon, UsersIcon, XIcon } from "lucide-react";
import { type ChecklistSummary, LIST_ICONS, useChecklistActions, useChecklists, useListTemplates } from "@/api/checklists";
import { useMe } from "@/api/me";
import { ConfirmButton } from "@/components/ConfirmButton";
import { NativeSelect } from "@/components/NativeSelect";
import { ROLE_LABEL } from "@/components/SharedMembersDialog";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FavoriteButton } from "@/modules/boards/BoardsPage";
import { IconPicker } from "./IconPicker";

/** DESIGN.md 5장 /checklists: 내가 참여한 공용 체크리스트 (즐겨찾기 먼저) */
export function ChecklistsPage() {
  const me = useMe();
  const lists = useChecklists();
  const templates = useListTemplates();
  const actions = useChecklistActions();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(LIST_ICONS[1] ?? "📝");
  const [templateId, setTemplateId] = useState("");
  const canCreate = me.data?.perms.checklists === "edit";

  const pickTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.data?.find((x) => x.id === id);
    if (t) {
      setIcon(t.icon);
      if (!name.trim()) setName(t.name);
    }
  };
  const sorted = [...(lists.data ?? [])].sort((a, b) => Number(b.favorite) - Number(a.favorite));

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4">
      <h1 className="flex items-center gap-2 text-xl font-semibold">
        <ListChecksIcon className="size-5 text-primary" />
        공용 체크리스트
      </h1>

      {canCreate && (
        <form
          className="grid gap-2 rounded-2xl border bg-card p-3"
          onSubmit={(e) => {
            e.preventDefault();
            actions.create.mutate({ name: name.trim(), icon, templateId: templateId || undefined }, { onSuccess: (l) => void navigate(`/checklists/${l.id}`) });
          }}
        >
          <div className="flex flex-wrap gap-2">
            <IconPicker value={icon} onChange={setIcon} />
            <Input placeholder="새 리스트 이름 (예: 장보기)" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} className="h-9 min-w-40 flex-1" />
            <Button type="submit" className="h-9" disabled={!name.trim() || actions.create.isPending}>
              <PlusIcon /> 만들기
            </Button>
          </div>
          {(templates.data?.length ?? 0) > 0 && (
            <NativeSelect value={templateId} onChange={(e) => pickTemplate(e.target.value)} aria-label="템플릿" className="justify-self-start">
              <option value="">빈 리스트</option>
              {templates.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  템플릿: {t.icon} {t.name} ({t.items.length}개)
                </option>
              ))}
            </NativeSelect>
          )}
        </form>
      )}
      <ErrorAlert error={actions.create.error ?? actions.setFavorite.error} />

      {lists.isPending ? (
        <InlineSpinner />
      ) : lists.isError ? (
        <ErrorAlert error={lists.error} />
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">{canCreate ? "아직 리스트가 없습니다. 위에서 만들고 가족·팀원을 초대해 보세요." : "초대받은 리스트가 없습니다."}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {sorted.map((l) => (
            <ListCard key={l.id} list={l} onFavorite={() => actions.setFavorite.mutate({ id: l.id, favorite: !l.favorite })} />
          ))}
        </ul>
      )}

      {canCreate && (templates.data?.length ?? 0) > 0 && (
        <section className="grid gap-1">
          <h2 className="text-sm font-medium">내 템플릿</h2>
          <ul className="flex flex-wrap gap-1">
            {templates.data?.map((t) => (
              <li key={t.id} className="flex items-center gap-1 rounded-full border py-0.5 pr-0.5 pl-2.5 text-xs">
                {t.icon} {t.name} <span className="text-muted-foreground">{t.items.length}개</span>
                <ConfirmButton size="icon-xs" variant="ghost" aria-label="템플릿 삭제" title="템플릿을 삭제할까요?" description={`"${t.name}" (이미 만든 리스트에는 영향 없음)`} confirmLabel="삭제" onConfirm={() => actions.deleteTemplate.mutateAsync(t.id)}>
                  <XIcon />
                </ConfirmButton>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function ListCard({ list: l, onFavorite }: { list: ChecklistSummary; onFavorite: () => void }) {
  const pct = l.total ? Math.round(((l.total - l.remaining) / l.total) * 100) : 0;
  return (
    <li className="relative">
      <Link to={`/checklists/${l.id}`} className="grid gap-2 rounded-2xl border bg-card p-4 pr-11 transition-colors hover:bg-muted/50">
        <span className="flex items-center gap-2">
          <span className="text-xl" aria-hidden>
            {l.icon}
          </span>
          <span className="truncate font-medium">{l.name}</span>
        </span>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{l.remaining === 0 && l.total > 0 ? "모두 완료" : `남은 항목 ${l.remaining}/${l.total}`}</span>
          <span className="flex items-center gap-1">
            <UsersIcon className="size-3" /> {l.memberCount}명
          </span>
          <span className="ml-auto">{ROLE_LABEL[l.role]}</span>
        </span>
      </Link>
      <FavoriteButton on={l.favorite} onClick={onFavorite} className="absolute top-3 right-2" />
    </li>
  );
}
