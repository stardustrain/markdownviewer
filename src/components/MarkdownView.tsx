import rehypeShikiFromHighlighter from "@shikijs/rehype/core";
import Markdown, { type Options } from "react-markdown";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import { highlighter } from "../lib/highlighter";

const remarkPlugins: Options["remarkPlugins"] = [remarkGfm, remarkFrontmatter];

const shikiOptions = {
  themes: { light: "github-light", dark: "github-dark" },
  // light-dark() 인라인 색상 — :root { color-scheme: light dark }가 전제(Task 7의 App.css)
  defaultColor: "light-dark()",
  // 미지원 언어/언어 없는 펜스가 절대 throw하지 않게 하는 안전망
  fallbackLanguage: "text",
  defaultLanguage: "text",
  // 주의: lazy: true 금지 — 파이프라인이 비동기가 되어 동기 <Markdown>이 크래시한다
};

// PluginTuple 형태로 선언 — react-markdown의 rehypePlugins prop은 PluggableList(= Pluggable[])를 기대하고,
// PluginTuple은 [plugin, ...settings] 형태의 Pluggable이다.
// satisfies/as 없이 명시적 타입으로 선언해 type assertion을 피한다.
const rehypePlugins: [
  typeof rehypeShikiFromHighlighter,
  typeof highlighter,
  typeof shikiOptions,
][] = [[rehypeShikiFromHighlighter, highlighter, shikiOptions]];

type MarkdownViewProps = {
  /** 렌더할 마크다운 원문 */
  source: string;
  /** 본문 링크 클릭 시 호출 — App이 기본 브라우저 열기(openUrl)를 주입한다 */
  onLinkClick: (args: { url: string }) => void;
};

export function MarkdownView({ source }: MarkdownViewProps) {
  return (
    <article className="markdown-body">
      <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
        {source}
      </Markdown>
    </article>
  );
}
