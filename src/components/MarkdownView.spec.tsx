import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MarkdownView } from "./MarkdownView";

const context = describe;

describe("MarkdownView", () => {
  context("GFM 문법이 포함된 경우", () => {
    test("표를 table 요소로 렌더합니다.", () => {
      render(
        <MarkdownView
          source={"| a | b |\n| - | - |\n| 1 | 2 |"}
          onLinkClick={noopLinkClick}
        />,
      );

      expect(screen.getByRole("table")).toBeInTheDocument();
    });

    test("체크박스 목록을 checkbox input으로 렌더합니다.", () => {
      render(
        <MarkdownView
          source={"- [x] 완료\n- [ ] 미완료"}
          onLinkClick={noopLinkClick}
        />,
      );

      expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    });

    test("취소선을 del 요소로 렌더합니다.", () => {
      const { container } = render(
        <MarkdownView source={"~~지운 텍스트~~"} onLinkClick={noopLinkClick} />,
      );

      expect(container.querySelector("del")).toHaveTextContent("지운 텍스트");
    });
  });
  context("코드 펜스가 포함된 경우", () => {
    test("번들된 언어는 shiki가 light-dark() 색상으로 하이라이팅합니다.", () => {
      const { container } = render(
        <MarkdownView
          source={"```typescript\nconst answer: number = 42\n```"}
          onLinkClick={noopLinkClick}
        />,
      );

      const shikiPre = container.querySelector("pre.shiki");
      expect(shikiPre).not.toBeNull();
      expect(
        shikiPre?.querySelector('span[style*="light-dark("]'),
      ).not.toBeNull();
    });

    test("번들되지 않은 언어는 코드 내용을 그대로 렌더합니다(throw 없음).", () => {
      const { container } = render(
        <MarkdownView
          source={"```brainfuck\n+++>++\n```"}
          onLinkClick={noopLinkClick}
        />,
      );

      expect(container.querySelector("pre code")).toHaveTextContent("+++>++");
    });

    test("언어가 없는 펜스도 코드 내용을 그대로 렌더합니다.", () => {
      const { container } = render(
        <MarkdownView
          source={"```\nplain text\n```"}
          onLinkClick={noopLinkClick}
        />,
      );

      expect(container.querySelector("pre code")).toHaveTextContent(
        "plain text",
      );
    });
  });
});

function noopLinkClick() {
  // 링크 클릭을 검증하지 않는 테스트용 no-op
}
