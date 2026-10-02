// 허브 화면에서만 불러오는 문법 강조 (CodeBlock에서 동적 import → 별도 청크)
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const LANGUAGES = { bash, css, dockerfile, go, java, javascript, json, powershell, python, sql, typescript, xml, yaml };
for (const [name, lang] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, lang);

/** 강조된 HTML. 지원하지 않는 언어(hcl·plaintext)는 null → 그대로 표시 */
export function highlight(code: string, lang: string): string | null {
  if (!hljs.getLanguage(lang)) return null;
  return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
}
