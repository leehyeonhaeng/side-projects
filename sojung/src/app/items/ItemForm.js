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

export default function ItemForm({ action, item, submitLabel }) {
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="품목명" name="name" required defaultValue={item?.name} />
      <Field label="규격" name="spec" defaultValue={item?.spec} />
      <Field
        label="단위"
        name="unit"
        placeholder="예: kg, 개, 박스"
        defaultValue={item?.unit}
      />
      <Field label="분류" name="category" defaultValue={item?.category} />
      <Field
        label="최소재고 기준"
        name="minStock"
        type="number"
        step="any"
        defaultValue={item?.min_stock ?? 0}
      />
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          메모
        </label>
        <textarea
          name="memo"
          rows={3}
          defaultValue={item?.memo}
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
