import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RenderMermaidDiagramParams } from "../lib/renderMermaidDiagram";
import { MarkdownView } from "./MarkdownView";

const context = describe;

describe("MarkdownView", () => {
  context("GFM 문법이 포함된 경우", () => {
    test("표를 table 요소로 렌더합니다.", () => {
      render(<MarkdownView source={"| a | b |\n| - | - |\n| 1 | 2 |"} onLinkClick={noopLinkClick} />);

      expect(screen.getByRole("table")).toBeInTheDocument();
    });

    test("체크박스 목록을 checkbox input으로 렌더합니다.", () => {
      render(<MarkdownView source={"- [x] 완료\n- [ ] 미완료"} onLinkClick={noopLinkClick} />);

      expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    });

    test("취소선을 del 요소로 렌더합니다.", () => {
      const { container } = render(<MarkdownView source={"~~지운 텍스트~~"} onLinkClick={noopLinkClick} />);

      expect(container.querySelector("del")).toHaveTextContent("지운 텍스트");
    });
  });
  context("코드 펜스가 포함된 경우", () => {
    test("번들된 언어는 shiki가 light-dark() 색상으로 하이라이팅합니다.", () => {
      const { container } = render(
        <MarkdownView source={"```typescript\nconst answer: number = 42\n```"} onLinkClick={noopLinkClick} />,
      );

      const shikiPre = container.querySelector("pre.shiki");
      expect(shikiPre).not.toBeNull();
      expect(shikiPre?.querySelector('span[style*="light-dark("]')).not.toBeNull();
    });

    test("번들되지 않은 언어는 코드 내용을 그대로 렌더합니다(throw 없음).", () => {
      const { container } = render(<MarkdownView source={"```brainfuck\n+++>++\n```"} onLinkClick={noopLinkClick} />);

      expect(container.querySelector("pre code")).toHaveTextContent("+++>++");
    });

    test("언어가 없는 펜스도 코드 내용을 그대로 렌더합니다.", () => {
      const { container } = render(<MarkdownView source={"```\nplain text\n```"} onLinkClick={noopLinkClick} />);

      expect(container.querySelector("pre code")).toHaveTextContent("plain text");
    });

    test("한도를 초과하는 긴 줄은 토큰화하지 않고 원문 그대로 렌더합니다.", () => {
      const longLine = `const x = "${"a".repeat(3000)}";`;
      const { container } = render(
        <MarkdownView
          source={`\`\`\`typescript\nconst y: number = 42;\n${longLine}\n\`\`\``}
          onLinkClick={noopLinkClick}
        />,
      );

      // 같은 펜스의 짧은 줄은 정상 하이라이팅된다
      const styledSpans = [...container.querySelectorAll('span[style*="light-dark("]')];
      expect(styledSpans.length).toBeGreaterThan(0);
      // 초과 줄은 스타일 토큰 없이 원문만 유지된다 (minified 류 병리적 입력 가드)
      expect(styledSpans.some((span) => span.textContent?.includes("aaaa"))).toBe(false);
      expect(container.querySelector("pre code")?.textContent).toContain(longLine);
    });
  });
  context("마크다운 내 HTML 태그가 있는 경우", () => {
    test("kbd 같은 인라인 태그를 렌더합니다.", () => {
      const { container } = render(
        <MarkdownView source={"<kbd>Cmd</kbd> + <kbd>O</kbd>"} onLinkClick={noopLinkClick} />,
      );

      expect(container.querySelectorAll("kbd")).toHaveLength(2);
    });

    test("details/summary 블록을 렌더합니다.", () => {
      const { container } = render(
        <MarkdownView source={"<details><summary>요약</summary>본문</details>"} onLinkClick={noopLinkClick} />,
      );

      expect(container.querySelector("details")).toHaveTextContent("요약");
    });
  });

  context("헤딩이 있는 경우", () => {
    test("한글 헤딩에 slug id를 생성합니다.", () => {
      render(<MarkdownView source={"# 한글 제목"} onLinkClick={noopLinkClick} />);

      expect(screen.getByRole("heading", { name: "한글 제목" })).toHaveAttribute("id", "한글-제목");
    });

    test("raw HTML 헤딩에도 id를 생성합니다.", () => {
      render(<MarkdownView source={"<h2>요약 정리</h2>"} onLinkClick={noopLinkClick} />);

      expect(screen.getByRole("heading", { name: "요약 정리" })).toHaveAttribute("id", "요약-정리");
    });
  });

  context("본문에 링크가 있는 경우", () => {
    test("링크 클릭 시 onLinkClick을 href로 호출합니다.", async () => {
      const user = userEvent.setup();
      const clickedUrls: string[] = [];
      render(
        <MarkdownView
          source={"[공식 문서](https://tauri.app/)"}
          onLinkClick={({ url }) => {
            clickedUrls.push(url);
          }}
        />,
      );

      await user.click(screen.getByRole("link", { name: "공식 문서" }));

      expect(clickedUrls).toEqual(["https://tauri.app/"]);
    });

    test("링크 클릭의 기본 네비게이션을 막습니다.", () => {
      render(<MarkdownView source={"[공식 문서](https://tauri.app/)"} onLinkClick={noopLinkClick} />);

      const link = screen.getByRole("link", { name: "공식 문서" });
      const clickEvent = createEvent.click(link);
      fireEvent(link, clickEvent);

      expect(clickEvent.defaultPrevented).toBe(true);
    });

    test("앵커 링크는 기본 동작을 막지 않고 onLinkClick도 호출하지 않습니다.", () => {
      const clickedUrls: string[] = [];
      render(
        <MarkdownView
          source={"# 한글 제목\n\n[위로](#한글-제목)"}
          onLinkClick={({ url }) => {
            clickedUrls.push(url);
          }}
        />,
      );

      const link = screen.getByRole("link", { name: "위로" });
      const clickEvent = createEvent.click(link);
      fireEvent(link, clickEvent);

      expect(clickEvent.defaultPrevented).toBe(false);
      expect(clickedUrls).toEqual([]);
    });

    test("href가 없는 앵커는 onLinkClick을 호출하지 않습니다.", async () => {
      const user = userEvent.setup();
      const clickedUrls: string[] = [];
      render(
        <MarkdownView
          source={"<a>이름 없는 앵커</a>"}
          onLinkClick={({ url }) => {
            clickedUrls.push(url);
          }}
        />,
      );

      await user.click(screen.getByText("이름 없는 앵커"));

      expect(clickedUrls).toEqual([]);
    });
  });

  context("mermaid 코드 펜스가 포함된 경우", () => {
    test("mermaid 펜스를 다이어그램으로 렌더하고 코드 원문을 전달합니다.", async () => {
      const receivedCodes: string[] = [];
      render(
        <MarkdownView
          source={"```mermaid\ngraph TD\n  A --> B\n```"}
          onLinkClick={noopLinkClick}
          mermaid={{
            renderDiagram: ({ code }) => {
              receivedCodes.push(code);
              return Promise.resolve({
                svg: '<svg role="img" aria-label="mermaid 다이어그램"></svg>',
              });
            },
            subscribeColorScheme: subscribeLightColorScheme,
          }}
        />,
      );

      expect(await screen.findByRole("img", { name: "mermaid 다이어그램" })).toBeInTheDocument();
      expect(receivedCodes).toEqual(["graph TD\n  A --> B"]);
    });

    test("다이어그램을 pre 코드박스 안에 렌더하지 않습니다.", async () => {
      render(
        <MarkdownView
          source={"```mermaid\ngraph TD\n```"}
          onLinkClick={noopLinkClick}
          mermaid={{
            renderDiagram: resolveNamedSvgDiagram,
            subscribeColorScheme: subscribeLightColorScheme,
          }}
        />,
      );

      const diagram = await screen.findByRole("img", {
        name: "mermaid 다이어그램",
      });
      // hName 방식의 결함(pre 래퍼 잔존) 회귀 검증 — 스펙 §2 가로채기 지점
      expect(diagram.closest("pre")).toBeNull();
    });

    test("mermaid 펜스가 있어도 다른 코드 펜스는 shiki가 하이라이팅합니다.", () => {
      const { container } = render(
        <MarkdownView
          source={"```mermaid\ngraph TD\n```\n\n```typescript\nconst answer = 42\n```"}
          onLinkClick={noopLinkClick}
          mermaid={{
            renderDiagram: neverResolveDiagram,
            subscribeColorScheme: subscribeLightColorScheme,
          }}
        />,
      );

      expect(container.querySelector("pre.shiki")).not.toBeNull();
      expect(container.querySelector("pre.shiki")).toHaveTextContent("const answer = 42");
    });

    test("source가 바뀌어도 같은 mermaid 펜스의 다이어그램은 유지하고 다시 렌더하지 않습니다.", async () => {
      const receivedCodes: string[] = [];
      // components remount 회귀 검증 — DI 객체는 rerender 간 참조가 안정적이어야 한다
      const stableMermaid = {
        renderDiagram: ({ code }: RenderMermaidDiagramParams) => {
          receivedCodes.push(code);
          return Promise.resolve({
            svg: '<svg role="img" aria-label="mermaid 다이어그램"></svg>',
          });
        },
        subscribeColorScheme: subscribeLightColorScheme,
      };
      const { rerender } = render(
        <MarkdownView
          source={"# v1\n\n```mermaid\ngraph TD\n```"}
          onLinkClick={noopLinkClick}
          mermaid={stableMermaid}
        />,
      );
      await screen.findByRole("img", { name: "mermaid 다이어그램" });

      rerender(
        <MarkdownView
          source={"# v2 바뀐 본문\n\n```mermaid\ngraph TD\n```"}
          onLinkClick={noopLinkClick}
          mermaid={stableMermaid}
        />,
      );

      // remount되면 pending으로 초기화되어 SVG가 사라지고 재호출이 발생한다 (스펙 §2 components 안정성)
      expect(screen.getByRole("img", { name: "mermaid 다이어그램" })).toBeInTheDocument();
      expect(receivedCodes).toHaveLength(1);
    });
  });

  context("YAML frontmatter가 있는 경우", () => {
    test("frontmatter는 본문에 표시하지 않습니다.", () => {
      render(<MarkdownView source={"---\ntitle: secret\n---\n\n# 제목"} onLinkClick={noopLinkClick} />);

      expect(screen.queryByText(/title: secret/)).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "제목" })).toBeInTheDocument();
    });
  });
});

function noopLinkClick() {
  // 링크 클릭을 검증하지 않는 테스트용 no-op
}

function subscribeLightColorScheme({ onChange }: { onChange: (args: { isDark: boolean }) => void }): () => void {
  onChange({ isDark: false });
  return () => {
    // 해제할 리소스가 없는 테스트용 구독자
  };
}

function resolveNamedSvgDiagram(): Promise<{ svg: string }> {
  return Promise.resolve({
    svg: '<svg role="img" aria-label="mermaid 다이어그램"></svg>',
  });
}

function neverResolveDiagram(): Promise<{ svg: string }> {
  return new Promise(() => {
    // 테스트가 끝날 때까지 의도적으로 완료하지 않는 렌더러
  });
}
