import { useHealth } from "../../api/health";

export function HomePage() {
  const health = useHealth();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">Personal Portal</h1>
      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm text-zinc-500 dark:text-zinc-400">API 상태</h2>
        <p className="mt-1 text-lg">
          {health.isPending && "확인 중..."}
          {health.isError && <span className="text-red-600 dark:text-red-400">연결 실패 ({health.error.message})</span>}
          {health.isSuccess && (
            <span className="text-emerald-600 dark:text-emerald-400">
              {health.data.status} · {health.data.service}
            </span>
          )}
        </p>
      </section>
    </main>
  );
}
