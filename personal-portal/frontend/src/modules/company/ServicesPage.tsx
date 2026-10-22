import { type ReactNode, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ArrowLeftIcon, CheckIcon, FileTextIcon, HistoryIcon, PlusIcon, SirenIcon, Trash2Icon, XIcon } from "lucide-react";
import {
  CONSUMABLES,
  INSTALL_SUBTYPES,
  SERVICE_METHODS,
  SERVICE_STATUS_LABEL,
  type Service,
  type ServiceFields,
  type ServiceHistory,
  type ServiceStatus,
  serviceLabel,
  serviceTypesOf,
  useAssets,
  useContracts,
  useItems,
  usePartners,
  useRentalMutations,
  useService,
  useServices,
  useStaff,
} from "@/api/company";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert, FormError, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDay, formatTime, todayStr } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useCompanyOutlet } from "./CompanyLayout";
import { useDocFlow } from "./DocsPage";
import { type DraftLine, TxnLinesEditor, newLine, toLineInput } from "./TxnLinesEditor";
import { TxnRow } from "./TxnsPage";
import { Chip, Field, PageHead, Search, matches } from "./ui";

/** 서비스 접수 (C8): 고장·점검·설치·원격 … 접수 → 진행 → 완료. 목록·홈 현황판에서 줄을 누르면 팝업으로 열린다 */

const TONE: Record<ServiceStatus, string> = {
  open: "bg-orange-100 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300",
  in_progress: "bg-sky-100 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300",
  done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
  canceled: "bg-zinc-200 text-zinc-500 line-through dark:bg-zinc-500/20",
};
export const ACTIVE: ServiceStatus[] = ["open", "in_progress"];
const isActive = (s: Pick<Service, "status">) => ACTIVE.includes(s.status);

