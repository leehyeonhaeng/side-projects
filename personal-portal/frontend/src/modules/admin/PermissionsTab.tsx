import { usePermissionMatrix, useUpdatePerms } from "@/api/admin";
import { NativeSelect } from "@/components/NativeSelect";
import { ErrorAlert, InlineSpinner } from "@/components/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type Level, MODULES, levelOptions } from "@/modules/meta";
import { STATUS_LABEL } from "./format";

/** 사용자 × 모듈 권한 표. 셀을 바꾸면 바로 저장되고 활동 로그에 남는다. */
export function PermissionsTab() {
  const matrix = usePermissionMatrix();
  const update = useUpdatePerms();

  if (matrix.isPending) return <InlineSpinner />;
  if (matrix.isError) return <ErrorAlert error={matrix.error} />;

  return (
    <div className="grid gap-2">
      <ErrorAlert error={update.error} />
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-background">사용자</TableHead>
              {MODULES.map((m) => (
                <TableHead key={m.id}>{m.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {matrix.data.map((row) => (
              <TableRow key={row.sub}>
                <TableCell className="sticky left-0 bg-background">
                  <div className="font-medium">{row.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {row.email}
                    {row.status !== "active" && ` · ${STATUS_LABEL[row.status]}`}
                  </div>
                </TableCell>
                {MODULES.map((m) => (
                  <TableCell key={m.id}>
                    {row.role === "host" ? (
                      <span className="text-xs text-muted-foreground">전체</span>
                    ) : (
                      <NativeSelect
                        aria-label={`${row.name} ${m.label} 권한`}
                        value={row.perms[m.id]}
                        disabled={update.isPending}
                        onChange={(e) => update.mutate({ sub: row.sub, perms: { [m.id]: e.target.value as Level } })}
                      >
                        {levelOptions(m.id).map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </NativeSelect>
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
