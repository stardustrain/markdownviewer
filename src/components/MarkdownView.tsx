import Markdown, { type Options } from "react-markdown";
import remarkGfm from "remark-gfm";

const remarkPlugins: Options["remarkPlugins"] = [remarkGfm];

type MarkdownViewProps = {
  /** 렌더할 마크다운 원문 */
  source: string;
  /** 본문 링크 클릭 시 호출 — App이 기본 브라우저 열기(openUrl)를 주입한다 */
  onLinkClick: (args: { url: string }) => void;
};

export function MarkdownView({ source }: MarkdownViewProps) {
  return (
    <article className="markdown-body">
      <Markdown remarkPlugins={remarkPlugins}>{source}</Markdown>
    </article>
  );
}
