import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ArrowLeftIcon, TagIcon } from "lucide-react";
import { LABEL_KINDS, type LabelKind, useAssets } from "@/api/company";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert, FormError, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCompanyOutlet } from "./CompanyLayout";
import { useDocFlow } from "./DocsPage";
import { AssetPicker } from "./TxnNewPage";
import { Field } from "./ui";

// 프린터마다 다른 설정은 이 기기(브라우저)에만 기억한다
const PREF = "labelPrefs";
type Prefs = { kind: LabelKind; nudgeX: string; nudgeY: string };
function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREF) ?? "{}") as Partial<Prefs>;
    return { kind: p.kind ?? "a4-21", nudgeX: p.nudgeX ?? "0", nudgeY: p.nudgeY ?? "0" };
  } catch {
    return { kind: "a4-21", nudgeX: "0", nudgeY: "0" };
  }
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREF, JSON.stringify(p));
  } catch {
    /* 저장 못 해도 출력은 된다 */
  }
}

/** 기기 라벨 출력 (COMPANY.md 7장): QR을 폰 카메라로 찍으면 기기 화면이 열린다. ?ids=a,b,c */
export function LabelsPage() {
  const { cid } = useCompanyOutlet();
  const [params] = useSearchParams();
  const assets = useAssets(cid);
  const flow = useDocFlow(cid);
  const [selected, setSelected] = useState<string[]>(() => (params.get("ids") ?? "").split(",").filter(Boolean));
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [start, setStart] = useState(0);
  const [outline, setOutline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kind = LABEL_KINDS.find((k) => k.id === prefs.kind)!;
  const set = (p: Partial<Prefs>) => {
    const next = { ...prefs, ...p };
    setPrefs(next);
    savePrefs(next);
  };
  const nudge = (v: string) => Math.max(-10, Math.min(10, Number(v) || 0));

  const print = () => {
    setError(null);
    if (selected.length === 0) return setError("라벨을 출력할 기기를 고르세요.");
    void flow.run(() => flow.mut.labels.mutateAsync({ assetIds: selected, kind: prefs.kind, start: kind.per ? start : 0, nudgeX: nudge(prefs.nudgeX), nudgeY: nudge(prefs.nudgeY), outline, baseUrl: location.origin }));
  };

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <Link to={`/company/${cid}/assets`} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeftIcon className="size-4" /> 기기
      </Link>
      <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
        <TagIcon className="size-5" /> 기기 라벨
      </h1>
      <p className="-mt-2 text-sm text-muted-foreground">QR을 폰 카메라로 찍으면 그 기기 화면이 열립니다 (직원 로그인 필요).</p>

      {assets.isPending ? (
        <InlineSpinner />
      ) : (
        <AssetPicker assets={(assets.data ?? []).filter((a) => a.status !== "retired")} selected={selected} onChange={setSelected} loading={false} empty="등록된 기기가 없습니다." />
      )}

      <section className="grid gap-3 rounded-2xl border bg-card p-4">
        <Field label="용지">
          <NativeSelect value={prefs.kind} onChange={(e) => (set({ kind: e.target.value as LabelKind }), setStart(0))} className="h-9">
            <optgroup label="A4 라벨지 (일반 프린터)">
              {LABEL_KINDS.filter((k) => k.per).map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="라벨 프린터 (한 장에 하나)">
              {LABEL_KINDS.filter((k) => !k.per).map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </optgroup>
          </NativeSelect>
        </Field>
        {kind.per && (
          <div className="grid gap-1.5">
            <p className="text-xs text-muted-foreground">시작할 칸 (이미 쓴 칸은 건너뜀) · 지금 {start + 1}번째 칸부터</p>
            <div className={cn("grid max-w-56 gap-1", kind.cols === 2 ? "grid-cols-2" : "grid-cols-3")}>
              {Array.from({ length: kind.per }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`${i + 1}번째 칸부터`}
                  onClick={() => setStart(i)}
                  className={cn("h-5 rounded border text-[9px]", i < start ? "bg-muted text-muted-foreground line-through" : i < start + selected.length ? "border-primary bg-primary/20" : "bg-card")}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Field label="위치 보정 가로 (mm, +오른쪽)">
            <Input inputMode="decimal" value={prefs.nudgeX} onChange={(e) => set({ nudgeX: e.target.value })} className="h-9" />
          </Field>
          <Field label="위치 보정 세로 (mm, +아래)">
            <Input inputMode="decimal" value={prefs.nudgeY} onChange={(e) => set({ nudgeY: e.target.value })} className="h-9" />
          </Field>
        </div>
        {kind.per && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={outline} onChange={(e) => setOutline(e.target.checked)} />
            칸 테두리 그리기 (빈 종이에 먼저 인쇄해서 맞춰 보기)
          </label>
        )}
        <p className="text-xs text-muted-foreground">인쇄할 때 "실제 크기(100%)"로 인쇄하세요. 위치 보정·용지는 이 기기에 기억됩니다.</p>
      </section>
      <FormError message={error} />
      <ErrorAlert error={flow.error} />
      <Button size="lg" disabled={flow.busy || selected.length === 0} onClick={print}>
        라벨 {selected.length}장 PDF 만들기
      </Button>
      {flow.sheet}
    </main>
  );
}
