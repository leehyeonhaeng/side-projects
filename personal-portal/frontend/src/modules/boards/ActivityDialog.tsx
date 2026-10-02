import { type BoardDetail, describeActivity, formatTime, useActivity } from "@/api/boards";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** 보드 전체 최근 활동 (최신 50개). 카드를 누르면 그 카드를 연다 */
export function ActivityDialog({ data, onOpenCard, onClose }: { data: BoardDetail; onOpenCard: (cardId: string) => void; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>활동</DialogTitle>
          <DialogDescription>최근 50개</DialogDescription>
        </DialogHeader>
        <ActivityList data={data} showCard onOpenCard={(id) => data.cards.some((c) => c.id === id) && onOpenCard(id)} />
      </DialogContent>
    </Dialog>
  );
}

/** 활동 목록. cardId가 있으면 그 카드 이력만 (카드 상세) */
export function ActivityList({ data, cardId, showCard, onOpenCard }: { data: BoardDetail; cardId?: string; showCard?: boolean; onOpenCard?: (cardId: string) => void }) {
  const activity = useActivity(data.board.id, cardId);
  const name = (sub?: string) => data.members.find((m) => m.sub === sub)?.name || "(나간 멤버)";

  if (activity.isPending) return <InlineSpinner />;
  if (activity.isError) return <ErrorAlert error={activity.error} />;
  if (activity.data.length === 0) return <p className="text-xs text-muted-foreground">기록이 없습니다.</p>;
  return (
    <ul className="grid gap-1.5">
      {activity.data.map((a, i) => (
        <li key={`${a.at}-${i}`} className="grid gap-0.5 text-sm">
          <span>
            <b className="font-medium">{name(a.actor)}</b>{" "}
            {showCard && (
              <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => onOpenCard?.(a.cardId)}>
                {a.cardTitle}
              </button>
            )}{" "}
            <span className="text-muted-foreground">{describeActivity(a, name)}</span>
          </span>
          <span className="text-[11px] text-muted-foreground">{formatTime(a.at)}</span>
        </li>
      ))}
    </ul>
  );
}
