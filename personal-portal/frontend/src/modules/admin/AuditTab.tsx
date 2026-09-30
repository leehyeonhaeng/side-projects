import { useState } from "react";
import { type AuditLog, useAudit } from "@/api/admin";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currentMonth, formatDateTime } from "./format";

const ACTION_LABEL: Record<string, string> = {
  login: "로그인",
  approve: "가입 승인",
  reject: "가입 거절",
  suspend: "계정 정지",
  reactivate: "계정 재활성",
  delete: "계정 삭제",
  reset_password: "비밀번호 초기화",
  perm_change: "권한 변경",
};

function describe(log: AuditLog): string {
  const d = log.detail;
  const parts: string[] = [];
  if (typeof d.email === "string") parts.push(d.email);
  if (typeof d.preset === "string") parts.push(`프리셋: ${d.preset}`);
  if (d.changes && typeof d.changes === "object") {
    parts.push(
      Object.entries(d.changes as Record<string, string>)
        .map(([k, v]) => `${k} ${v}`)
        .join(", "),
    );
  }
  return parts.join(" · ");
}

export function AuditTab() {
  const [month, setMonth] = useState(currentMonth());
  const logs = useAudit(month);

  return (
    <div className="grid gap-3">
      <Input type="month" aria-label="조회 월" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="max-w-44" />
      {logs.isPending ? (
        <InlineSpinner />
      ) : logs.isError ? (
        <ErrorAlert error={logs.error} />
      ) : logs.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">기록이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>시각</TableHead>
                <TableHead>작업</TableHead>
                <TableHead>수행자</TableHead>
                <TableHead>내용</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.data.map((log) => (
                <TableRow key={`${log.at}-${log.actor}-${log.action}`}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(log.at)}</TableCell>
                  <TableCell>{ACTION_LABEL[log.action] ?? log.action}</TableCell>
                  <TableCell>{log.actorEmail}</TableCell>
                  <TableCell className="text-muted-foreground">{describe(log)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
