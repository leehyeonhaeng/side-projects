import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-start gap-4 p-6">
      <h1 className="text-xl font-semibold">페이지를 찾을 수 없습니다</h1>
      <Link to="/" className="text-sm underline">
        홈으로
      </Link>
    </main>
  );
}
