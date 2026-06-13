/**
 * @fileoverview 마크다운 본문 링크의 href를 동작 종류로 분류합니다.
 * react-markdown은 href를 percent-encoded로 전달하므로(normalizeUri) relative 경로는
 * fragment 분리 후 decodeURIComponent를 거칩니다. 분리를 decode보다 먼저 해야
 * 리터럴 `%23`과 fragment 구분자 `#`이 구분됩니다 (스펙 §2).
 * `#` 앵커는 MarkdownView가 위임 전에 거르므로 정상 흐름에선 도달하지 않습니다
 * (도달해도 분리 후 빈 경로 → ignored).
 */

export type LinkClassification =
  | { kind: "external"; url: string }
  | { kind: "relative"; path: string }
  | { kind: "ignored" };

export function classifyLink({ href }: { href: string }): LinkClassification {
  if (SCHEME_PATTERN.test(href)) {
    return { kind: "external", url: href };
  }
  if (href === "" || href.startsWith("/")) {
    return { kind: "ignored" };
  }
  const fragmentIndex = href.indexOf("#");
  const encodedPath = fragmentIndex === -1 ? href : href.slice(0, fragmentIndex);
  if (encodedPath === "") {
    return { kind: "ignored" };
  }
  return { kind: "relative", path: decodePath({ encodedPath }) };
}

const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function decodePath({ encodedPath }: { encodedPath: string }): string {
  try {
    return decodeURIComponent(encodedPath);
  } catch {
    // normalizeUri는 "%영숫자2자"를 인코딩된 것으로 보고 통과시키지만
    // 유효한 hex가 아닐 수 있다("50%off.md") — raw 그대로 사용 (스펙 §3.4)
    return encodedPath;
  }
}
