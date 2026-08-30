import { loginAction } from "@/app/login/actions";

export default async function LoginPage({ searchParams }) {
  const { error } = await searchParams;

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
      <form
        action={loginAction}
        className="flex w-full max-w-xs flex-col gap-4 rounded-md border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950"
      >
        <h1 className="text-lg font-semibold text-black dark:text-zinc-50">
          로그인
        </h1>
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">
            비밀번호가 올바르지 않습니다.
          </p>
        )}
        <input
          type="password"
          name="password"
          placeholder="비밀번호"
          required
          autoFocus
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        <button
          type="submit"
          className="rounded-full bg-black px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          로그인
        </button>
      </form>
    </div>
  );
}
