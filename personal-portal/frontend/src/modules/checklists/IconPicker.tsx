import { useState } from "react";
import { LIST_ICONS } from "@/api/checklists";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** 리스트 아이콘: 정해진 이모지 중에서 고르기 */
export function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button type="button" variant="outline" className="h-9 w-11 text-lg" aria-label="아이콘 고르기" aria-expanded={open} onClick={() => setOpen(!open)}>
        {value}
      </Button>
      {open && (
        <div className="absolute top-10 left-0 z-20 grid w-56 grid-cols-5 gap-1 rounded-xl border bg-popover p-2 shadow-lg">
          {LIST_ICONS.map((icon) => (
            <button
              key={icon}
              type="button"
              aria-label={icon}
              aria-pressed={icon === value}
              onClick={() => (onChange(icon), setOpen(false))}
              className={cn("grid h-9 place-items-center rounded-lg text-lg hover:bg-muted", icon === value && "bg-muted ring-2 ring-primary")}
            >
              {icon}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
