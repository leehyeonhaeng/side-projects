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

export const TRACKING_TYPE_LABEL = {
  quantity: "수량 관리",
  asset: "개체(자산) 관리",
};

export default function ItemForm({ action, item, submitLabel }) {
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="품목명" name="name" required defaultValue={item?.name} />

      {item ? (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            관리 방식
          </span>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {TRACKING_TYPE_LABEL[item.tracking_type] || TRACKING_TYPE_LABEL.quantity}
            {" "}(등록 후에는 변경할 수 없습니다)
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            관리 방식
          </span>
          <div className="flex flex-col gap-2 rounded-md border border-zinc-300 p-3 dark:border-zinc-700">
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="trackingType" value="quantity" defaultChecked className="mt-0.5" />
              <span>
                <span className="font-medium text-black dark:text-zinc-50">수량 관리</span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                  토너, 종이 등 소모품처럼 입출고 수량으로만 관리
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="trackingType" value="asset" className="mt-0.5" />
              <span>
                <span className="font-medium text-black dark:text-zinc-50">개체(자산) 관리</span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                  복사기, 프린터 등 임대 장비처럼 낱개마다 고유 ID를 부여해 거래처별
                  배치·수거를 추적
                </span>
              </span>
            </label>
          </div>
        </div>
      )}

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
