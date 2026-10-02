import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

// backend/domains/hub.py 와 같은 구조
export type HubKind = "snippet" | "link";
export type HubLang = "bash" | "powershell" | "python" | "javascript" | "typescript" | "json" | "yaml" | "sql" | "hcl" | "dockerfile" | "xml" | "css" | "go" | "java" | "plaintext";
export type HubItem = {
  id: string;
  kind: HubKind;
  title: string;
  lang?: HubLang;
  code?: string;
  url?: string;
  description: string;
  tags: string[];
  favorite: boolean;
  collectionId?: string;
  createdAt: string;
  updatedAt: string;
};
export type HubInput = Partial<Omit<HubItem, "id" | "kind" | "createdAt" | "updatedAt" | "collectionId">> & { collectionId?: string | null };
export type Collection = { id: string; name: string; order: number };

export const LANGS: { value: HubLang; label: string }[] = [
  { value: "bash", label: "Bash" },
  { value: "powershell", label: "PowerShell" },
  { value: "python", label: "Python" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "sql", label: "SQL" },
  { value: "hcl", label: "Terraform (HCL)" },
  { value: "dockerfile", label: "Dockerfile" },
  { value: "xml", label: "HTML/XML" },
  { value: "css", label: "CSS" },
  { value: "go", label: "Go" },
  { value: "java", label: "Java" },
  { value: "plaintext", label: "텍스트" },
];
export const langLabel = (l?: HubLang) => LANGS.find((x) => x.value === l)?.label ?? "텍스트";

const KEY = ["hub"];

export function useHubItems(enabled = true) {
  return useQuery({ queryKey: [...KEY, "items"], queryFn: () => api.get<{ items: HubItem[] }>("/hub"), select: (d) => d.items, enabled });
}
export function useCollections() {
  return useQuery({ queryKey: [...KEY, "collections"], queryFn: () => api.get<{ collections: Collection[] }>("/hub/collections"), select: (d) => d.collections });
}

export function useHubMutations() {
  const qc = useQueryClient();
  const settled = () => void qc.invalidateQueries({ queryKey: KEY });
  return {
    create: useMutation({ mutationFn: (input: HubInput & { kind: HubKind; title: string }) => api.post<HubItem>("/hub", input), onSettled: settled }),
    patch: useMutation({ mutationFn: ({ id, ...input }: HubInput & { id: string }) => api.patch<HubItem>(`/hub/${id}`, input), onSettled: settled }),
    remove: useMutation({ mutationFn: (id: string) => api.del(`/hub/${id}`), onSettled: settled }),
    createCollection: useMutation({ mutationFn: (name: string) => api.post<Collection>("/hub/collections", { name }), onSettled: settled }),
    patchCollection: useMutation({ mutationFn: ({ id, ...body }: { id: string; name?: string; order?: number }) => api.patch<Collection>(`/hub/collections/${id}`, body), onSettled: settled }),
    removeCollection: useMutation({ mutationFn: (id: string) => api.del(`/hub/collections/${id}`), onSettled: settled }),
  };
}

/** 제목·코드·URL·설명·태그 검색 (여러 단어는 모두 포함) */
export function matchesHub(item: HubItem, q: string): boolean {
  if (!q) return true;
  const text = [item.title, item.code, item.url, item.description, item.tags.join(" ")].join("\n").toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => text.includes(w));
}

/** 클립보드 복사 (HTTPS·localhost에서만 동작) */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
