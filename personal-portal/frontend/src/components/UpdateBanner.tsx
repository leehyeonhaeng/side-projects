import { useEffect } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { RefreshCwIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

const CHECK_EVERY = 30 * 60 * 1000; // 켜 둔 채로 오래 쓸 때도 새 버전을 찾게 30분마다 확인

/** DESIGN.md 9.2: 배포 후 서비스워커가 새 버전을 찾으면 "새로고침" 배너 */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (registration) setInterval(() => void registration.update(), CHECK_EVERY);
    },
  });

  // 앱으로 돌아올 때도 확인 (폰 홈 화면 앱은 오래 백그라운드에 있다가 다시 열림)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void navigator.serviceWorker?.getRegistration().then((r) => r?.update());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // 로그인·가입 화면에는 잃을 입력이 없으니 묻지 않고 바로 새 버전으로 (예전 화면이 새 로그인 단계를 모르는 일 방지)
  const onAuthPage = /^\/(login|signup|forgot-password|invite)(\/|$)/.test(location.pathname);
  useEffect(() => {
    if (needRefresh && onAuthPage) void updateServiceWorker(true);
  }, [needRefresh, onAuthPage, updateServiceWorker]);

  if (!needRefresh || onAuthPage) return null;
  return (
    <div role="status" className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-md items-center gap-2 rounded-2xl border bg-card p-3 text-sm shadow-lg md:bottom-6">
      <RefreshCwIcon className="size-4 shrink-0 text-primary" />
      <span className="flex-1">새 버전이 있습니다.</span>
      <Button size="sm" onClick={() => void updateServiceWorker(true)}>
        새로고침
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="나중에" onClick={() => setNeedRefresh(false)}>
        <XIcon />
      </Button>
    </div>
  );
}
