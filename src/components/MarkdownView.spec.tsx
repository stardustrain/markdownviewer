import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
