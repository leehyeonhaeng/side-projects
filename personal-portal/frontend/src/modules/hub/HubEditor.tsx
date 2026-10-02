import { useState } from "react";
import { type Collection, type HubItem, type HubKind, type HubLang, LANGS, useHubMutations } from "@/api/hub";
import { ConfirmButton } from "@/components/ConfirmButton";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Props = { kind: HubKind; item: HubItem | null; collections: Collection[]; defaultCollection?: string; onClose: () => void };

/** 스니펫·링크 추가·수정. 종류는 만든 뒤 바꿀 수 없다 */
export function HubEditor({ kind, item, collections, defaultCollection, onClose }: Props) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [lang, setLang] = useState<HubLang>(item?.lang ?? "bash");
  const [code, setCode] = useState(item?.code ?? "");
  const [url, setUrl] = useState(item?.url ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [tags, setTags] = useState(item?.tags.join(", ") ?? "");
  const [collectionId, setCollectionId] = useState(item?.collectionId ?? defaultCollection ?? "");
  const [favorite, setFavorite] = useState(item?.favorite ?? false);
  const mut = useHubMutations();
  const isSnippet = kind === "snippet";
  const validUrl = /^https?:\/\//.test(url.trim());
  const canSave = !!title.trim() && (isSnippet ? !!code.trim() : validUrl);

  const save = () => {
    const input = {
      title: title.trim(),
      description: description.trim(),
      tags: [...new Set(tags.split(/[,\s]+/).map((t) => t.replace(/^#/, "").trim()).filter(Boolean))].slice(0, 20),
      collectionId: collectionId || null,
      favorite,
      ...(isSnippet ? { lang, code } : { url: url.trim() }),
    };
    if (item) mut.patch.mutate({ id: item.id, ...input }, { onSuccess: onClose });
    else mut.create.mutate({ kind, ...input }, { onSuccess: onClose });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isSnippet ? "스니펫" : "링크"} {item ? "수정" : "추가"}</DialogTitle>
        </DialogHeader>
        <form
          id="hub-form"
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) save();
          }}
        >
          <Input autoFocus placeholder="제목" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          {isSnippet ? (
            <>
              <NativeSelect value={lang} onChange={(e) => setLang(e.target.value as HubLang)} aria-label="언어" className="justify-self-start">
                {LANGS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </NativeSelect>
              <Textarea placeholder="코드·명령어" rows={8} maxLength={20000} spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} className="font-mono text-xs" />
              {lang === "hcl" && <p className="text-xs text-muted-foreground">Terraform(HCL)은 문법 강조 없이 표시됩니다.</p>}
            </>
          ) : (
            <Input type="url" placeholder="https://" maxLength={2000} value={url} onChange={(e) => setUrl(e.target.value)} aria-invalid={!!url && !validUrl} />
          )}
          <Textarea placeholder="설명 (선택)" rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
          <Input placeholder="태그 (쉼표·공백으로 구분)" value={tags} onChange={(e) => setTags(e.target.value)} />
          <div className="flex flex-wrap items-center gap-3">
            <NativeSelect value={collectionId} onChange={(e) => setCollectionId(e.target.value)} aria-label="컬렉션">
              <option value="">컬렉션 없음</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} />
              즐겨찾기
            </label>
          </div>
        </form>
        <ErrorAlert error={mut.create.error ?? mut.patch.error ?? mut.remove.error} />
        <DialogFooter className="flex-row items-center">
          {item && (
            <ConfirmButton type="button" variant="ghost" className="mr-auto" title="삭제할까요?" description={item.title} confirmLabel="삭제" onConfirm={() => mut.remove.mutateAsync(item.id).then(onClose)}>
              삭제
            </ConfirmButton>
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" form="hub-form" disabled={!canSave || mut.create.isPending || mut.patch.isPending}>
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
