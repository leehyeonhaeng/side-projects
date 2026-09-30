import { useState } from "react";
import { type Perms, type Preset, useDeletePreset, usePresets, useSavePreset } from "@/api/admin";
import { ConfirmButton } from "@/components/ConfirmButton";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { type Level, MODULES, levelOptions } from "@/modules/meta";

const EMPTY: Perms = Object.fromEntries(MODULES.map((m) => [m.id, "none"])) as Perms;

export function PresetsTab() {
  const presets = usePresets();
  const [adding, setAdding] = useState(false);

  if (presets.isPending) return <InlineSpinner />;
  if (presets.isError) return <ErrorAlert error={presets.error} />;

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">가입 승인 시 선택하는 권한 묶음입니다. 이미 승인된 계정의 권한은 바뀌지 않습니다.</p>
      {presets.data.map((p) => (
        <PresetEditor key={p.id} preset={p} />
      ))}
      {adding ? (
        <PresetEditor preset={{ id: "", name: "", perms: EMPTY }} onDone={() => setAdding(false)} />
      ) : (
        <Button variant="outline" className="justify-self-start" onClick={() => setAdding(true)}>
          프리셋 추가
        </Button>
      )}
    </div>
  );
}

function PresetEditor({ preset, onDone }: { preset: Preset; onDone?: () => void }) {
  const [name, setName] = useState(preset.name);
  const [perms, setPerms] = useState<Perms>(preset.perms);
  const save = useSavePreset();
  const remove = useDeletePreset();
  const isNew = !preset.id;
  const dirty = isNew || name !== preset.name || MODULES.some((m) => perms[m.id] !== preset.perms[m.id]);

  const submit = async () => {
    await save.mutateAsync({ id: preset.id || undefined, name: name.trim(), perms });
    onDone?.();
  };

  return (
    <Card size="sm">
      <CardHeader>
        <Input aria-label="프리셋 이름" placeholder="프리셋 이름" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {MODULES.map((m) => (
            <label key={m.id} className="grid gap-1 text-xs">
              <span className="text-muted-foreground">{m.label}</span>
              <NativeSelect value={perms[m.id]} onChange={(e) => setPerms((p) => ({ ...p, [m.id]: e.target.value as Level }))}>
                {levelOptions(m.id).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={!dirty || !name.trim() || save.isPending} onClick={() => void submit()}>
            저장
          </Button>
          {isNew ? (
            <Button size="sm" variant="ghost" onClick={onDone}>
              취소
            </Button>
          ) : (
            <ConfirmButton
              size="sm"
              variant="ghost"
              title="프리셋을 삭제할까요?"
              description={`'${preset.name}' 프리셋이 삭제됩니다. 이미 승인된 계정의 권한은 그대로입니다.`}
              confirmLabel="삭제"
              onConfirm={() => remove.mutateAsync(preset.id)}
            >
              삭제
            </ConfirmButton>
          )}
        </div>
        <ErrorAlert error={save.error ?? remove.error} />
      </CardContent>
    </Card>
  );
}
