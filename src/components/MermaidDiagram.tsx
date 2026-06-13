import { useEffect, useState } from "react";
import { type MermaidTheme, type RenderMermaidDiagramParams, renderMermaidDiagram } from "../lib/renderMermaidDiagram";

export type ColorSchemeSubscriber = (args: { onChange: (args: { isDark: boolean }) => void }) => () => void;

type DiagramState = { status: "pending" } | { status: "rendered"; svg: string } | { status: "error"; message: string };

type MermaidDiagramProps = {
  /** mermaid 다이어그램 원문 */
  code: string;
  /** 다이어그램 렌더 함수 — jsdom에서 mermaid가 동작하지 않아 테스트에서 주입
   * @default renderMermaidDiagram
   */
  renderDiagram?: (args: RenderMermaidDiagramParams) => Promise<{ svg: string }>;
  /** OS 컬러 스킴 구독 — 구독 즉시 현재 값을 동기 1회 전달 후 변경마다 전달
   * @default matchMedia("(prefers-color-scheme: dark)") 래퍼
   */
  subscribeColorScheme?: ColorSchemeSubscriber;
};

export function MermaidDiagram({
  code,
  renderDiagram = renderMermaidDiagram,
  subscribeColorScheme = subscribeToPrefersDark,
}: MermaidDiagramProps) {
  // null = 구독이 초기값을 주기 전 — 잘못된 테마로 렌더했다 버리는 것을 방지
  const [isDark, setIsDark] = useState<boolean | null>(null);
  const [diagram, setDiagram] = useState<DiagramState>({ status: "pending" });

  useEffect(() => {
    return subscribeColorScheme({
      onChange: ({ isDark: nextIsDark }) => {
        setIsDark(nextIsDark);
      },
    });
  }, [subscribeColorScheme]);

  useEffect(() => {
    if (isDark === null) {
      return;
    }
    // code/테마 변경·unmount 후 늦게 도착하는 이전 렌더 결과를 무시한다
    let cancelled = false;
    const theme: MermaidTheme = isDark ? "dark" : "default";
    renderDiagram({ id: nextDiagramId(), code, theme }).then(
      ({ svg }) => {
        if (cancelled) {
          return;
        }
        setDiagram({ status: "rendered", svg });
      },
      (error: unknown) => {
        if (cancelled) {
          return;
        }
        setDiagram({ status: "error", message: String(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [code, isDark, renderDiagram]);

  if (diagram.status === "rendered") {
    return (
      <div
        className="mermaid-diagram"
        // mermaid의 산출물이 SVG 문자열이라 DOM 직접 삽입 외 방법이 없다
        dangerouslySetInnerHTML={{ __html: diagram.svg }}
      />
    );
  }
  return (
    <div className="mermaid-diagram">
      {diagram.status === "error" && <p role="alert">mermaid 렌더 실패: {diagram.message}</p>}
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

let diagramSequence = 0;

// React useId()는 ":"를 포함해 mermaid 내부 selector와 충돌할 수 있어 모듈 카운터를 쓴다(스펙 §2)
function nextDiagramId(): string {
  diagramSequence += 1;
  return `mermaid-diagram-${diagramSequence}`;
}

function subscribeToPrefersDark({ onChange }: { onChange: (args: { isDark: boolean }) => void }): () => void {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handleChange = (event: MediaQueryListEvent) => {
    onChange({ isDark: event.matches });
  };
  mediaQuery.addEventListener("change", handleChange);
  onChange({ isDark: mediaQuery.matches });
  return () => {
    mediaQuery.removeEventListener("change", handleChange);
  };
}
