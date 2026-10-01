import type { Nutrition } from "@/api/meals";
import { Input } from "@/components/ui/input";

const FIELDS: { key: keyof Omit<Nutrition, "name">; label: string; unit: string }[] = [
  { key: "grams", label: "양", unit: "g" },
  { key: "kcal", label: "열량", unit: "kcal" },
  { key: "carb", label: "탄", unit: "g" },
  { key: "protein", label: "단", unit: "g" },
  { key: "fat", label: "지", unit: "g" },
];

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * 영양정보 한 줄 편집. 양(g)을 바꾸면 열량·탄단지를 같은 비율로 다시 계산한다
 * (AI가 200g으로 추정했는데 실제로 150g 먹었을 때 숫자를 하나하나 고치지 않게).
 */
export function NutritionRow({ value, onChange }: { value: Nutrition; onChange: (v: Nutrition) => void }) {
  const setNumber = (key: (typeof FIELDS)[number]["key"], raw: string) => {
    const n = raw === "" ? 0 : Math.max(0, Number(raw));
    if (Number.isNaN(n)) return;
    if (key === "grams" && value.grams && value.grams > 0 && n > 0) {
      const ratio = n / value.grams;
      onChange({
        ...value,
        grams: n,
        kcal: round1(value.kcal * ratio),
        carb: round1(value.carb * ratio),
        protein: round1(value.protein * ratio),
        fat: round1(value.fat * ratio),
      });
      return;
    }
    onChange({ ...value, [key]: key === "grams" && raw === "" ? null : n });
  };

  return (
    <div className="grid gap-1.5">
      <Input aria-label="음식 이름" value={value.name} maxLength={100} onChange={(e) => onChange({ ...value, name: e.target.value })} className="h-8" />
      <div className="grid grid-cols-5 gap-1">
        {FIELDS.map((f) => (
          <label key={f.key} className="grid gap-0.5 text-[10px] text-muted-foreground">
            {f.label}
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.1"
              aria-label={`${value.name || "음식"} ${f.label}(${f.unit})`}
              value={value[f.key] ?? ""}
              onChange={(e) => setNumber(f.key, e.target.value)}
              className="h-8 px-1.5 text-xs tabular-nums"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
