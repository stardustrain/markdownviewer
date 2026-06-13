import type { RehypeShikiCoreOptions } from "@shikijs/rehype/core";
import rehypeShikiFromHighlighter from "@shikijs/rehype/core";
import type { Element } from "hast";
import type { Code } from "mdast";
import { defaultHandlers, type State } from "mdast-util-to-hast";
import { memo, useMemo } from "react";
import Markdown, { type Options } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import { highlighter } from "../lib/highlighter";
import type { RenderMermaidDiagramParams } from "../lib/renderMermaidDiagram";
import { type ColorSchemeSubscriber, MermaidDiagram } from "./MermaidDiagram";

// mermaidAwareCodeHandler가 만드는 커스텀 엘리먼트를 components 매핑이 type assertion 없이 받기 위한 선언 병합
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "mermaid-block": { code?: string };
    }
  }
}

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

// mermaid 펜스만 <pre> 래퍼 없이 변환 — react-markdown이 allowDangerousHtml을 병합하므로 rehypeRaw와 공존한다
const remarkRehypeOptions: Options["remarkRehypeOptions"] = {
  handlers: { code: mermaidAwareCodeHandler },
};

type MermaidDependencies = {
  /** 다이어그램 렌더 함수 — jsdom에 mermaid가 없어 테스트에서 주입 */
  renderDiagram?: (args: RenderMermaidDiagramParams) => Promise<{ svg: string }>;
  /** OS 컬러 스킴 구독 — jsdom에 matchMedia가 없어 테스트에서 주입 */
  subscribeColorScheme?: ColorSchemeSubscriber;
};

type MarkdownViewProps = {
  /** 렌더할 마크다운 원문 */
  source: string;
  /** 본문 링크 클릭 시 호출 — App이 기본 브라우저 열기(openUrl)를 주입한다.
   * 주의: 참조가 안정적이어야 한다(components remount 방지) — App은 모듈 레벨 함수를 주입한다 */
  onLinkClick: (args: { url: string }) => void;
  /** MermaidDiagram에 전달할 DI — 프로덕션(App)은 기본값을 쓰므로 전달하지 않는다.
   * 주의: 전달한다면 참조가 안정적이어야 한다(components remount 방지) */
  mermaid?: MermaidDependencies;
};

// memo: 동기 <Markdown>은 렌더마다 전체 remark/rehype 파이프라인을 다시 돌리므로,
// source/onLinkClick이 같은 App 재렌더(배너 토글 등)에서 재파싱을 통째로 건너뛴다.
// onLinkClick이 App의 stable useCallback이라는 전제가 깨지면 memo가 무력화된다
export const MarkdownView = memo(function MarkdownView({ source, onLinkClick, mermaid }: MarkdownViewProps) {
  // components 참조가 렌더마다 바뀌면 매핑된 컴포넌트의 element type이 달라져
  // React가 모든 MermaidDiagram을 remount(SVG 소실·깜빡임)한다 — useMemo로 고정 (스펙 §2)
  const components = useMemo<Options["components"]>(
    () => ({
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
      "mermaid-block": ({ code }) => (
        <MermaidDiagram
          code={code ?? ""}
          renderDiagram={mermaid?.renderDiagram}
          subscribeColorScheme={mermaid?.subscribeColorScheme}
        />
      ),
    }),
    [onLinkClick, mermaid],
  );

  return (
    <article className="markdown-body">
      <Markdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        remarkRehypeOptions={remarkRehypeOptions}
        components={components}
      >
        {source}
      </Markdown>
    </article>
  );
});

// remark-rehype 핸들러는 라이브러리가 정한 (state, node) 시그니처를 따른다(구조분해 파라미터 규칙의 서드파티 예외).
// hName 방식은 mdast-util-to-hast의 code 핸들러가 무조건 <pre>로 감싸 코드박스 안에 갇히므로
// 핸들러에서 bare 엘리먼트를 직접 만든다(스펙 §2 가로채기 지점).
function mermaidAwareCodeHandler(state: State, node: Code): Element {
  if (node.lang !== "mermaid") {
    return defaultHandlers.code(state, node);
  }
  return {
    type: "element",
    tagName: "mermaid-block",
    properties: { code: node.value },
    children: [],
  };
}
