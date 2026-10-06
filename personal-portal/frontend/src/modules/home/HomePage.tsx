import { useState } from "react";
import { Link } from "react-router";
import { ArrowDownIcon, ArrowUpIcon, CalendarDaysIcon, EyeIcon, EyeOffIcon, Maximize2Icon, PencilIcon, PlusIcon, RepeatIcon, XIcon } from "lucide-react";
import { useEvents } from "@/api/events";
import { useMe } from "@/api/me";
import { type Layout, type LayoutItem, type Section, useLayout, useSaveLayout } from "@/api/preferences";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { todayStr } from "@/lib/dates";
import { MODULE_BY_ID } from "@/modules/meta";
import { formatDateTime } from "@/modules/admin/format";
import { AddItemDialog } from "./AddItemDialog";
import { applyPositions, defaultLayout, findSpot, isPermitted, newId } from "./layoutModel";
import { SectionGrid } from "./SectionGrid";
import { WIDGETS, WIDGET_BY_KEY, nextSize } from "./widgets";

/** DESIGN.md 4.3 홈 대시보드: 섹션별 4칸 그리드, 편집 모드에서 이동·크기·숨기기, 서버 저장 */
export function HomePage() {
  const me = useMe();
  const saved = useLayout();
  const save = useSaveLayout();
  const [draft, setDraft] = useState<Layout | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  if (!me.data || saved.isPending) return <InlineSpinner />;
  if (saved.isError) return <ErrorAlert error={saved.error} />;

  const perms = me.data.perms;
  const editing = draft !== null;
  const layout = draft ?? saved.data.layout ?? defaultLayout(perms);
  const visible = (s: Section) => s.items.filter((i) => isPermitted(i, perms) && !i.hidden);
  const hasAnyModule = Object.values(perms).some((l) => l !== "none");

  const update = (fn: (l: Layout) => Layout) => setDraft((d) => fn(d ?? layout));
  const updateSection = (id: string, fn: (s: Section) => Section) =>
    update((l) => ({ ...l, sections: l.sections.map((s) => (s.id === id ? fn(s) : s)) }));
  const updateItem = (id: string, fn: (i: LayoutItem) => LayoutItem) =>
    update((l) => ({ ...l, sections: l.sections.map((s) => ({ ...s, items: s.items.map((i) => (i.id === id ? fn(i) : i)) })) }));

  const selected = layout.sections.flatMap((s) => s.items).find((i) => i.id === selectedId);
  const selectedSection = layout.sections.find((s) => s.items.some((i) => i.id === selectedId));

  const startEdit = () => setDraft(layout);
  const cancel = () => {
    setDraft(null);
    setSelectedId(null);
  };
  const finish = () => {
    if (!draft) return;
    const normalized = { ...draft, sections: draft.sections.map((s) => ({ ...s, name: s.name.trim() || "섹션" })) };
    save.mutate(normalized, {
      onSuccess: () => {
        setDraft(null);
        setSelectedId(null);
      },
    });
  };

  const moveToSection = (item: LayoutItem, toId: string) =>
    update((l) => ({
      ...l,
      sections: l.sections.map((s) => {
        if (s.items.some((i) => i.id === item.id)) return { ...s, items: s.items.filter((i) => i.id !== item.id) };
        if (s.id === toId) return { ...s, items: [...s.items, { ...item, ...findSpot(visible(s), item.w, item.h) }] };
        return s;
      }),
    }));

  const moveSection = (index: number, delta: number) =>
    update((l) => {
      const sections = [...l.sections];
      const [s] = sections.splice(index, 1);
      if (s) sections.splice(index + delta, 0, s);
      return { ...l, sections };
    });

  return (
    <main className="mx-auto grid max-w-2xl gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight">{editing ? "홈 편집" : `${me.data.name}님, 안녕하세요`}</h1>
        {hasAnyModule && (
          <div className="flex gap-1">
            {editing ? (
              <>
                <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                  <PlusIcon data-icon="inline-start" />
                  추가
                </Button>
                <Button size="sm" variant="ghost" onClick={cancel}>
                  취소
                </Button>
                <Button size="sm" disabled={save.isPending} onClick={finish}>
                  완료
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={startEdit}>
                <PencilIcon data-icon="inline-start" />
                편집
              </Button>
            )}
          </div>
        )}
      </div>
      <ErrorAlert error={save.error} />
      {!editing && perms.calendar !== "none" && <TodayBanner />}

      {!hasAnyModule && <p className="text-sm text-muted-foreground">사용할 수 있는 모듈이 없습니다. 관리자에게 권한을 요청하세요.</p>}

      {hasAnyModule &&
        layout.sections.map((section, index) => {
          const items = visible(section);
          const hidden = section.items.filter((i) => isPermitted(i, perms) && i.hidden);
          if (!editing && items.length === 0) return null;
          return (
            <section key={section.id} className="grid gap-2">
              {editing ? (
                <div className="flex items-center gap-1">
                  <Input
                    aria-label="섹션 이름"
                    value={section.name}
                    maxLength={20}
                    onChange={(e) => updateSection(section.id, (s) => ({ ...s, name: e.target.value }))}
                    className="h-8 max-w-40"
                  />
                  <Button size="icon-sm" variant="ghost" aria-label="섹션 위로" disabled={index === 0} onClick={() => moveSection(index, -1)}>
                    <ArrowUpIcon />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label="섹션 아래로" disabled={index === layout.sections.length - 1} onClick={() => moveSection(index, 1)}>
                    <ArrowDownIcon />
                  </Button>
                  {/* 다른 사람 권한으로 안 보이는 항목까지 비어 있어야 지울 수 있다 */}
                  {section.items.length === 0 && layout.sections.length > 1 && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="섹션 삭제"
                      onClick={() => update((l) => ({ ...l, sections: l.sections.filter((s) => s.id !== section.id) }))}
                    >
                      <XIcon />
                    </Button>
                  )}
                </div>
              ) : (
                <h2 className="text-sm font-medium text-muted-foreground">{section.name}</h2>
              )}

              {items.length > 0 ? (
                <SectionGrid
                  items={items}
                  editing={editing}
                  selectedId={selectedId}
                  onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))}
                  onPositions={(positions) => updateSection(section.id, (s) => applyPositions(s, positions))}
                />
              ) : (
                <p className="rounded-2xl border border-dashed p-4 text-center text-xs text-muted-foreground">비어 있는 섹션</p>
              )}

              {editing && hidden.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  숨긴 항목
                  {hidden.map((i) => (
                    <Button
                      key={i.id}
                      size="xs"
                      variant="outline"
                      onClick={() => updateItem(i.id, (it) => ({ ...it, hidden: false, ...findSpot(items, it.w, it.h) }))}
                    >
                      <EyeIcon data-icon="inline-start" />
                      {itemLabel(i)}
                    </Button>
                  ))}
                </div>
              )}
            </section>
          );
        })}

      {editing && (
        <Button
          variant="outline"
          className="justify-self-start"
          disabled={layout.sections.length >= 10}
          onClick={() => update((l) => ({ ...l, sections: [...l.sections, { id: newId(), name: "새 섹션", items: [] }] }))}
        >
          <PlusIcon data-icon="inline-start" />
          섹션 추가
        </Button>
      )}

      {!editing && saved.data.updatedAt && (
        <p className="text-center text-[11px] text-muted-foreground">레이아웃 저장: {formatDateTime(saved.data.updatedAt)}</p>
      )}

      {/* 편집 중 선택한 항목의 작업 막대 (모바일 하단 바 위) */}
      {editing && selected && selectedSection && (
        <div className="fixed inset-x-0 bottom-16 z-20 mx-auto flex max-w-2xl flex-wrap items-center gap-1 border bg-background/95 p-2 shadow-lg backdrop-blur sm:bottom-4 sm:rounded-xl">
          <span className="mr-auto truncate px-1 text-sm font-medium">
            {itemLabel(selected)}
            {selected.kind === "icon" && <span className="ml-1 text-xs font-normal text-muted-foreground">1×1 고정</span>}
          </span>
          {(() => {
            // 아이콘 ↔ 위젯 바꾸기 (같은 모듈 아이콘·같은 종류 위젯은 하나씩만)
            const placed = layout.sections.flatMap((s) => s.items);
            if (selected.kind === "icon") {
              const widget = WIDGETS.find((w) => w.module === selected.module && !placed.some((p) => p.kind === "widget" && p.widget === w.key));
              return (
                widget && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => updateItem(selected.id, (i) => ({ ...i, kind: "widget", widget: widget.key, w: 1, h: 1 }))}
                  >
                    <RepeatIcon data-icon="inline-start" />
                    위젯으로
                  </Button>
                )
              );
            }
            const iconPlaced = placed.some((p) => p.kind === "icon" && p.module === selected.module);
            return (
              !iconPlaced && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => updateItem(selected.id, (i) => ({ ...i, kind: "icon", widget: undefined, w: 1, h: 1 }))}
                >
                  <RepeatIcon data-icon="inline-start" />
                  아이콘으로
                </Button>
              )
            );
          })()}
          {selected.kind === "widget" && selected.widget && WIDGET_BY_KEY[selected.widget] && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const def = WIDGET_BY_KEY[selected.widget!]!;
                updateItem(selected.id, (i) => ({ ...i, ...nextSize(def, i.w, i.h), x: Math.min(i.x, 2) }));
              }}
            >
              <Maximize2Icon data-icon="inline-start" />
              {selected.w}×{selected.h}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              updateItem(selected.id, (i) => ({ ...i, hidden: true }));
              setSelectedId(null);
            }}
          >
            <EyeOffIcon data-icon="inline-start" />
            숨기기
          </Button>
          {layout.sections.length > 1 && (
            <NativeSelect
              aria-label="섹션 이동"
              value={selectedSection.id}
              onChange={(e) => moveToSection(selected, e.target.value)}
              className="max-w-32"
            >
              {layout.sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}로 이동
                </option>
              ))}
            </NativeSelect>
          )}
        </div>
      )}

      {editing && (
        <AddItemDialog
          open={adding}
          onOpenChange={setAdding}
          layout={layout}
          perms={perms}
          onAdd={(sectionId, c) => {
            const id = newId();
            updateSection(sectionId, (s) => ({
              ...s,
              items: [...s.items, { id, kind: c.kind, module: c.module, widget: c.widget, w: c.w, h: c.h, ...findSpot(visible(s), c.w, c.h) }],
            }));
            setAdding(false);
            setSelectedId(id);
          }}
        />
      )}
    </main>
  );
}

function itemLabel(item: LayoutItem): string {
  const def = item.widget ? WIDGET_BY_KEY[item.widget] : undefined;
  return item.kind === "widget" ? `${def?.title ?? MODULE_BY_ID[item.module].label} 위젯` : `${MODULE_BY_ID[item.module].label} 아이콘`;
}

/** DESIGN.md 6.1 알림: 앱을 열었을 때 "오늘 일정" 표시 */
function TodayBanner() {
  const today = todayStr();
  const events = useEvents(today, today);
  const list = (events.data ?? []).filter((e) => e.start <= today && e.end >= today);
  if (list.length === 0) return null;
  return (
    <Link to="/calendar" className="flex items-center gap-2 rounded-xl border bg-primary/5 px-3 py-2 text-sm hover:bg-primary/10">
      <CalendarDaysIcon className="size-4 shrink-0 text-primary" />
      <span className="font-medium">오늘 일정 {list.length}개</span>
      <span className="truncate text-muted-foreground">
        {list
          .slice(0, 2)
          .map((e) => (e.allDay ? e.title : `${e.startTime} ${e.title}`))
          .join(" · ")}
      </span>
    </Link>
  );
}
