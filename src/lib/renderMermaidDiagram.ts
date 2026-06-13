/**
 * @fileoverview MermaidDiagram의 기본 렌더 구현입니다(DI 기본값).
 * mermaid(~2MB)는 dynamic import로 청크를 분리해 mermaid 펜스가 없는 문서에는 로드 비용이 없습니다(스펙 §2).
 * 렌더 직전 initialize({ theme })를 매번 호출하는 것이 mermaid의 공식 테마 전환 방법입니다.
 * suppressErrorRendering: true는 문법 오류 시 mermaid가 DOM에 직접 꽂는 에러 SVG를 차단합니다(에러 UI는 MermaidDiagram 담당).
 * jsdom에서 mermaid가 동작하지 않아(SVG 측정 필요) 단위 테스트 대신 수동 검증으로 커버합니다 — installAppMenu와 동일하게 coverage exclude (스펙 §4).
 */
export type MermaidTheme = "default" | "dark";

export type RenderMermaidDiagramParams = {
  /** mermaid가 내부 임시 엘리먼트에 쓰는 고유 id (DOM id 규칙을 따라야 한다) */
  id: string;
  /** mermaid 다이어그램 원문 */
  code: string;
  /** 라이트면 "default", 다크면 "dark" */
  theme: MermaidTheme;
};

export async function renderMermaidDiagram({ id, code, theme }: RenderMermaidDiagramParams): Promise<{ svg: string }> {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    suppressErrorRendering: true,
    theme,
  });
  const { svg } = await mermaid.render(id, code);
  return { svg };
}
