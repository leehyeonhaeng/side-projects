import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** 코드 표시. highlight.js는 처음 쓸 때 불러오고, 그전에는 그냥 글자로 보여준다.
 * highlight.js 출력은 코드를 이스케이프한 HTML이라 dangerouslySetInnerHTML로 넣어도 안전하다 */
export function CodeBlock({ code, lang, className }: { code: string; lang: string; className?: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void import("./highlight").then(({ highlight }) => alive && setHtml(highlight(code, lang)));
    return () => {
      alive = false;
    };
  }, [code, lang]);

  return (
    <pre className={cn("hljs overflow-x-auto rounded-lg bg-muted/60 p-3 font-mono text-xs leading-relaxed", className)}>
      {html === null ? <code>{code}</code> : <code dangerouslySetInnerHTML={{ __html: html }} />}
    </pre>
  );
}
