import { isMarkdownPath } from "./isMarkdownPath";

describe("isMarkdownPath", () => {
  test.each([
    ["/Users/lucas/note.md", true],
    ["/Users/lucas/note.markdown", true],
    ["/Users/lucas/note.mdx", true],
    ["/Users/lucas/NOTE.MD", true],
    ["/Users/lucas/image.png", false],
    ["/Users/lucas/no-extension", false],
    ["/Users/lucas/folder.md/file.txt", false],
    ["/Users/lucas/x.han/notes", false],
    ["/Users/lucas/trailing-dot.", false],
  ])("경로 %s 의 마크다운 파일 여부를 %s로 판정합니다.", (path, expected) => {
    expect(isMarkdownPath({ path })).toBe(expected);
  });
});
