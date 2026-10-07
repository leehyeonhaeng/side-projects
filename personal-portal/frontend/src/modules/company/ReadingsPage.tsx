import { useState } from "react";
import { Link } from "react-router";
import { CheckIcon } from "lucide-react";
import { ApiError } from "@/api/client";
import { type ReadingRow, useReadings, useRentalMutations } from "@/api/company";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { todayStr } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useCompanyOutlet } from "./CompanyLayout";
import { Chip, PageHead, Search, matches } from "./ui";

const needs = (r: ReadingRow) => !r.lastReading || r.lastReading.date <= r.billedReadAt;

/** 카운터 검침 (현장에서 폰으로): 카운터 과금 기기마다 흑백·컬러 카운터 입력 → 다음 청구의 초과 매수 */
export function ReadingsPage() {
  const { cid, detail } = useCompanyOutlet();
  const rows = useReadings(cid);
  const [date, setDate] = useState(todayStr());
  const [onlyNeeded, setOnlyNeeded] = useState(true);
  const [q, setQ] = useState("");
  const canEdit = detail.me.perms.assets === "edit";

  const shown = (rows.data ?? []).filter((r) => !onlyNeeded || needs(r)).filter((r) => matches([r.partnerName, r.code, r.itemName, r.contractNo].join(" "), q));
  const partners = [...new Set(shown.map((r) => r.partnerName))];

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <PageHead title="검침" sub="카운터 과금 기기의 카운터를 입력하면 다음 청구에 초과 매수가 계산됩니다" />
      <div className="flex flex-wrap items-center gap-2">
        <Search value={q} onChange={setQ} placeholder="거래처·기기 번호" />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          검침일
          <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-9 w-40" />
        </label>
      </div>
      <div className="flex gap-1">
        <Chip on={onlyNeeded} onClick={() => setOnlyNeeded(true)}>
          검침 필요 {(rows.data ?? []).filter(needs).length}
        </Chip>
        <Chip on={!onlyNeeded} onClick={() => setOnlyNeeded(false)}>
          전체 {rows.data?.length ?? 0}
        </Chip>
      </div>
      {rows.isPending ? (
        <InlineSpinner />
      ) : rows.isError ? (
        <ErrorAlert error={rows.error} />
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{onlyNeeded ? "검침할 기기가 없습니다. 지난 청구 이후 모두 검침했습니다." : "카운터 과금 계약 기기가 없습니다."}</p>
      ) : (
        partners.map((name) => (
          <section key={name} className="grid gap-1.5">
            <h2 className="text-xs font-medium text-muted-foreground">{name}</h2>
            {shown
              .filter((r) => r.partnerName === name)
              .map((r) => (
                <ReadingCard key={r.assetId} cid={cid} r={r} date={date} canEdit={canEdit} />
              ))}
          </section>
        ))
      )}
    </main>
  );
}

function ReadingCard({ cid, r, date, canEdit }: { cid: string; r: ReadingRow; date: string; canEdit: boolean }) {
  const mut = useRentalMutations(cid);
  const [mono, setMono] = useState("");
  const [color, setColor] = useState("");
  const [saved, setSaved] = useState(false);
  const last = r.lastReading;
  const n = (v: string) => Number(v.replace(/,/g, "")) || 0;
  const lower = mono !== "" && last && n(mono) < last.mono;
  const fixNeeded = mut.addReading.error instanceof ApiError && mut.addReading.error.status === 400 && String(mut.addReading.error.message).includes("lower");

  const save = (fix = false) =>
    mut.addReading.mutate(
      { assetId: r.assetId, date, mono: n(mono), ...(r.color ? { color: n(color) } : {}), fix },
      {
        onSuccess: () => {
          setSaved(true);
          setMono("");
          setColor("");
        },
      },
    );

  return (
    <div className={cn("grid gap-2 rounded-xl border bg-card p-3", saved && "border-emerald-500/50")}>
      <p className="flex items-center gap-2 text-sm">
        <Link to={`/company/${cid}/assets/${r.assetId}`} className="font-mono font-semibold">
          {r.code}
        </Link>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.itemName}</span>
        {saved && <CheckIcon className="size-4 text-emerald-600" />}
      </p>
      <p className="text-xs text-muted-foreground">
        {last ? `최근 ${last.date} · 흑백 ${last.mono.toLocaleString()}${r.color ? ` / 컬러 ${last.color.toLocaleString()}` : ""}` : "검침 기록 없음"}
        {last && ` · 지난 청구 이후 ${(last.mono - r.billedMono).toLocaleString()}매`}
      </p>
      {canEdit && (
        <form
          className={cn("grid gap-2", r.color ? "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1fr)_auto]")}
          onSubmit={(e) => {
            e.preventDefault();
            if (mono) save();
          }}
        >
          <Input inputMode="numeric" placeholder="흑백 카운터" aria-label={`${r.code} 흑백 카운터`} value={mono} onChange={(e) => (setMono(e.target.value.replace(/[^\d,]/g, "")), setSaved(false))} className="h-10" />
          {r.color && <Input inputMode="numeric" placeholder="컬러 카운터" aria-label={`${r.code} 컬러 카운터`} value={color} onChange={(e) => (setColor(e.target.value.replace(/[^\d,]/g, "")), setSaved(false))} className="h-10" />}
          <Button type="submit" className="h-10" disabled={!mono || mut.addReading.isPending}>
            저장
          </Button>
        </form>
      )}
      {lower && <p className="text-xs text-amber-600 dark:text-amber-400">최근 값보다 작습니다. 잘못 넣은 값을 고치는 경우만 "정정"하세요.</p>}
      {fixNeeded && (
        <Button size="xs" variant="outline" className="justify-self-start" onClick={() => save(true)}>
          정정으로 저장
        </Button>
      )}
      {!fixNeeded && <ErrorAlert error={mut.addReading.error} />}
    </div>
  );
}
