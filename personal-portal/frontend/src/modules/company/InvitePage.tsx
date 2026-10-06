import { Link, useNavigate, useParams } from "react-router";
import { Building2Icon } from "lucide-react";
import { savePendingInvite, useAcceptInvite, useInviteInfo } from "@/api/company";
import { useSession } from "@/auth/session";
import { ErrorAlert, PageSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { AuthCard } from "@/modules/auth/AuthCard";

/** /invite/:code — 회사 초대 링크 (COMPANY.md 8장). 로그인돼 있으면 바로 참여, 아니면 가입하거나 로그인 후 참여 */
export function InvitePage() {
  const { code = "" } = useParams();
  const info = useInviteInfo(code);
  const session = useSession();
  const accept = useAcceptInvite();
  const navigate = useNavigate();

  if (info.isPending || session.isPending) return <PageSpinner />;
  if (info.isError) {
    return (
      <AuthCard title="초대 링크" description="사용할 수 없는 초대입니다.">
        <p className="text-sm text-muted-foreground">이미 사용했거나 기한(7일)이 지났거나 취소된 초대입니다. 회사 관리자에게 새 링크를 요청하세요.</p>
        <Button className="mt-4" variant="outline" nativeButton={false} render={<Link to="/" />}>
          처음으로
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={`${info.data.companyName} 초대`} description={`${info.data.roleName}(으)로 초대받았습니다.`}>
      <div className="grid gap-3">
        <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-3">
          <Building2Icon className="size-5 text-primary" />
          <span className="text-sm font-medium">{info.data.companyName}</span>
        </div>
        {session.data ? (
          <>
            <Button size="lg" disabled={accept.isPending} onClick={() => accept.mutate(code, { onSuccess: (r) => void navigate(`/company/${r.cid}`, { replace: true }) })}>
              참여하기
            </Button>
            <p className="text-xs text-muted-foreground">지금 로그인한 계정으로 회사에 참여합니다.</p>
          </>
        ) : (
          <>
            <Button size="lg" nativeButton={false} render={<Link to={`/signup?invite=${code}`} onClick={() => savePendingInvite(code)} />}>
              가입하고 참여하기
            </Button>
            <Button variant="outline" nativeButton={false} render={<Link to="/login" state={{ from: `/invite/${code}` }} />}>
              이미 계정이 있어요 (로그인 후 참여)
            </Button>
          </>
        )}
        <ErrorAlert error={accept.error} />
      </div>
    </AuthCard>
  );
}
