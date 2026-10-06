import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { Building2Icon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { useCreateCompany, useMyCompanies } from "@/api/company";
import { useMe } from "@/api/me";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** /company: 소속 회사가 하나면 바로 들어가고, 여러 개면 고르기. Host는 회사를 개설할 수 있다 */
export function CompanyListPage() {
  const me = useMe();
  const companies = useMyCompanies();
  const create = useCreateCompany();
  const navigate = useNavigate();
  const [name, setName] = useState("");

  if (companies.isPending || !me.data) return <main className="p-4"><InlineSpinner /></main>;
  if (companies.isError) return <main className="p-4"><ErrorAlert error={companies.error} /></main>;
  const isHost = me.data.isHost;
  if (companies.data.length === 1 && !isHost) return <Navigate to={`/company/${companies.data[0]!.id}`} replace />;

  return (
    <main className="mx-auto grid max-w-xl gap-4 p-4 md:p-6">
      <h1 className="flex items-center gap-2.5 text-xl font-bold tracking-tight">
        <span className="grid size-7 place-items-center rounded-lg bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900 [&_svg]:size-4">
          <Building2Icon />
        </span>
        회사
      </h1>
      {companies.data.length === 0 && !isHost && <p className="text-sm text-muted-foreground">소속된 회사가 없습니다. 회사 관리자에게 초대 링크를 받아 여세요.</p>}
      <ul className="grid gap-2">
        {companies.data.map((c) => (
          <li key={c.id}>
            <Link to={`/company/${c.id}`} className="flex items-center gap-3 rounded-2xl border bg-card p-4 hover:bg-muted/50">
              <Building2Icon className="size-5 text-muted-foreground" />
              <span className="flex-1 font-medium">{c.name}</span>
              {c.isAdmin && <span className="text-xs text-muted-foreground">관리자</span>}
              <ChevronRightIcon className="size-4 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
      {isHost && (
        <form
          className="grid gap-2 rounded-2xl border bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(name.trim(), { onSuccess: (c) => void navigate(`/company/${c.id}`) });
          }}
        >
          <p className="text-sm font-medium">회사 개설 (Host)</p>
          <div className="flex gap-2">
            <Input placeholder="회사 이름" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
            <Button type="submit" className="h-9" disabled={!name.trim() || create.isPending}>
              <PlusIcon /> 개설
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">개설한 사람이 첫 관리자가 됩니다. 직원은 회사 안 "직원·권한"에서 초대합니다.</p>
          <ErrorAlert error={create.error} />
        </form>
      )}
    </main>
  );
}
