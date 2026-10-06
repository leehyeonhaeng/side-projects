import { Link } from "react-router";
import { ArrowLeftIcon, ChevronRightIcon } from "lucide-react";
import { COMPANY_NAV } from "./CompanyLayout";
import { useCompanyOutlet } from "./CompanyLayout";

/** 폰 하단 탭 "전체": 회사 메뉴 전부 + 행포털로 돌아가기 */
export function CompanyMorePage() {
  const { cid, detail } = useCompanyOutlet();
  const items = COMPANY_NAV.filter((n) => n.to !== "more" && n.show(detail));
  return (
    <main className="mx-auto grid max-w-2xl gap-4 p-4">
      <h1 className="text-xl font-bold tracking-tight">전체</h1>
      <ul className="grid divide-y overflow-hidden rounded-2xl border bg-card">
        {items.map((n) => (
          <li key={n.to}>
            <Link to={n.to ? `/company/${cid}/${n.to}` : `/company/${cid}`} className="flex items-center gap-3 px-4 py-3 text-sm active:bg-muted [&>svg:first-child]:size-5 [&>svg:first-child]:text-muted-foreground">
              {n.icon}
              <span className="flex-1">{n.label}</span>
              <ChevronRightIcon className="size-4 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
      <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground">
        <ArrowLeftIcon className="size-4" /> 행포털로 돌아가기
      </Link>
    </main>
  );
}
