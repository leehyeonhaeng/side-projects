const TYPE_OPTIONS = [
  { value: "supplier", label: "매입처" },
  { value: "customer", label: "매출처" },
  { value: "both", label: "매입처 · 매출처 둘 다" },
];

function Field({ label, name, type = "text", required, defaultValue, ...rest }) {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={name}
        className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
      >
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        {...rest}
      />
    </div>
  );
}

export default function PartnerForm({ action, partner, submitLabel }) {
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="상호" name="name" required defaultValue={partner?.name} />

      <div className="flex flex-col gap-1">
        <label
          htmlFor="type"
          className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          구분<span className="ml-0.5 text-red-500">*</span>
        </label>
        <select
          id="type"
          name="type"
          required
          defaultValue={partner?.type || "supplier"}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        >
          {TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <Field label="담당자" name="contactName" defaultValue={partner?.contact_name} />
      <Field label="연락처" name="phone" defaultValue={partner?.phone} />
      <Field
        label="사업자번호"
        name="businessNo"
        defaultValue={partner?.business_no}
      />
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          메모
        </label>
        <textarea
          name="memo"
          rows={3}
          defaultValue={partner?.memo}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </div>

      <button
        type="submit"
        className="mt-2 rounded-full bg-black px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
      >
        {submitLabel}
      </button>
    </form>
  );
}

export { TYPE_OPTIONS };
