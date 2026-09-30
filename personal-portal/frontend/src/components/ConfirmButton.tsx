import { type ComponentProps, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = Omit<ComponentProps<typeof Button>, "onClick"> & {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<unknown>;
};

/** 되돌릴 수 없는 작업(거절·삭제·정지 등)은 한 번 더 확인한다 */
export function ConfirmButton({ title, description, confirmLabel, onConfirm, children, ...buttonProps }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button {...buttonProps} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>취소</DialogClose>
            <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
