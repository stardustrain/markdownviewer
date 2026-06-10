/**
 * @fileoverview 절대 경로가 이 앱이 여는 마크다운 파일인지 판정합니다.
 * 허용 확장자 상수는 파일 열기 다이얼로그의 filter(App.tsx)와 드롭 경로 판정이 공유합니다.
 */

export const MARKDOWN_EXTENSIONS = ["md", "markdown", "mdx"];

export function isMarkdownPath({ path }: { path: string }): boolean {
  const extensionMatch = path.toLowerCase().match(/\.([a-z]+)$/);
  if (extensionMatch === null) {
    return false;
  }
  return MARKDOWN_EXTENSIONS.includes(extensionMatch[1]);
}
