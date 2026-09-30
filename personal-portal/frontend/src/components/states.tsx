import type { ReactNode } from "react";
import { Loader2Icon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function PageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center text-muted-foreground" role="status" aria-label="불러오는 중">
      <Loader2Icon className="size-6 animate-spin" />
    </div>
  );
}

export function InlineSpinner() {
  return <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-label="불러오는 중" />;
}

export function CenteredMessage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-6 text-sm">
      <h1 className="text-xl font-semibold">{title}</h1>
      {children}
    </main>
  );
}

export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <Alert variant="destructive">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}
