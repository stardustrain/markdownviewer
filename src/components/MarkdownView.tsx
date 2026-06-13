import type { RehypeShikiCoreOptions } from "@shikijs/rehype/core";
import rehypeShikiFromHighlighter from "@shikijs/rehype/core";
import { memo } from "react";
import Markdown, { type Options } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
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
  // 변경 없는 코드펜스의 재토큰화 스킵(키: lang:meta:code) — 저장 reload 시 토큰화 0회.
  // evict 없는 캐시라 펜스를 계속 다르게 편집하는 긴 세션에선 누적되지만, 단일 세션 개인 뷰어라 수용
  cache: new Map(),
  // 동일 스타일 연속 토큰을 병합해 DOM 노드 수를 줄인다
  mergeSameStyleTokens: true,
  // 이 길이 이상의 줄(minified 류)은 토큰화하지 않고 원문 그대로 렌더한다
  tokenizeMaxLineLength: 1000,
  // 주의: lazy: true 금지 — 파이프라인이 비동기가 되어 동기 <Markdown>이 크래시한다
} satisfies RehypeShikiCoreOptions;

// 주의: rehypeRaw는 raw HTML 노드를 실제 hast 노드로 변환하므로 shiki보다 먼저 와야 한다
// rehypeSlug는 rehypeRaw 뒤여야 raw HTML 헤딩에도 id가 붙는다 (스펙 §2)
const rehypePlugins: Options["rehypePlugins"] = [
  rehypeRaw,
  rehypeSlug,
  [rehypeShikiFromHighlighter, highlighter, shikiOptions],
];

type MarkdownViewProps = {
  /** 렌더할 마크다운 원문 */
  source: string;
  /** 본문 링크 클릭 시 호출 — App이 기본 브라우저 열기(openUrl)를 주입한다 */
  onLinkClick: (args: { url: string }) => void;
};

// memo: 동기 <Markdown>은 렌더마다 전체 remark/rehype 파이프라인을 다시 돌리므로,
// source/onLinkClick이 같은 App 재렌더(배너 토글 등)에서 재파싱을 통째로 건너뛴다.
// onLinkClick이 App의 stable useCallback이라는 전제가 깨지면 memo가 무력화된다
export const MarkdownView = memo(function MarkdownView({ source, onLinkClick }: MarkdownViewProps) {
  return (
    <article className="markdown-body">
      <Markdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(event) => {
                if (href === undefined || href.startsWith("#")) {
                  return; // 비링크 또는 앵커 — 네이티브 fragment 스크롤에 위임 (스펙 §2)
                }
                event.preventDefault();
                onLinkClick({ url: href });
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {source}
      </Markdown>
    </article>
  );
});
