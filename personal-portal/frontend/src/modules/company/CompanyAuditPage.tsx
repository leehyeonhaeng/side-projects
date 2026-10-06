import { actionLabel, useCompanyAudit } from "@/api/company";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { formatTime } from "@/lib/dates";
import { useCompanyOutlet } from "./CompanyLayout";

/** 회사 활동 기록 (COMPANY.md 3장: 모든 변경을 남긴다). 관리자만, 최근 200개 */
export function CompanyAuditPage() {
  const { cid, detail } = useCompanyOutlet();
  const logs = useCompanyAudit(cid, detail.me.isAdmin);

  if (!detail.me.isAdmin) return <main className="p-4 text-sm text-muted-foreground">회사 관리자만 볼 수 있습니다.</main>;
  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <h1 className="text-xl font-bold tracking-tight">활동 기록</h1>
      {logs.isPending ? (
        <InlineSpinner />
      ) : logs.isError ? (
        <ErrorAlert error={logs.error} />
      ) : logs.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">기록이 없습니다.</p>
      ) : (
        <ul className="grid divide-y overflow-hidden rounded-2xl border bg-card">
          {logs.data.map((l, i) => (
            <li key={`${l.at}-${i}`} className="grid gap-0.5 px-4 py-2.5 text-sm">
              <span>
                <b className="font-medium">{l.actorName || "(알 수 없음)"}</b> {actionLabel(l.action)}
                {l.targetName && l.target !== l.actor && <span className="text-muted-foreground"> → {l.targetName}</span>}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatTime(l.at)}
                {detailText(l.detail) && ` · ${detailText(l.detail)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function detailText(d: Record<string, unknown>): string {
  return Object.entries(d)
    .filter(([, v]) => v !== "" && v !== null && v !== undefined)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
    .join(" · ")
    .slice(0, 120);
}
