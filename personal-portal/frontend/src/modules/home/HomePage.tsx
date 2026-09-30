import { useHealth } from "@/api/health";
import { useMe } from "@/api/me";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LEVEL_LABEL, MODULES } from "@/modules/meta";

/** Phase 3에서 위젯 그리드 대시보드로 바뀐다. 지금은 권한 있는 모듈만 보여준다. */
export function HomePage() {
  const me = useMe();
  const health = useHealth();
  const perms = me.data?.perms;
  const visible = MODULES.filter((m) => perms && perms[m.id] !== "none");

  return (
    <main className="mx-auto grid max-w-5xl gap-6 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">{me.data?.name}님, 안녕하세요</h1>
        <p className="text-xs text-muted-foreground">
          API {health.isSuccess ? "정상" : health.isError ? "연결 실패" : "확인 중"}
        </p>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">사용할 수 있는 모듈이 없습니다. 관리자에게 권한을 요청하세요.</p>
      ) : (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((m) => (
            <Card key={m.id} size="sm" className="opacity-80">
              <CardHeader>
                <CardTitle>{m.label}</CardTitle>
                <CardDescription>{m.description}</CardDescription>
                <div className="flex flex-wrap gap-1 pt-1">
                  {perms && m.id !== "calendar" && <Badge variant="outline">{LEVEL_LABEL[perms[m.id]]}</Badge>}
                  <Badge variant="secondary">Phase {m.phase} 예정</Badge>
                </div>
              </CardHeader>
            </Card>
          ))}
        </section>
      )}
    </main>
  );
}
