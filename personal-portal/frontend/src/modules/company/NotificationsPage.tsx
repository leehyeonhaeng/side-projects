import { useEffect, useState } from "react";
import { Link } from "react-router";
import { BellIcon, BellOffIcon, SmartphoneIcon } from "lucide-react";
import { type NotifyType, useNotifications, useNotifyMutations, useNotifySettings } from "@/api/company";
import { ErrorAlert, FormError, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useCompanyOutlet } from "./CompanyLayout";
import { PageHead } from "./ui";

const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const device = () => (/iPhone/.test(navigator.userAgent) ? "iPhone" : /iPad/.test(navigator.userAgent) ? "iPad" : /Android/.test(navigator.userAgent) ? "Android" : /Windows/.test(navigator.userAgent) ? "Windows" : /Mac/.test(navigator.userAgent) ? "Mac" : "기기");

function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** 서비스 워커가 없으면(개발 모드 등) 기다리지 않게 */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 5000))]);
}

/** 알림 (COMPANY.md 12장 C6): 내 알림 목록, 받을 종류 켜고 끄기, 이 기기 폰 푸시 */
export function NotificationsPage() {
  const { cid } = useCompanyOutlet();
  const list = useNotifications(cid);
  const mut = useNotifyMutations(cid);
  const unread = list.data?.unread ?? 0;
  // 열어 둔 동안 새 알림이 오면 바로 읽음 처리
  const read = mut.read.mutate;
  useEffect(() => {
    if (unread > 0) read();
  }, [unread, read]);

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 md:p-6">
      <PageHead title="알림" sub="받을 알림은 아래에서 고릅니다. 아침 확인은 새로 생긴 것만 알려 드려요" />
      {list.isPending ? (
        <InlineSpinner />
      ) : list.isError ? (
        <ErrorAlert error={list.error} />
      ) : list.data.notifications.length === 0 ? (
        <p className="text-sm text-muted-foreground">알림이 없습니다.</p>
      ) : (
        <ul className="grid divide-y overflow-hidden rounded-2xl border bg-card">
          {list.data.notifications.map((n, i) => (
            <li key={`${n.at}-${i}`}>
              <Link to={n.url} className={cn("grid gap-0.5 px-4 py-3 hover:bg-muted/50", n.unread && "bg-primary/5")}>
                <span className="flex items-start justify-between gap-3">
                  <span className={cn("min-w-0 text-sm", n.unread && "font-semibold")}>{n.title}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{formatTime(n.at)}</span>
                </span>
                {n.body && <span className="truncate text-xs text-muted-foreground">{n.body}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <PushDevice cid={cid} />
      <NotifyPrefs cid={cid} />
    </main>
  );
}

function PushDevice({ cid }: { cid: string }) {
  const settings = useNotifySettings(cid);
  const mut = useNotifyMutations(cid);
  const [sub, setSub] = useState<PushSubscription | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = pushSupported();

  useEffect(() => {
    if (!supported) return;
    void registration().then((reg) => (reg ? reg.pushManager.getSubscription().then(setSub) : setSub(null)));
  }, [supported]);

  const enable = async () => {
    setError(null);
    const key = settings.data?.publicKey;
    if (!key) return setError("푸시가 아직 설정되지 않았습니다.");
    setBusy(true);
    try {
      if ((await Notification.requestPermission()) !== "granted") return setError("알림 권한을 허용해야 합니다. 브라우저·폰 설정에서 이 앱의 알림을 켜 주세요.");
      const reg = await registration();
      if (!reg) return setError("앱이 아직 준비되지 않았습니다. 새로 고친 뒤 다시 시도하세요.");
      const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
      const json = s.toJSON();
      await mut.subscribe.mutateAsync({ endpoint: s.endpoint, keys: json.keys ?? {}, device: device() });
      setSub(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "켜지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };
  const disable = async () => {
    if (!sub) return;
    setBusy(true);
    try {
      await mut.unsubscribe.mutateAsync(sub.endpoint);
      await sub.unsubscribe();
      setSub(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="grid gap-3 rounded-2xl border bg-card p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <SmartphoneIcon className="size-4 text-primary" /> 이 기기에서 폰 알림
        {settings.data && settings.data.devices > 0 && <span className="text-xs font-normal text-muted-foreground">· 내 기기 {settings.data.devices}대 연결</span>}
      </p>
      {!supported ? (
        <p className="text-sm text-muted-foreground">{isIos() ? "아이폰은 Safari에서 '홈 화면에 추가'한 앱으로 열어야 알림을 받을 수 있습니다 (iOS 16.4 이상)." : "이 브라우저는 알림을 지원하지 않습니다."}</p>
      ) : sub === undefined ? (
        <InlineSpinner />
      ) : sub ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={mut.test.isPending} onClick={() => mut.test.mutate()}>
            <BellIcon /> 시험 알림 보내기
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void disable()}>
            <BellOffIcon /> 이 기기 끄기
          </Button>
        </div>
      ) : (
        <Button size="sm" className="justify-self-start" disabled={busy || !settings.data} onClick={() => void enable()}>
          <BellIcon /> 이 기기에서 알림 받기
        </Button>
      )}
      {mut.test.isSuccess && <p className="text-xs text-muted-foreground">보냈습니다. 몇 초 안에 알림이 와야 합니다.</p>}
      <FormError message={error} />
      <ErrorAlert error={mut.test.error ?? mut.subscribe.error} />
    </section>
  );
}

function NotifyPrefs({ cid }: { cid: string }) {
  const settings = useNotifySettings(cid);
  const mut = useNotifyMutations(cid);
  if (settings.isPending) return <InlineSpinner />;
  if (settings.isError) return <ErrorAlert error={settings.error} />;
  const groups: [string, string, NotifyType[]][] = [
    ["instant", "바로 알림 — 일이 생기는 순간", settings.data.types.filter((t) => t.group === "instant")],
    ["daily", "아침 확인 (매일 8시 30분) — 새로 생긴 것만", settings.data.types.filter((t) => t.group === "daily")],
  ];
  return (
    <section className="grid gap-3 rounded-2xl border bg-card p-4">
      <p className="text-sm font-medium">받을 알림 <span className="font-normal text-muted-foreground">— 앱 안 알림과 폰 알림에 같이 적용</span></p>
      {groups.map(([id, title, types]) =>
        types.length === 0 ? null : (
          <div key={id} className="grid gap-1.5">
            <p className="text-xs text-muted-foreground">{title}</p>
            {types.map((t) => (
              <label key={t.id} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm">
                {t.label}
                <input type="checkbox" role="switch" className="size-5 accent-primary" checked={t.on} disabled={mut.prefs.isPending} onChange={(e) => mut.prefs.mutate({ [t.id]: e.target.checked })} />
              </label>
            ))}
          </div>
        ),
      )}
      <p className="text-xs text-muted-foreground">권한이 있는 알림만 보입니다. 내가 한 일은 알리지 않습니다.</p>
      <ErrorAlert error={mut.prefs.error} />
    </section>
  );
}
