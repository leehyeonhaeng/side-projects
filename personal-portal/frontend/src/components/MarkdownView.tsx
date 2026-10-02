import Markdown from "react-markdown";
import { cn } from "@/lib/utils";

/** 마크다운 표시. HTML 태그는 렌더링하지 않고, 링크는 새 탭으로 */
export function MarkdownView({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("grid gap-2 rounded-lg border bg-muted/30 p-2 text-sm break-words [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-medium [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_ul]:list-disc [&_ul]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground", className)}>
      <Markdown
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
