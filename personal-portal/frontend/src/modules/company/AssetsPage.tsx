import { type ReactNode, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ArrowLeftIcon, PlusIcon } from "lucide-react";
import { ASSET_STATUS_LABEL, type Asset, type AssetLog, type AssetStatus, useAsset, useAssets, useItems, useMasterMutations, useRentalMutations } from "@/api/company";
import { ConfirmButton } from "@/components/ConfirmButton";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatTime, todayStr } from "@/lib/dates";
import { useCompanyOutlet } from "./CompanyLayout";
import { Chip, Field, PageHead, Search, StatusBadge, matches, money } from "./ui";

/** 기기 (COMPANY.md 4장): 임대 장비 한 대씩. 고유번호·상태·위치·이력 */
export function AssetsPage() {
  const { cid, detail } = useCompanyOutlet();
  const canEdit = detail.me.perms.assets === "edit";
  const assets = useAssets(cid);
  const items = useItems(cid, detail.me.perms.items !== "none" || canEdit);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<AssetStatus | "active" | "all">("active");
  const [registering, setRegistering] = useState(false);
  const itemFilter = params.get("item");

  const all = assets.data ?? [];
  const shown = all
    .filter((a) => (status === "all" ? true : status === "active" ? a.status !== "retired" : a.status === status))
    .filter((a) => !itemFilter || a.itemId === itemFilter)
    .filter((a) => matches([a.code, a.serial, a.itemName, a.partnerName, a.location, a.memo].join(" "), q));
  const count = (s: AssetStatus) => all.filter((a) => a.status === s).length;
  const models = (items.data ?? []).filter((i) => i.tracking === "asset" && i.active);

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <PageHead
        title="기기"
        sub={`임대 중 ${count("rented")} · 창고 ${count("in_stock")} · 수리 ${count("repair")}`}
        action={
          canEdit && (
            <Button onClick={() => setRegistering(true)} disabled={!items.data}>
              <PlusIcon /> 기기 등록
            </Button>
          )
        }
      />
      <Search value={q} onChange={setQ} placeholder="고유번호·제조번호·모델·거래처 검색" />
      <div className="flex flex-wrap gap-1">
        {(["active", "rented", "in_stock", "repair", "retired", "all"] as const).map((s) => (
          <Chip key={s} on={status === s} onClick={() => setStatus(s)}>
            {s === "active" ? "사용 중 전체" : s === "all" ? "폐기 포함" : ASSET_STATUS_LABEL[s]}
          </Chip>
        ))}
      </div>
      {itemFilter && (
        <p className="flex items-center gap-2 text-sm">
          모델: <b className="font-medium">{models.find((m) => m.id === itemFilter)?.name ?? all.find((a) => a.itemId === itemFilter)?.itemName}</b>
          <Button size="xs" variant="ghost" onClick={() => setParams({})}>
            해제
          </Button>
        </p>
      )}
      {assets.isPending ? (
        <InlineSpinner />
      ) : assets.isError ? (
        <ErrorAlert error={assets.error} />
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{all.length ? "조건에 맞는 기기가 없습니다." : "품목·재고에서 '기기 모델'을 만든 뒤, 여기서 가지고 있는 기기를 등록하세요."}</p>
      ) : (
        <ul className="grid gap-1.5">
          {shown.map((a) => (
            <li key={a.id}>
              <Link to={`/company/${cid}/assets/${a.id}`} className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 hover:bg-muted/50">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{a.code}</span>
                    <span className="truncate text-sm">{a.itemName}</span>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{[a.serial && `S/N ${a.serial}`, a.status === "rented" ? a.partnerName : a.location].filter(Boolean).join(" · ") || "—"}</span>
                </span>
                <StatusBadge status={a.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {registering && <RegisterDialog cid={cid} models={models} defaultItem={itemFilter ?? undefined} showAmounts={detail.me.showAmounts} onClose={() => setRegistering(false)} />}
    </main>
  );
}

function RegisterDialog({ cid, models, defaultItem, showAmounts, onClose }: { cid: string; models: { id: string; name: string }[]; defaultItem?: string; showAmounts: boolean; onClose: () => void }) {
  const [itemId, setItemId] = useState(defaultItem && models.some((m) => m.id === defaultItem) ? defaultItem : (models[0]?.id ?? ""));
  const [count, setCount] = useState("1");
  const [serials, setSerials] = useState("");
  const [acquiredAt, setAcquiredAt] = useState(todayStr());
  const [cost, setCost] = useState("");
  const [location, setLocation] = useState("");
  const [memo, setMemo] = useState("");
  const [done, setDone] = useState<Asset[] | null>(null);
  const mut = useMasterMutations(cid);
  const serialList = serials.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  const n = Math.max(Number(count) || 0, serialList.length);

  if (models.length === 0) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>기기 등록</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">먼저 품목·재고에서 '기기 모델' 품목을 만드세요. (예: 신도리코 D420 컬러복합기)</p>
          <DialogFooter>
            <Button nativeButton={false} render={<Link to={`/company/${cid}/items`} />}>
              품목·재고로
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>기기 등록 (기초 등록)</DialogTitle>
        </DialogHeader>
        {done ? (
          <div className="grid gap-3">
            <p className="text-sm">{done.length}대를 등록했습니다.</p>
            <ul className="grid max-h-60 gap-1 overflow-y-auto text-sm">
              {done.map((a) => (
                <li key={a.id} className="flex gap-2">
                  <span className="font-mono font-semibold">{a.code}</span>
                  <span className="text-muted-foreground">{a.serial || "제조번호 없음"}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">기기 라벨(QR) 출력은 문서 기능(C5)에서 추가됩니다.</p>
            <DialogFooter>
              <Button onClick={onClose}>닫기</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">지금 가지고 있는 기기를 등록합니다. 고유번호는 자동으로 붙습니다. 앞으로 사들이는 기기는 매입 거래(C3)에서 자동 등록됩니다.</p>
            <form
              id="register-form"
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                mut.registerAssets.mutate(
                  { itemId, count: n, serials: serialList, acquiredAt: acquiredAt || undefined, cost: showAmounts && cost ? Number(cost.replace(/,/g, "")) : undefined, location: location.trim(), memo: memo.trim() },
                  { onSuccess: (r) => setDone(r.assets) },
                );
              }}
            >
              <Field label="기기 모델" wide>
                <NativeSelect value={itemId} onChange={(e) => setItemId(e.target.value)} className="h-9">
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="대수" hint="최대 50대">
                <Input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))} />
              </Field>
              <Field label="취득일">
                <Input type="date" value={acquiredAt} onChange={(e) => setAcquiredAt(e.target.value)} />
              </Field>
              <Field label="제조번호 (한 줄에 하나, 선택)" wide hint={serialList.length ? `${serialList.length}개 입력 — 나머지는 비워서 등록` : "나중에 기기 화면에서 넣어도 됩니다"}>
                <Textarea rows={3} value={serials} onChange={(e) => setSerials(e.target.value)} placeholder={"SN2024A001\nSN2024A002"} />
              </Field>
              {showAmounts && (
                <Field label="한 대당 매입가 (원, 선택)">
                  <Input inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} />
                </Field>
              )}
              <Field label="창고 위치 (선택)">
                <Input maxLength={60} placeholder="본사 창고 2층" value={location} onChange={(e) => setLocation(e.target.value)} />
              </Field>
              <Field label="메모" wide>
                <Input maxLength={500} value={memo} onChange={(e) => setMemo(e.target.value)} />
              </Field>
            </form>
            <ErrorAlert error={mut.registerAssets.error} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                취소
              </Button>
              <Button type="submit" form="register-form" disabled={!itemId || n < 1 || n > 50 || mut.registerAssets.isPending}>
                {n}대 등록
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

const LOG_LABEL: Record<string, (l: AssetLog) => string> = {
  registered: (l) => `등록${l.note ? ` (${l.note})` : ""}`,
  status: (l) => `상태 ${ASSET_STATUS_LABEL[l.from as AssetStatus] ?? l.from} → ${ASSET_STATUS_LABEL[l.to as AssetStatus] ?? l.to}`,
  rental_out: (l) => `임대 출고 → ${l.partnerName ?? ""} (${[l.contractNo, l.txnNo].filter(Boolean).join(" · ")})`,
  rental_return: (l) => `수거 ← ${l.partnerName ?? ""} (${[l.contractNo, l.txnNo].filter(Boolean).join(" · ")})`,
  reading: (l) => `검침 ${l.date ?? ""} · 흑백 ${(l.mono ?? 0).toLocaleString()}${l.color ? ` / 컬러 ${l.color.toLocaleString()}` : ""}${l.note ? ` (${l.note})` : ""}`,
  service_open: (l) => `A/S 접수 ${l.serviceNo ?? ""}${l.note ? ` · ${l.note}` : ""}`,
  service_done: (l) => `A/S 완료 ${l.serviceNo ?? ""}${l.note ? ` · ${l.note}` : ""}`,
  service_cancel: (l) => `A/S 접수 취소 ${l.serviceNo ?? ""}`,
  cancel: (l) => `${l.note ?? "취소"} (${l.txnNo ?? ""})`,
};

/** 기기 상세: 정보, 상태 바꾸기(창고·수리·폐기), 이력. 라벨 QR(C5)이 이 화면을 연다 */
export function AssetDetailPage() {
  const { cid, detail } = useCompanyOutlet();
  const { aid = "" } = useParams();
  const data = useAsset(cid, aid);
  const mut = useMasterMutations(cid);
  const navigate = useNavigate();
  const canEdit = detail.me.perms.assets === "edit";
  const [editing, setEditing] = useState(false);
  const [reading, setReading] = useState(false);

  if (data.isPending) return <main className="p-4"><InlineSpinner /></main>;
  if (data.isError) return <main className="p-4"><ErrorAlert error={data.error} /></main>;
  const { asset: a, logs } = data.data;

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <Link to={`/company/${cid}/assets`} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeftIcon className="size-4" /> 기기
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-mono text-2xl font-bold tracking-tight">{a.code}</h1>
        <StatusBadge status={a.status} />
      </div>
      <p className="-mt-2 text-sm">{a.itemName}</p>

      <section className="grid gap-2 rounded-2xl border bg-card p-4 text-sm">
        <Row label="제조번호" value={a.serial || "—"} />
        <Row label={a.status === "rented" ? "임대처" : "위치"} value={a.status === "rented" ? (a.partnerId ? <Link className="text-primary" to={`/company/${cid}/partners/${a.partnerId}`}>{a.partnerName}</Link> : "—") : a.location || "—"} />
        {a.contractId && <Row label="계약" value={<Link className="text-primary" to={`/company/${cid}/contracts/${a.contractId}`}>계약 보기</Link>} />}
        {a.lastReading && <Row label="최근 검침" value={`${a.lastReading.date} · 흑백 ${a.lastReading.mono.toLocaleString()}${a.lastReading.color ? ` / 컬러 ${a.lastReading.color.toLocaleString()}` : ""}`} />}
        <Row label="취득일" value={a.acquiredAt ?? "—"} />
        {detail.me.showAmounts && <Row label="매입가" value={money(a.cost)} />}
        {a.memo && <Row label="메모" value={a.memo} />}
      </section>

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            정보 수정
          </Button>
          {a.status !== "rented" &&
            (["in_stock", "repair", "retired"] as const)
              .filter((s) => s !== a.status)
              .map((s) => (
                <Button key={s} variant="outline" size="sm" disabled={mut.patchAsset.isPending} onClick={() => mut.patchAsset.mutate({ id: a.id, status: s })}>
                  {s === "in_stock" ? "창고로" : s === "repair" ? "수리로" : "폐기"}
                </Button>
              ))}
          {a.status === "in_stock" && detail.me.perms.contracts === "edit" && (
            <Button size="sm" nativeButton={false} render={<Link to={`/company/${cid}/contracts/new?asset=${a.id}`} />}>
              임대 출고
            </Button>
          )}
          {a.status === "rented" && a.partnerId && (
            <Button size="sm" nativeButton={false} render={<Link to={a.contractId ? `/company/${cid}/contracts/${a.contractId}/return?asset=${a.id}` : `/company/${cid}/txns/new?type=rental_return&partner=${a.partnerId}&asset=${a.id}`} />}>
              수거
            </Button>
          )}
          {a.status === "rented" && (
            <Button size="sm" variant="outline" onClick={() => setReading(true)}>
              검침 입력
            </Button>
          )}
          {a.partnerId && (
            <Button size="sm" variant="outline" nativeButton={false} render={<Link to={`/company/${cid}/services/new?partner=${a.partnerId}&asset=${a.id}`} />}>
              A/S 접수
            </Button>
          )}
          <ConfirmButton size="sm" variant="ghost" className="ml-auto" title="기기를 삭제할까요?" description="잘못 등록한 기기만 지울 수 있습니다. 이력이 있으면 '폐기'로 바꾸세요." confirmLabel="삭제" onConfirm={() => mut.deleteAsset.mutateAsync(a.id).then(() => navigate(`/company/${cid}/assets`))}>
            삭제
          </ConfirmButton>
        </div>
      )}
      <ErrorAlert error={mut.patchAsset.error ?? mut.deleteAsset.error} />

      <section className="grid gap-2">
        <h2 className="text-sm font-medium">이력</h2>
        <ul className="grid divide-y overflow-hidden rounded-2xl border bg-card">
          {logs.map((l, i) => (
            <li key={`${l.at}-${i}`} className="flex justify-between gap-3 px-4 py-2.5 text-sm">
              <span>{(LOG_LABEL[l.action] ?? (() => l.action))(l)}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatTime(l.at)}</span>
            </li>
          ))}
        </ul>
      </section>
      {editing && <AssetEditDialog cid={cid} asset={a} showAmounts={detail.me.showAmounts} onClose={() => setEditing(false)} />}
      {reading && <ReadingDialog cid={cid} asset={a} onClose={() => setReading(false)} />}
    </main>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <p className="flex gap-3">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </p>
  );
}

function AssetEditDialog({ cid, asset, showAmounts, onClose }: { cid: string; asset: Asset; showAmounts: boolean; onClose: () => void }) {
  const [serial, setSerial] = useState(asset.serial);
  const [location, setLocation] = useState(asset.location);
  const [acquiredAt, setAcquiredAt] = useState(asset.acquiredAt ?? "");
  const [cost, setCost] = useState(asset.cost?.toString() ?? "");
  const [memo, setMemo] = useState(asset.memo);
  const mut = useMasterMutations(cid);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{asset.code} 수정</DialogTitle>
        </DialogHeader>
        <form
          id="asset-form"
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            mut.patchAsset.mutate(
              { id: asset.id, serial: serial.trim(), location: location.trim(), memo: memo.trim(), acquiredAt: acquiredAt || null, ...(showAmounts ? { cost: cost ? Number(cost.replace(/,/g, "")) : null } : {}) },
              { onSuccess: onClose },
            );
          }}
        >
          <Field label="제조번호">
            <Input maxLength={60} value={serial} onChange={(e) => setSerial(e.target.value)} />
          </Field>
          <Field label="창고 위치">
            <Input maxLength={60} value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
          <Field label="취득일">
            <Input type="date" value={acquiredAt} onChange={(e) => setAcquiredAt(e.target.value)} />
          </Field>
          {showAmounts && (
            <Field label="매입가 (원)">
              <Input inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} />
            </Field>
          )}
          <Field label="메모">
            <Textarea rows={2} maxLength={500} value={memo} onChange={(e) => setMemo(e.target.value)} />
          </Field>
        </form>
        <ErrorAlert error={mut.patchAsset.error} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" form="asset-form" disabled={mut.patchAsset.isPending}>
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 기기 화면에서 바로 검침 입력 (검침 화면과 같은 규칙: 카운터는 줄어들 수 없음) */
function ReadingDialog({ cid, asset, onClose }: { cid: string; asset: Asset; onClose: () => void }) {
  const mut = useRentalMutations(cid);
  const [date, setDate] = useState(todayStr());
  const [mono, setMono] = useState("");
  const [color, setColor] = useState("");
  const n = (v: string) => Number(v.replace(/,/g, "")) || 0;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{asset.code} 검침</DialogTitle>
        </DialogHeader>
        <form
          id="reading-form"
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (mono) mut.addReading.mutate({ assetId: asset.id, date, mono: n(mono), color: n(color) }, { onSuccess: onClose });
          }}
        >
          {asset.lastReading && (
            <p className="text-xs text-muted-foreground">
              최근 {asset.lastReading.date} · 흑백 {asset.lastReading.mono.toLocaleString()} / 컬러 {asset.lastReading.color.toLocaleString()}
            </p>
          )}
          <Field label="검침일">
            <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="흑백 카운터">
              <Input inputMode="numeric" value={mono} onChange={(e) => setMono(e.target.value.replace(/[^\d,]/g, ""))} />
            </Field>
            <Field label="컬러 카운터">
              <Input inputMode="numeric" value={color} onChange={(e) => setColor(e.target.value.replace(/[^\d,]/g, ""))} />
            </Field>
          </div>
        </form>
        <ErrorAlert error={mut.addReading.error} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" form="reading-form" disabled={!mono || mut.addReading.isPending}>
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
