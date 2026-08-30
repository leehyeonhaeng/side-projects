import { getCompanySettings, getLoginPasswordHash } from "@/lib/settings";
import {
  updateSettingsAction,
  setPasswordAction,
  removePasswordAction,
} from "@/app/settings/actions";
import NavBar from "@/app/NavBar";

const PW_ERROR_LABEL = {
  current: "현재 비밀번호가 올바르지 않습니다.",
  short: "비밀번호는 4자 이상이어야 합니다.",
  mismatch: "새 비밀번호가 일치하지 않습니다.",
};

function Field({ label, name, defaultValue }) {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={name}
        className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
      >
        {label}
      </label>
      <input
        id={name}
        name={name}
        type="text"
        defaultValue={defaultValue || ""}
        className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
      />
    </div>
  );
}

export default async function SettingsPage({ searchParams }) {
  const { saved, pwError, pwSaved } = await searchParams;
  const company = getCompanySettings();
  const hasPassword = !!getLoginPasswordHash();

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <div className="mx-auto w-full max-w-lg px-6 py-10">
        <NavBar active="settings" />
        <h1 className="mb-2 text-2xl font-semibold text-black dark:text-zinc-50">
          설정
        </h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          영수증 등에 표시되는 발급자(회사) 정보입니다.
        </p>

        {saved && (
          <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
            저장되었습니다.
          </p>
        )}

        <form action={updateSettingsAction} className="flex flex-col gap-4">
          <Field label="상호" name="name" defaultValue={company?.name} />
          <Field
            label="사업자번호"
            name="businessNo"
            defaultValue={company?.business_no}
          />
          <Field label="주소" name="address" defaultValue={company?.address} />
          <Field label="연락처" name="phone" defaultValue={company?.phone} />
          <button
            type="submit"
            className="mt-2 w-fit rounded-full bg-black px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            저장
          </button>
        </form>

        <hr className="my-8 border-zinc-200 dark:border-zinc-800" />

        <h2 className="mb-2 text-lg font-semibold text-black dark:text-zinc-50">
          로그인 비밀번호
        </h2>
        <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
          {hasPassword
            ? "설정된 비밀번호로 전체 화면이 보호됩니다."
            : "아직 비밀번호가 설정되지 않아 누구나 접속할 수 있습니다."}
        </p>

        {pwError && (
          <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-400">
            {PW_ERROR_LABEL[pwError] || "오류가 발생했습니다."}
          </p>
        )}
        {pwSaved === "1" && (
          <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
            비밀번호가 저장되었습니다.
          </p>
        )}
        {pwSaved === "removed" && (
          <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
            비밀번호 보호가 해제되었습니다.
          </p>
        )}

        <form action={setPasswordAction} className="flex flex-col gap-4">
          {hasPassword && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                현재 비밀번호
              </label>
              <input
                type="password"
                name="currentPassword"
                required
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              새 비밀번호
            </label>
            <input
              type="password"
              name="newPassword"
              required
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              새 비밀번호 확인
            </label>
            <input
              type="password"
              name="confirmPassword"
              required
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>
          <button
            type="submit"
            className="mt-2 w-fit rounded-full bg-black px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            {hasPassword ? "비밀번호 변경" : "비밀번호 설정"}
          </button>
        </form>

        {hasPassword && (
          <form action={removePasswordAction} className="mt-4 flex flex-col gap-2">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              현재 비밀번호 (해제용)
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                name="currentPassword"
                required
                className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
              <button
                type="submit"
                className="rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
              >
                비밀번호 보호 해제
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
