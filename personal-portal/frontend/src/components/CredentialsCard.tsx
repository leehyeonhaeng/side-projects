import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { copyText } from "@/api/hub";
import { Button } from "@/components/ui/button";

/** 관리자가 만들어 준 계정의 로그인 정보 (행포털 관리자 화면·회사 직원·권한 공용).
 *  임시 비밀번호는 이때 한 번만 보이므로 안내 문구를 복사해 카톡·문자로 보낸다 */
export function CredentialsCard({ heading, label, email, password, sub, onClose }: { heading: string; label?: string; email: string; password: string; sub?: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = [
    heading,
    `주소: ${location.origin}`,
    `아이디: ${email}`,
    `임시 비밀번호: ${password}`,
    "처음 로그인하면 새 비밀번호를 정해 주세요. (임시 비밀번호는 7일 안에 써야 합니다)",
  ].join("\n");
  return (
    <section className="grid gap-3 rounded-2xl border border-primary/40 bg-primary/5 p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <CheckIcon className="size-4 text-primary" /> {label ?? "계정 정보"} {sub && <span className="font-normal text-muted-foreground">· {sub}</span>}
      </p>
      <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-y-1 text-sm">
        <dt className="text-muted-foreground">아이디</dt>
        <dd className="break-all">{email}</dd>
        <dt className="text-muted-foreground">임시 비밀번호</dt>
        <dd className="font-mono text-base font-semibold tracking-wider select-all">{password}</dd>
      </dl>
      <p className="text-xs text-muted-foreground">이 화면을 닫으면 임시 비밀번호를 다시 볼 수 없습니다. 아래 내용을 복사해 카톡·문자로 보내 주세요.</p>
      <pre className="overflow-x-auto rounded-lg bg-card p-3 text-xs whitespace-pre-wrap select-all">{text}</pre>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void copyText(text).then(() => setCopied(true))}>
          {copied ? <CheckIcon /> : <CopyIcon />} {copied ? "복사했습니다" : "안내 문구 복사"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          닫기
        </Button>
      </div>
    </section>
  );
}
