import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";

export type Health = { status: string; service: string };

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => apiFetch<Health>("/health"),
  });
}
