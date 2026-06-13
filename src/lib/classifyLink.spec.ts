import { classifyLink } from "./classifyLink";

const context = describe;

describe("classifyLink", () => {
  context("스킴이 있는 href인 경우", () => {
    test.each([
      ["https://tauri.app/docs", { kind: "external", url: "https://tauri.app/docs" }],
      ["mailto:someone@example.com", { kind: "external", url: "mailto:someone@example.com" }],
    ])("'%s'를 external로 분류합니다.", (href, expected) => {
      expect(classifyLink({ href })).toEqual(expected);
    });
  });

  context("지원하지 않는 형태인 경우", () => {
    test.each([[""], ["/abs/path.md"], ["//host/share.md"]])("'%s'를 ignored로 분류합니다.", (href) => {
      expect(classifyLink({ href })).toEqual({ kind: "ignored" });
    });
  });

  context("fragment만 있는 href인 경우", () => {
    test("경로가 비어 ignored로 분류합니다.", () => {
      // MarkdownView가 앵커를 위임 전에 거르지만, 도달해도 fragment 분리 후
      // 빈 경로가 되어 ignored가 되는 총함수 계약을 고정한다
      expect(classifyLink({ href: "#section" })).toEqual({ kind: "ignored" });
    });
  });

  context("상대 경로인 경우", () => {
    test("경로를 그대로 relative로 분류합니다.", () => {
      expect(classifyLink({ href: "./other.md" })).toEqual({
        kind: "relative",
        path: "./other.md",
      });
    });

    test("접두사 없는 경로도 relative로 분류합니다.", () => {
      expect(classifyLink({ href: "sub/no-prefix.md" })).toEqual({
        kind: "relative",
        path: "sub/no-prefix.md",
      });
    });

    test("percent-encoded 경로를 디코딩합니다.", () => {
      expect(classifyLink({ href: "%ED%95%9C%EA%B8%80%20%EB%85%B8%ED%8A%B8.md" })).toEqual({
        kind: "relative",
        path: "한글 노트.md",
      });
    });

    test("fragment를 떼어내고 경로만 남깁니다.", () => {
      expect(classifyLink({ href: "./other.md#%EC%84%B9%EC%85%98" })).toEqual({
        kind: "relative",
        path: "./other.md",
      });
    });

    test("디코딩에 실패하는 % 시퀀스는 raw 그대로 반환합니다.", () => {
      // "%of"는 normalizeUri를 통과하지만(영숫자 2자) 유효한 인코딩이 아니다 — URIError
      expect(classifyLink({ href: "50%off.md" })).toEqual({
        kind: "relative",
        path: "50%off.md",
      });
    });

    test("'+'는 공백이 아닌 리터럴로 보존합니다.", () => {
      expect(classifyLink({ href: "a+b.md" })).toEqual({
        kind: "relative",
        path: "a+b.md",
      });
    });
  });
});