export function ServiceBadge({ s }: { s: Pick<Service, "status" | "needsBilling" | "urgent"> }) {
  return (
    <>
      {s.urgent && isActive(s) && <span className="shrink-0 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">긴급</span>}
      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", TONE[s.status])}>{SERVICE_STATUS_LABEL[s.status]}</span>
      {s.needsBilling && <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-400/15 dark:text-red-300">청구 필요</span>}
    </>
  );
}

/** "10. 22. 14:00" / "10월 22일 (수)" */
export const visitLabel = (v?: string) => (!v ? "" : v.includes("T") ? formatTime(`${v}:00+09:00`) : formatDay(v));

/** 경과: 접수부터 지금(또는 완료)까지 */
export function elapsed(from: string, to?: string) {
  const min = Math.max(0, Math.round(((to ? new Date(to) : new Date()).getTime() - new Date(from).getTime()) / 60000));
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 ${min % 60}분`;
  return `${Math.floor(h / 24)}일 ${h % 24}시간`;
}

/** 거래처 화면 등에서 쓰는 한 줄 */
export function ServiceRow({ cid, s }: { cid: string; s: Service }) {
  return (
    <Link to={`/company/${cid}/services/${s.id}`} className={cn("flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 hover:bg-muted/50", s.status === "canceled" && "opacity-60")}>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <ServiceBadge s={s} />
          <span className="shrink-0 text-xs text-muted-foreground">{serviceLabel(s)}</span>
          <span className="truncate text-sm font-medium">{s.partnerName}</span>
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {s.no} · {[s.assetCode, s.symptom].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className="shrink-0 text-right text-xs text-muted-foreground">
        {formatDay(s.done?.date ?? s.date)}
        {s.assigneeName && <span className="block">{s.assigneeName}</span>}
      </span>
    </Link>
  );
}

/** 고객이 정한 칸 순서: 상태 · 장비번호(시리얼) · 거래처명 · 부서 · 판매구분 · 접수 내용 · 접수자 · 접수 시간 (+ 담당·방문 / 완료 시간·완료 직원) */
export function ServiceTable({ rows, onOpen, done = false, showType = false }: { rows: Service[]; onOpen: (id: string) => void; done?: boolean; showType?: boolean }) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium [&>th]:whitespace-nowrap">
              <th>상태</th>
              {showType && <th>유형</th>}
              <th>장비번호</th>
              <th>거래처명</th>
              <th>부서</th>
              <th>판매구분</th>
              <th>접수 내용</th>
              <th>접수자</th>
              <th>접수 시간</th>
              {done ? (
                <>
                  <th>완료 시간</th>
                  <th>완료 직원</th>
                </>
              ) : (
                <>
                  <th>담당</th>
                  <th>방문 요청</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} onClick={() => onOpen(s.id)} className={cn("cursor-pointer border-t hover:bg-muted/40 [&>td]:px-2 [&>td]:py-2 [&>td]:align-top", s.status === "canceled" && "opacity-60", s.urgent && isActive(s) && "bg-red-50/60 dark:bg-red-400/5")}>
                <td className="whitespace-nowrap">
                  <span className="flex gap-1">
                    <ServiceBadge s={s} />
                  </span>
                </td>
                {showType && <td className="whitespace-nowrap text-xs">{serviceLabel(s)}</td>}
                <td className="whitespace-nowrap">
                  {s.assetCode ?? "—"}
                  {s.assetSerial && <span className="block text-[11px] text-muted-foreground">{s.assetSerial}</span>}
                </td>
                <td className="max-w-40 truncate font-medium">{s.partnerName}</td>
                <td className="whitespace-nowrap">{s.department ?? ""}</td>
                <td className="whitespace-nowrap">{s.saleType ?? ""}</td>
                <td className="max-w-64">
                  <span className="line-clamp-2">{s.symptom}</span>
                </td>
                <td className="whitespace-nowrap">{s.createdByName ?? ""}</td>
                <td className="whitespace-nowrap text-xs tabular-nums">{formatTime(s.createdAt)}</td>
                {done ? (
                  <>
                    <td className="whitespace-nowrap text-xs tabular-nums">{s.done ? formatTime(s.done.at) : s.canceledAt ? formatTime(s.canceledAt) : ""}</td>
                    <td className="whitespace-nowrap">{s.doneByName ?? ""}</td>
                  </>
                ) : (
                  <>
                    <td className="whitespace-nowrap">{s.assigneeName ?? <span className="text-muted-foreground">미배정</span>}</td>
                    <td className="whitespace-nowrap text-xs tabular-nums">{visitLabel(s.visitAt)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid gap-1.5 md:hidden">
        {rows.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => onOpen(s.id)} className={cn("grid w-full gap-1 rounded-xl border bg-card px-3 py-2.5 text-left hover:bg-muted/50", s.status === "canceled" && "opacity-60", s.urgent && isActive(s) && "border-red-300")}>
              <span className="flex items-center gap-1.5">
                <ServiceBadge s={s} />
                {showType && <span className="shrink-0 text-xs text-muted-foreground">{serviceLabel(s)}</span>}
                <span className="min-w-0 truncate text-sm font-medium">{s.partnerName}</span>
                {s.department && <span className="shrink-0 text-xs text-muted-foreground">{s.department}</span>}
              </span>
              <span className="truncate text-sm">{s.symptom}</span>
              <span className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                {s.assetCode && <span>{s.assetCode}</span>}
                {s.saleType && <span>{s.saleType}</span>}
                <span>
                  접수 {formatTime(s.createdAt)} {s.createdByName}
                </span>
                {done ? s.done && <span>완료 {formatTime(s.done.at)} {s.doneByName}</span> : <span>담당 {s.assigneeName ?? "미배정"}</span>}
                {!done && s.visitAt && <span>방문 {visitLabel(s.visitAt)}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

type StatusFilter = "active" | ServiceStatus | "billing" | "all";

/** 서비스 목록: 유형 탭, 상태, 완료 건 거르기(부서·판매구분·직원·기간) */
export function ServicesPage() {
  const { cid, detail } = useCompanyOutlet();
  const [params, setParams] = useSearchParams();
  const services = useServices(cid);
  const types = serviceTypesOf(detail.company);
  const type = params.get("type") ?? "";
  const setType = (t: string) => setParams((p) => (t ? p.set("type", t) : p.delete("type"), p), { replace: true });
  const [status, setStatus] = useState<StatusFilter>("active");
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [sale, setSale] = useState("");
  const [person, setPerson] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const openId = params.get("open") ?? "";
  const setOpen = (id: string) => setParams((p) => (id ? p.set("open", id) : p.delete("open"), p), { replace: true });
  const canEdit = detail.me.perms.assets === "edit";

  const all = services.data ?? [];
  const ofType = all.filter((s) => !type || s.type === type);
  const ended = status === "done" || status === "canceled" || status === "all";
  const day = (s: Service) => s.done?.date ?? s.date;
  const shown = ofType
    .filter((s) => (status === "all" ? true : status === "active" ? isActive(s) : status === "billing" ? s.needsBilling : s.status === status))
    .filter((s) => (!dept || s.department === dept) && (!sale || s.saleType === sale) && (!person || s.assignee === person || s.done?.by === person || s.createdBy === person))
    .filter((s) => (!from || day(s) >= from) && (!to || day(s) <= to))
    .filter((s) => matches([s.no, s.partnerName, s.assetCode ?? "", s.assetSerial ?? "", s.symptom, s.assigneeName ?? "", s.requester ?? "", s.department ?? ""].join(" "), q));
  const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter(Boolean) as string[])].sort();
  const people = new Map<string, string>();
  for (const s of all) {
    if (s.assignee && s.assigneeName) people.set(s.assignee, s.assigneeName);
    if (s.done?.by && s.doneByName) people.set(s.done.by, s.doneByName);
    if (s.createdBy && s.createdByName) people.set(s.createdBy, s.createdByName);
  }
  const count = (st: ServiceStatus[]) => ofType.filter((s) => st.includes(s.status)).length;
  const extraTypes = uniq(all.map((s) => s.type)).filter((t) => !types.includes(t));

  return (
    <main className="mx-auto grid max-w-6xl gap-4 p-4 md:p-6">
      <PageHead
        title="서비스"
        sub="고장·점검·설치·원격 접수 → 진행 → 완료. 줄을 누르면 자세히 봅니다"
        action={
          canEdit && (
            <Button nativeButton={false} render={<Link to={`/company/${cid}/services/new${type ? `?type=${encodeURIComponent(type)}` : ""}`} />}>
              <PlusIcon /> 서비스 접수
            </Button>
          )
        }
      />
      <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1">
        <Chip on={type === ""} onClick={() => setType("")}>
          전체 유형
        </Chip>
        {[...types, ...extraTypes].map((t) => (
          <Chip key={t} on={type === t} onClick={() => setType(t)}>
            {t} {all.filter((s) => s.type === t && isActive(s)).length || ""}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        <Chip on={status === "active"} onClick={() => setStatus("active")}>
          처리 중 {count(ACTIVE)}
        </Chip>
        <Chip on={status === "open"} onClick={() => setStatus("open")}>
          접수 {count(["open"])}
        </Chip>
        <Chip on={status === "in_progress"} onClick={() => setStatus("in_progress")}>
          진행 {count(["in_progress"])}
        </Chip>
        <Chip on={status === "done"} onClick={() => setStatus("done")}>
          완료
        </Chip>
        {ofType.some((s) => s.needsBilling) && (
          <Chip on={status === "billing"} onClick={() => setStatus("billing")}>
            청구 필요 {ofType.filter((s) => s.needsBilling).length}
          </Chip>
        )}
        <Chip on={status === "canceled"} onClick={() => setStatus("canceled")}>
          취소
        </Chip>
        <Chip on={status === "all"} onClick={() => setStatus("all")}>
          전체
        </Chip>
      </div>
      <div className="flex flex-wrap gap-2">
        <Search value={q} onChange={setQ} placeholder="거래처·장비·접수 내용·요청자" />
        <NativeSelect value={dept} onChange={(e) => setDept(e.target.value)} className="h-9" aria-label="부서">
          <option value="">부서 전체</option>
          {uniq(all.map((s) => s.department)).map((d) => (
            <option key={d}>{d}</option>
          ))}
        </NativeSelect>
        <NativeSelect value={sale} onChange={(e) => setSale(e.target.value)} className="h-9" aria-label="판매구분">
          <option value="">판매구분 전체</option>
          {uniq(all.map((s) => s.saleType)).map((d) => (
            <option key={d}>{d}</option>
          ))}
        </NativeSelect>
        <NativeSelect value={person} onChange={(e) => setPerson(e.target.value)} className="h-9" aria-label="직원">
          <option value="">직원 전체</option>
          {[...people].map(([sub, name]) => (
            <option key={sub} value={sub}>
              {name}
            </option>
          ))}
        </NativeSelect>
        {ended && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-36" aria-label="시작일" />~
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-36" aria-label="끝일" />
          </span>
        )}
      </div>
      {services.isPending ? (
        <InlineSpinner />
      ) : services.isError ? (
        <ErrorAlert error={services.error} />
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{status === "active" ? "처리할 서비스가 없습니다." : "서비스가 없습니다."}</p>
      ) : (
        <ServiceTable rows={shown} onOpen={setOpen} done={ended} showType={!type} />
      )}
      <ServiceDialog cid={cid} id={openId} onClose={() => setOpen("")} />
    </main>
  );
}

/** 팝업으로 서비스 보기·수정 (id가 비면 닫힘) */
export function ServiceDialog({ cid, id, onClose }: { cid: string; id: string; onClose: () => void }) {
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto p-0 sm:max-w-3xl">
        <DialogTitle className="sr-only">서비스</DialogTitle>
        {id && <ServiceView cid={cid} sid={id} onDeleted={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

/** 서비스 접수 (?partner ?asset ?type) */
export function ServiceNewPage() {
  const { cid, detail } = useCompanyOutlet();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const partners = usePartners(cid);
  const assets = useAssets(cid);
  const staff = useStaff(cid);
  const mut = useRentalMutations(cid);
  const types = serviceTypesOf(detail.company);
  const [partnerId, setPartnerId] = useState(params.get("partner") ?? "");
  const [assetId, setAssetId] = useState(params.get("asset") ?? "");
  const [type, setType] = useState(params.get("type") && types.includes(params.get("type")!) ? params.get("type")! : types[0]!);
  const [subtype, setSubtype] = useState<string>(INSTALL_SUBTYPES[0]);
  const [date, setDate] = useState(todayStr());
  const [f, setF] = useState<Partial<ServiceFields>>({});
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof ServiceFields) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  if (partners.isPending || assets.isPending) return <main className="p-4"><InlineSpinner /></main>;
  const partnerList = (partners.data ?? []).filter((p) => p.active && p.kind !== "supplier");
  const atPartner = (assets.data ?? []).filter((a) => a.partnerId === partnerId && a.status === "rented");

  const submit = () => {
    setError(null);
    if (!partnerId) return setError("거래처를 고르세요.");
    if (!f.symptom?.trim()) return setError("접수 내용을 적으세요.");
    const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]).filter(([, v]) => v !== "" && v !== undefined && v !== false));
    mut.createService.mutate(
      { ...body, partnerId, ...(assetId ? { assetId } : {}), date, type, ...(type === "설치" ? { subtype } : {}), symptom: f.symptom.trim() },
      { onSuccess: (r) => void navigate(`/company/${cid}/services?open=${r.service.id}`, { replace: true }) },
    );
  };

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <Link to={`/company/${cid}/services`} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeftIcon className="size-4" /> 서비스
      </Link>
      <h1 className="text-xl font-bold tracking-tight">서비스 접수</h1>
      <form
        className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-1 sm:col-span-2">
          <span className="text-xs text-muted-foreground">서비스 유형</span>
          <div className="flex flex-wrap gap-1">
            {types.map((t) => (
              <Chip key={t} on={type === t} onClick={() => setType(t)}>
                {t}
              </Chip>
            ))}
          </div>
          {type === "설치" && (
            <div className="flex flex-wrap gap-1 pt-1">
              {INSTALL_SUBTYPES.map((t) => (
                <Chip key={t} on={subtype === t} onClick={() => setSubtype(t)}>
                  {t}
                </Chip>
              ))}
            </div>
          )}
        </div>
        <Field label="거래처">
          <NativeSelect value={partnerId} onChange={(e) => (setPartnerId(e.target.value), setAssetId(""))} className="h-9">
            <option value="">고르세요</option>
            {partnerList.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="장비">
          <NativeSelect value={assetId} onChange={(e) => setAssetId(e.target.value)} className="h-9" disabled={!partnerId}>
            <option value="">{atPartner.length ? "고르세요 (없으면 비워 두기)" : "이 거래처에 나가 있는 장비 없음"}</option>
            {atPartner.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} {a.itemName} {a.serial && `(${a.serial})`}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="부서 (선택)">
          <Input maxLength={40} value={f.department ?? ""} onChange={set("department")} placeholder="예: 행정실, 3층 교무실" />
        </Field>
        <Field label="접수일">
          <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </Field>
        <Field label="요청자">
          <Input maxLength={30} value={f.requester ?? ""} onChange={set("requester")} placeholder="예: 김주무관" />
        </Field>
        <Field label="전화번호">
          <Input maxLength={30} inputMode="tel" value={f.phone ?? ""} onChange={set("phone")} placeholder="010-…" />
        </Field>
        <Field label="방문 요청 일시 (선택)">
          <Input type="datetime-local" value={f.visitAt ?? ""} onChange={set("visitAt")} />
        </Field>
        <Field label="담당 (선택)">
          <NativeSelect value={f.assignee ?? ""} onChange={set("assignee")} className="h-9">
            <option value="">정하지 않음</option>
            {(staff.data ?? []).map((s) => (
              <option key={s.sub} value={s.sub}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="접수 내용" wide>
          <Textarea rows={3} maxLength={500} value={f.symptom ?? ""} onChange={set("symptom")} placeholder={type === "점검" ? "예: 정기 점검, 토너 잔량 확인" : type === "설치" ? "예: 3층 교무실 복합기 1대 설치" : "예: 용지 걸림, 인쇄물 줄 생김"} />
        </Field>
        <Field label="특이사항 (선택)" wide>
          <Input maxLength={1000} value={f.remark ?? ""} onChange={set("remark")} placeholder="예: 오전 방문 불가, 주차 어려움" />
        </Field>
        <div className="flex flex-wrap gap-4 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-red-600" checked={!!f.urgent} onChange={(e) => setF({ ...f, urgent: e.target.checked })} />
            긴급
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={!!f.support} onChange={(e) => setF({ ...f, support: e.target.checked })} />
            지원 요청
          </label>
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <FormError message={error} />
          <ErrorAlert error={mut.createService.error} />
          <Button type="submit" size="lg" disabled={mut.createService.isPending}>
            접수
          </Button>
        </div>
      </form>
    </main>
  );
}

/** 알림 등 주소로 들어왔을 때: 같은 내용을 페이지로 */
export function ServiceDetailPage() {
  const { cid } = useCompanyOutlet();
  const { sid = "" } = useParams();
  const navigate = useNavigate();
  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <Link to={`/company/${cid}/services`} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeftIcon className="size-4" /> 서비스
      </Link>
      <div className="rounded-2xl border bg-card">
        <ServiceView cid={cid} sid={sid} onDeleted={() => void navigate(`/company/${cid}/services`, { replace: true })} />
      </div>
    </main>
  );
}

const STEPS: { st: ServiceStatus; label: string }[] = [
  { st: "open", label: "접수" },
  { st: "in_progress", label: "진행" },
  { st: "done", label: "완료" },
];

function Stepper({ s }: { s: Service }) {
  const reached = s.status === "done" ? 3 : s.status === "in_progress" ? 2 : s.status === "open" ? 1 : 0;
  const info = [
    [s.createdAt, s.createdByName],
    [s.startedAt, s.startedByName],
    [s.done?.at, s.doneByName],
  ] as const;
  return (
    <ol className="grid grid-cols-3 gap-1">
      {STEPS.map((x, i) => {
        const on = i < reached;
        const [at, by] = info[i]!;
        return (
          <li key={x.st} className={cn("grid justify-items-center gap-0.5 rounded-xl border px-1 py-2 text-center", on ? "border-primary/50 bg-primary/5" : "opacity-60")}>
            <span className={cn("grid size-6 place-items-center rounded-full text-xs font-bold", on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{on ? <CheckIcon className="size-3.5" /> : i + 1}</span>
            <span className="text-xs font-medium">{x.label}</span>
            <span className="text-[11px] text-muted-foreground tabular-nums">{at ? `${formatTime(at)} ${by ?? ""}` : "—"}</span>
          </li>
        );
      })}
    </ol>
  );
}

const FIELD_LABEL: Record<string, string> = {
  type: "유형",
  subtype: "세부",
  symptom: "접수 내용",
  requester: "요청자",
  phone: "전화번호",
  contact: "연락처",
  visitAt: "방문 요청",
  assignee: "담당",
  urgent: "긴급",
  support: "지원 요청",
  department: "부서",
  progressNote: "진행 내용",
  report: "보고 내용",
  remark: "특이사항",
  action: "처리 내용",
  reason: "취소 사유",
};
const HIST_LABEL: Record<ServiceHistory["action"], string> = { edit: "수정", start: "진행 시작", done: "완료", cancel: "서비스 취소", link: "계약 연결" };

/** 서비스 한 건: 단계, 거래처·장비, 접수 칸(수정), 처리 내용, 완료 입력, 설치 연결, 수정 이력 */
export function ServiceView({ cid, sid, onDeleted }: { cid: string; sid: string; onDeleted: () => void }) {
  const { detail } = useCompanyOutlet();
  const me = detail.me;
  const data = useService(cid, sid);
  const [showHist, setShowHist] = useState(false);

  if (data.isPending) return <div className="p-6"><InlineSpinner /></div>;
  if (data.isError) return <div className="p-6"><ErrorAlert error={data.error} /></div>;
  const { service: s, txn, history } = data.data;
  const canEdit = me.perms.assets === "edit";
  const active = isActive(s);

  return (
    <div className="grid gap-4 p-4 sm:p-5">
      <header className="flex flex-wrap items-center gap-2 pr-8">
        <ServiceBadge s={s} />
        <span className="rounded-full border px-2 py-0.5 text-[11px]">{serviceLabel(s)}</span>
        <h2 className="text-lg font-bold tracking-tight">{s.no}</h2>
        <span className="text-xs text-muted-foreground">경과 {elapsed(s.createdAt, s.done?.at ?? s.canceledAt)}</span>
      </header>
      {s.status === "canceled" ? <p className="rounded-xl bg-muted p-3 text-sm">서비스 취소 · {s.cancelReason || "사유 없음"}</p> : <Stepper s={s} />}

      <section className="grid gap-x-6 gap-y-1.5 rounded-xl border p-3 text-sm sm:grid-cols-2">
        <Row label="거래처" value={<Link className="text-primary" to={`/company/${cid}/partners/${s.partnerId}`}>{s.partnerName}</Link>} />
        <Row label="부서" value={s.department || "—"} />
        <Row label="장비" value={s.assetId ? <Link className="text-primary" to={`/company/${cid}/assets/${s.assetId}`}>{s.assetCode} {s.itemName}</Link> : "—"} />
        <Row label="판매구분" value={s.saleType || "—"} />
        {s.assetSerial && <Row label="S/N" value={s.assetSerial} />}
      </section>

      <ServiceForm key={`${s.id}-${s.updatedAt ?? ""}-${s.status}`} cid={cid} s={s} editable={canEdit && active} lateEdit={canEdit && s.status === "done"} />

      {s.done && (
        <section className="grid gap-1.5 rounded-xl border p-3 text-sm">
          <h3 className="text-xs font-medium text-muted-foreground">완료 정보</h3>
          <Row label="처리 내용" value={<span className="whitespace-pre-wrap">{s.done.action}</span>} />
          <Row label="처리방식" value={s.done.method || "—"} />
          <Row label="완료" value={`${formatDay(s.done.date)} · ${s.doneByName ?? ""}`} />
          {s.done.consumables && (
            <Row label="소모품 잔량" value={CONSUMABLES.filter(([k]) => s.done!.consumables![k] !== undefined).map(([k, l]) => { const v = s.done!.consumables![k]; return `${l} ${v}${typeof v === "number" ? "%" : ""}`; }).join(" · ")} />
          )}
          {s.done.counters && (
            <Row
              label="카운터"
              value={[
                ["A4 흑백", s.done.counters.a4Mono],
                ["A4 컬러", s.done.counters.a4Color],
                ["A3 흑백", s.done.counters.a3Mono],
                ["A3 컬러", s.done.counters.a3Color],
              ]
                .filter(([, v]) => v !== undefined)
                .map(([l, v]) => `${l} ${Number(v).toLocaleString("ko-KR")}`)
                .join(" · ")}
            />
          )}
        </section>
      )}
      {(s.links ?? []).length > 0 && (
        <p className="flex flex-wrap gap-2 text-sm">
          {s.links!.map((l) => (
            <Link key={l.id} className="text-primary" to={`/company/${cid}/txns/${l.date}/${l.id}`}>
              {l.op === "out" ? "출고" : "수거"} {l.no}
            </Link>
          ))}
        </p>
      )}
      {txn && (
        <section className="grid gap-1.5">
          <h3 className="text-sm font-medium">서비스 거래 (부품·작업비)</h3>
          <TxnRow cid={cid} t={txn} showPartner={false} />
        </section>
      )}
      {s.chargeTxn && (
        <Link to={`/company/${cid}/txns/${s.chargeTxn.date}/${s.chargeTxn.id}`} className="text-sm text-primary">
          청구 {s.chargeTxn.no} 보기
        </Link>
      )}
      {s.needsBilling && me.showAmounts && me.perms.txns === "edit" && (
        <section className="flex flex-wrap items-center gap-3 rounded-xl border border-red-300/60 bg-red-50/50 p-3 dark:bg-red-400/5">
          <p className="min-w-0 flex-1 text-sm">유상 서비스입니다. 작업비를 청구하세요.</p>
          <Button size="sm" nativeButton={false} render={<Link to={`/company/${cid}/txns/new?type=charge&partner=${s.partnerId}&service=${s.id}`} />}>
            청구 만들기
          </Button>
        </section>
      )}

      {active && canEdit && s.type === "설치" && <InstallLinks cid={cid} s={s} />}
      {active && canEdit && s.status === "open" && <StartService cid={cid} id={s.id} />}
      {active && canEdit && !(s.type === "설치" && s.subtype) && <CompleteForm cid={cid} s={s} />}
      <div className="flex flex-wrap items-center gap-2">
        {s.status === "done" && (me.perms.docs === "edit" || canEdit) && <WorkDoc cid={cid} id={s.id} />}
        {active && canEdit && <CancelService cid={cid} id={s.id} />}
        {s.status === "open" && canEdit && !s.txn && <DeleteService cid={cid} id={s.id} onDeleted={onDeleted} />}
        <Button size="sm" variant="ghost" onClick={() => setShowHist(!showHist)}>
          <HistoryIcon /> 수정 이력 {history.length}
        </Button>
      </div>
      {s.status === "done" && txn && <p className="text-xs text-muted-foreground">완료를 되돌리려면 서비스 거래를 취소하세요 (부품 재고도 돌아옵니다).</p>}
      {showHist && <History items={history} />}
    </div>
  );
}

/** 접수 칸 보기·수정 (진행 중에는 모두, 완료 뒤에는 보고 내용·특이사항만) */
function ServiceForm({ cid, s, editable, lateEdit }: { cid: string; s: Service; editable: boolean; lateEdit: boolean }) {
  const { detail } = useCompanyOutlet();
  const staff = useStaff(cid);
  const mut = useRentalMutations(cid);
  const types = serviceTypesOf(detail.company);
  const init: Partial<ServiceFields> = { ...s };
  const [f, setF] = useState<Partial<ServiceFields>>(init);
  const [saved, setSaved] = useState(false);
  const can = (k: keyof ServiceFields) => editable || (lateEdit && (k === "report" || k === "remark"));
  const set = (k: keyof ServiceFields) => (e: { target: { value: string } }) => (setF({ ...f, [k]: e.target.value }), setSaved(false));
  const norm = (v: unknown) => (v === undefined || v === null || v === false ? "" : v);
  const changed = (Object.keys(f) as (keyof ServiceFields)[]).filter((k) => k in FIELD_LABEL && can(k) && norm(f[k]) !== norm(init[k]));
  const save = () => {
    const body = Object.fromEntries(changed.map((k) => [k, typeof f[k] === "string" ? (f[k] as string).trim() : f[k]]));
    if (body.symptom === "") return;
    mut.patchService.mutate({ id: s.id, ...body }, { onSuccess: () => setSaved(true) });
  };
  const text = (k: keyof ServiceFields, label: string, rows = 2, max = 1000) =>
    can(k) ? (
      <Field label={label} wide>
        <Textarea rows={rows} maxLength={max} value={(f[k] as string) ?? ""} onChange={set(k)} />
      </Field>
    ) : (
      <Row label={label} value={<span className="whitespace-pre-wrap">{(s[k] as string) || "—"}</span>} />
    );
  const line = (k: keyof ServiceFields, label: string, input: ReactNode, shown: ReactNode) => (can(k) ? <Field label={label}>{input}</Field> : <Row label={label} value={shown || "—"} />);

  return (
    <section className="grid gap-3 rounded-xl border p-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        {line(
          "type",
          "서비스 유형",
          <NativeSelect value={f.type ?? ""} onChange={(e) => (setF({ ...f, type: e.target.value, subtype: e.target.value === "설치" ? (f.subtype ?? INSTALL_SUBTYPES[0]) : "" }), setSaved(false))} className="h-9">
            {[...new Set([...types, s.type])].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </NativeSelect>,
          serviceLabel(s),
        )}
        {editable && f.type === "설치" && (
          <Field label="세부">
            <NativeSelect value={f.subtype ?? ""} onChange={set("subtype")} className="h-9">
              {INSTALL_SUBTYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </NativeSelect>
          </Field>
        )}
        {line("requester", "요청자", <Input maxLength={30} value={f.requester ?? ""} onChange={set("requester")} />, s.requester)}
        {line("phone", "전화번호", <Input maxLength={30} inputMode="tel" value={f.phone ?? ""} onChange={set("phone")} />, s.phone && <a className="text-primary" href={`tel:${s.phone}`}>{s.phone}</a>)}
        {line("visitAt", "방문 요청", <Input type="datetime-local" value={f.visitAt ?? ""} onChange={set("visitAt")} />, visitLabel(s.visitAt))}
        {line(
          "assignee",
          "담당",
          <NativeSelect value={f.assignee ?? ""} onChange={set("assignee")} className="h-9">
            <option value="">정하지 않음</option>
            {(staff.data ?? []).map((x) => (
              <option key={x.sub} value={x.sub}>
                {x.name}
              </option>
            ))}
          </NativeSelect>,
          s.assigneeName,
        )}
        {line("department", "부서", <Input maxLength={40} value={f.department ?? ""} onChange={set("department")} />, s.department)}
        <Row label="접수자" value={`${s.createdByName ?? ""} · ${formatTime(s.createdAt)}`} />
        {s.contact && <Row label="연락처" value={s.contact} />}
      </div>
      {editable ? (
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4 accent-red-600" checked={!!f.urgent} onChange={(e) => (setF({ ...f, urgent: e.target.checked }), setSaved(false))} />
            <SirenIcon className="size-4 text-red-600" /> 긴급
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4 accent-primary" checked={!!f.support} onChange={(e) => (setF({ ...f, support: e.target.checked }), setSaved(false))} />
            지원 요청
          </label>
        </div>
      ) : (
        (s.urgent || s.support) && <p className="text-xs text-muted-foreground">{[s.urgent && "긴급", s.support && "지원 요청"].filter(Boolean).join(" · ")}</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {text("symptom", "접수 내용", 3, 500)}
        {text("progressNote", "진행 내용")}
        {text("report", "보고 내용")}
        {text("remark", "특이사항")}
      </div>
      {(editable || lateEdit) && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={changed.length === 0 || mut.patchService.isPending || f.symptom?.trim() === ""} onClick={save}>
            저장
          </Button>
          {saved && changed.length === 0 && <span className="text-xs text-muted-foreground">저장했습니다.</span>}
          {changed.length > 0 && <span className="text-xs text-muted-foreground">바뀐 칸 {changed.length}개</span>}
          <ErrorAlert error={mut.patchService.error} />
        </div>
      )}
    </section>
  );
}

function StartService({ cid, id }: { cid: string; id: string }) {
  const mut = useRentalMutations(cid);
  return (
    <div className="grid justify-items-start gap-1">
      <Button variant="outline" disabled={mut.startService.isPending} onClick={() => mut.startService.mutate({ id, note: "" })}>
        진행 시작 (출발·작업 시작)
      </Button>
      <ErrorAlert error={mut.startService.error} />
    </div>
  );
}

type Part = { itemId: string; qty: string };
const COUNTERS = [
  ["a4Mono", "A4 흑백"],
  ["a4Color", "A4 컬러"],
  ["a3Mono", "A3 흑백"],
  ["a3Color", "A3 컬러"],
] as const;

/** 완료 입력: 처리 내용·방식, (점검) 소모품 잔량·카운터, 사용 부품, 작업비/유상 */
function CompleteForm({ cid, s }: { cid: string; s: Service }) {
  const { detail } = useCompanyOutlet();
  const me = detail.me;
  const items = useItems(cid);
  const mut = useRentalMutations(cid);
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState("");
  const [method, setMethod] = useState(s.type === "원격" ? "원격" : "방문");
  const [date, setDate] = useState(todayStr());
  const [levels, setLevels] = useState<Record<string, string>>({});
  const [counters, setCounters] = useState<Record<string, string>>({});
  const [parts, setParts] = useState<Part[]>([]);
  const [withFees, setWithFees] = useState(false);
  const [fees, setFees] = useState<DraftLine[]>(() => [newLine(detail.company.vatDefault)]);
  const [billable, setBillable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stock = (items.data ?? []).filter((i) => i.active && i.tracking === "stock");

  if (!open)
    return (
      <Button size="lg" onClick={() => setOpen(true)}>
        완료 입력
      </Button>
    );

  const complete = () => {
    setError(null);
    if (!action.trim()) return setError("처리 내용을 적으세요.");
    const lv = Object.fromEntries(Object.entries(levels).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v !== "").map(([k, v]) => [k, /^\d+$/.test(v!) ? Number(v) : v!]));
    if (Object.values(lv).some((v) => typeof v === "number" && v > 100)) return setError("잔량 숫자는 0~100 (%)");
    const ct = Object.fromEntries(Object.entries(counters).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v.replace(/,/g, ""))]));
    if (Object.values(ct).some((v) => !(v >= 0) || !Number.isInteger(v))) return setError("카운터는 0 이상의 정수");
    if (Object.keys(ct).length && ct.a4Mono === undefined) return setError("카운터를 적을 때는 A4 흑백은 꼭 적으세요 (청구 기준).");
    const ps = parts.filter((p) => p.itemId && Number(p.qty) > 0).map((p) => ({ itemId: p.itemId, name: "", qty: Number(p.qty), unitPrice: 0, vatMode: detail.company.vatDefault, memo: "부품" }));
    const fs = withFees ? fees.map((l) => toLineInput(l, [])).filter((l) => l.name) : [];
    mut.completeService.mutate({
      id: s.id,
      date,
      action: action.trim(),
      method,
      parts: ps,
      fees: fs,
      billable: billable && fs.length === 0,
      ...(Object.keys(lv).length ? { consumables: lv } : {}),
      ...(Object.keys(ct).length ? { counters: ct } : {}),
    });
  };

  return (
    <form
      className="grid gap-3 rounded-xl border border-primary/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        complete();
      }}
    >
      <h3 className="text-sm font-medium">완료 입력</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="완료일">
          <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </Field>
        <div className="grid content-start gap-1 text-xs text-muted-foreground">
          처리방식
          <div className="flex flex-wrap gap-1">
            {SERVICE_METHODS.map((m) => (
              <Chip key={m} on={method === m} onClick={() => setMethod(m)}>
                {m}
              </Chip>
            ))}
          </div>
        </div>
      </div>
      <Field label="처리 내용">
        <Textarea rows={3} maxLength={1000} value={action} onChange={(e) => setAction(e.target.value)} placeholder="예: 급지 롤러 교체, 드럼 청소" />
      </Field>
      {(
        <div className="grid gap-3 rounded-lg bg-muted/40 p-3">
          <div className="grid gap-1">
            <p className="text-xs text-muted-foreground">소모품 잔량 — 숫자(%) 또는 글자(양호·교체·OK). 비워도 됩니다</p>
            <div className="grid grid-cols-4 gap-2">
              {CONSUMABLES.map(([k, l]) => (
                <label key={k} className="grid gap-0.5 text-[11px] text-muted-foreground">
                  {l}
                  <Input inputMode="numeric" value={levels[k] ?? ""} onChange={(e) => setLevels({ ...levels, [k]: e.target.value.slice(0, 10) })} className="h-8" placeholder="% / 양호" />
                </label>
              ))}
            </div>
          </div>
          {s.assetId ? (
            <div className="grid gap-1">
              <p className="text-xs text-muted-foreground">지금 카운터 (A4 흑백·컬러는 검침으로 기록돼 청구에 쓰입니다)</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {COUNTERS.map(([k, l]) => (
                  <label key={k} className="grid gap-0.5 text-[11px] text-muted-foreground">
                    {l}
                    <Input inputMode="numeric" value={counters[k] ?? ""} onChange={(e) => setCounters({ ...counters, [k]: e.target.value.replace(/[^\d,]/g, "") })} className="h-8" />
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">장비가 없는 접수라 카운터는 적을 수 없습니다.</p>
          )}
        </div>
      )}
      <div className="grid gap-2">
        <p className="text-xs text-muted-foreground">사용 부품 (재고에서 빠집니다)</p>
        {parts.map((p, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_4.5rem_auto] gap-2">
            <NativeSelect value={p.itemId} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))} className="h-9 w-full min-w-0" aria-label="부품">
              <option value="">부품</option>
              {stock.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name} (재고 {it.qty ?? 0})
                </option>
              ))}
            </NativeSelect>
            <Input inputMode="decimal" value={p.qty} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} className="h-9" aria-label="수량" />
            <Button type="button" size="icon-sm" variant="ghost" aria-label="부품 빼기" onClick={() => setParts(parts.filter((_, j) => j !== i))}>
              <XIcon />
            </Button>
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" className="justify-self-start" onClick={() => setParts([...parts, { itemId: "", qty: "1" }])}>
          부품 추가
        </Button>
      </div>
      {me.showAmounts && (
        <div className="grid gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={withFees} onChange={(e) => setWithFees(e.target.checked)} />
            작업비·출장비 바로 청구
          </label>
          {withFees && <TxnLinesEditor lines={fees} onChange={setFees} items={[]} defaultVat={detail.company.vatDefault} />}
        </div>
      )}
      {!withFees && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-primary" checked={billable} onChange={(e) => setBillable(e.target.checked)} />
          유상 (사무실에서 나중에 청구)
        </label>
      )}
      <FormError message={error} />
      <ErrorAlert error={mut.completeService.error} />
      <div className="flex gap-2">
        <Button type="submit" size="lg" className="flex-1" disabled={mut.completeService.isPending}>
          완료
        </Button>
        <Button type="button" size="lg" variant="ghost" onClick={() => setOpen(false)}>
          닫기
        </Button>
      </div>
    </form>
  );
}

/** 설치 접수: 계약 출고·수거 화면으로 (거기서 끝내면 이 서비스도 같이 진행·완료) */
function InstallLinks({ cid, s }: { cid: string; s: Service }) {
  const { detail } = useCompanyOutlet();
  const me = detail.me;
  const contracts = useContracts(cid, { partnerId: s.partnerId, status: "active" });
  const canOut = me.perms.contracts === "edit";
  const returned = (s.links ?? []).some((l) => l.op === "return");
  const wantOut = s.subtype === "신규 설치" || (s.subtype === "기기 교체" && returned);
  const wantReturn = s.subtype === "수거" || (s.subtype === "기기 교체" && !returned);
  const q = `service=${s.id}`;
  const list = contracts.data ?? [];
  if (!s.subtype) return null;
  return (
    <section className="grid gap-2 rounded-xl border border-primary/40 p-3 text-sm">
      <p>
        {s.subtype === "기기 교체" ? (returned ? "옛 기기를 수거했습니다. 새 기기를 출고하면 완료됩니다." : "먼저 옛 기기를 수거하고, 새 기기를 출고하면 완료됩니다.") : s.subtype === "수거" ? "계약에서 수거하면 이 서비스도 완료됩니다." : "계약으로 출고하면 이 서비스도 완료됩니다."}
      </p>
      <div className="flex flex-wrap gap-2">
        {wantOut && canOut && (
          <>
            <Button size="sm" nativeButton={false} render={<Link to={`/company/${cid}/contracts/new?partner=${s.partnerId}&${q}`} />}>
              새 계약으로 출고
            </Button>
            {list.map((c) => (
              <Button key={c.id} size="sm" variant="outline" nativeButton={false} render={<Link to={`/company/${cid}/contracts/new?partner=${s.partnerId}&contract=${c.id}&${q}`} />}>
                {c.no}에 기기 추가
              </Button>
            ))}
          </>
        )}
        {wantReturn &&
          list.map((c) => (
            <Button key={c.id} size="sm" nativeButton={false} render={<Link to={`/company/${cid}/contracts/${c.id}/return?${q}${s.assetId && c.machines[s.assetId] ? `&asset=${s.assetId}` : ""}`} />}>
              {c.no}에서 수거
            </Button>
          ))}
        {wantReturn && contracts.data && list.length === 0 && <span className="text-xs text-muted-foreground">이 거래처에 진행 중인 계약이 없습니다.</span>}
        {wantOut && !canOut && <span className="text-xs text-muted-foreground">출고는 계약 편집 권한이 있는 사람이 합니다.</span>}
      </div>
    </section>
  );
}

function History({ items }: { items: ServiceHistory[] }) {
  if (items.length === 0) return <p className="text-xs text-muted-foreground">이력이 없습니다.</p>;
  const show = (v: unknown) => (v === true ? "예" : v === false ? "아니오" : v === "" || v === undefined || v === null ? "(빈 칸)" : String(v));
  return (
    <ol className="grid gap-2 border-l pl-3 text-xs">
      {items.map((h, i) => (
        <li key={i} className="grid gap-0.5">
          <span className="text-muted-foreground">
            {formatTime(h.at)} · {h.actorName} · <b className="text-foreground">{HIST_LABEL[h.action]}</b>
          </span>
          {Object.entries(h.changes).map(([k, c]) => (
            <span key={k} className="break-words">
              {FIELD_LABEL[k] ?? k}: {h.action === "edit" && <span className="text-muted-foreground line-through">{show(c.from)}</span>} {show(c.to)}
            </span>
          ))}
        </li>
      ))}
    </ol>
  );
}

function WorkDoc({ cid, id }: { cid: string; id: string }) {
  const flow = useDocFlow(cid);
  return (
    <>
      <Button size="sm" variant="outline" disabled={flow.busy} onClick={() => flow.issueAndOpen({ type: "work", serviceId: id })}>
        <FileTextIcon /> 작업 확인서
      </Button>
      <ErrorAlert error={flow.error} />
      {flow.sheet}
    </>
  );
}

function CancelService({ cid, id }: { cid: string; id: string }) {
  const mut = useRentalMutations(cid);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open)
    return (
      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setOpen(true)}>
        서비스 취소
      </Button>
    );
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <Input placeholder="취소 사유 (예: 고객이 해결함)" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} className="h-9 min-w-0 flex-1" />
      <Button size="sm" variant="destructive" disabled={mut.cancelService.isPending} onClick={() => mut.cancelService.mutate({ id, reason: reason.trim() })}>
        취소하기
      </Button>
      <ErrorAlert error={mut.cancelService.error} />
    </div>
  );
}

/** 잘못 접수한 건 지우기 (접수 단계에서만) */
function DeleteService({ cid, id, onDeleted }: { cid: string; id: string; onDeleted: () => void }) {
  const mut = useRentalMutations(cid);
  const [sure, setSure] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" className="text-destructive" disabled={mut.deleteService.isPending} onClick={() => (sure ? mut.deleteService.mutate(id, { onSuccess: onDeleted }) : setSure(true))}>
        <Trash2Icon /> {sure ? "정말 삭제" : "삭제"}
      </Button>
      <ErrorAlert error={mut.deleteService.error} />
    </>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  );
}
