import { type BoardDetail, useCandidates, type useBoardMutations } from "@/api/boards";
import { SharedMembersDialog } from "@/components/SharedMembersDialog";

/** 보드 멤버 (DESIGN.md 6.6) */
export function MembersDialog({ data, mut, onClose }: { data: BoardDetail; mut: ReturnType<typeof useBoardMutations>; onClose: () => void }) {
  const candidates = useCandidates(data.board.id, data.role === "owner");
  return (
    <SharedMembersDialog
      myRole={data.role}
      members={data.members}
      candidates={candidates}
      addMember={mut.addMember}
      patchMember={mut.patchMember}
      removeMember={mut.removeMember}
      editorHint="편집자는 카드·컬럼·라벨을 바꿀 수 있고,"
      moduleLabel="보드"
      removeNote=" — 담당인 카드는 담당자가 비워집니다."
      onClose={onClose}
    />
  );
}
