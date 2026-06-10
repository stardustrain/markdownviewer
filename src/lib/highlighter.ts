/**
 * @fileoverview 모듈 로드 시점에 한 번 생성되는 동기 Shiki 하이라이터 싱글턴입니다.
 * react-markdown의 <Markdown>은 동기 렌더라 비동기 하이라이터를 쓸 수 없어(runSync 크래시),
 * createHighlighterCoreSync + JS 정규식 엔진으로 완전 동기 생성합니다.
 * 테마/언어는 정적 import만 번들에 포함됩니다(fine-grained). 언어 추가 = import 한 줄 + langs 배열 한 줄.
 * 동작 검증은 MarkdownView.spec.tsx의 코드펜스 테스트가 담당합니다.
 */
import langBash from "@shikijs/langs/bash";
import langCss from "@shikijs/langs/css";
import langHtml from "@shikijs/langs/html";
import langJavascript from "@shikijs/langs/javascript";
import langJson from "@shikijs/langs/json";
import langMarkdown from "@shikijs/langs/markdown";
import langPython from "@shikijs/langs/python";
import langRust from "@shikijs/langs/rust";
import langSql from "@shikijs/langs/sql";
import langTsx from "@shikijs/langs/tsx";
import langTypescript from "@shikijs/langs/typescript";
import langYaml from "@shikijs/langs/yaml";
import githubDark from "@shikijs/themes/github-dark";
import githubLight from "@shikijs/themes/github-light";
import { createHighlighterCoreSync } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

export const highlighter = createHighlighterCoreSync({
  themes: [githubLight, githubDark],
  langs: [
    langBash,
    langCss,
    langHtml,
    langJavascript,
    langJson,
    langMarkdown,
    langPython,
    langRust,
    langSql,
    langTsx,
    langTypescript,
    langYaml,
  ],
  // forgiving: 변환 불가한 문법은 조용히 부분 하이라이팅(스펙 §5에서 수용)
  engine: createJavaScriptRegexEngine({ forgiving: true }),
});
