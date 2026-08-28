import { getCompanySettings } from "@/lib/settings";
import { updateSettingsAction } from "@/app/settings/actions";

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
  const { saved } = await searchParams;
  const company = getCompanySettings();

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <div className="mx-auto w-full max-w-lg px-6 py-10">
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
      </div>
    </div>
  );
}
