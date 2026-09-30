import { useQuery } from "@tanstack/react-query";
import type { Level, ModuleId } from "@/modules/meta";
import { api } from "./client";

export type Me = {
  sub: string;
  email: string;
  name: string;
  role: "host" | "member";
  isHost: boolean;
  perms: Record<ModuleId, Level>;
};

export function useMe(enabled = true) {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<Me>("/me"),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}
