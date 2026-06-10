# 파일 열기 + 마크다운 렌더링 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 다이얼로그(Cmd+O/버튼) + 드래그&드롭으로 .md 파일을 열고, GFM + Shiki 하이라이팅(시스템 라이트/다크 연동) + raw HTML + frontmatter 처리로 렌더링한다.

**Architecture:** 경로 획득(다이얼로그 `open()` | drag-drop 이벤트) → 커스텀 Rust 커맨드 `read_file` → App 상태 → 동기 Shiki 파이프라인의 `MarkdownView` 렌더. Tauri 의존은 전부 기본값 있는 DI(props/params)로 감싸 모킹 없이 테스트한다(스펙 §4.2). Shiki는 반드시 동기 경로(`@shikijs/rehype/core` + `createHighlighterCoreSync`)를 사용 — 기본 `@shikijs/rehype`는 비동기라 react-markdown의 동기 `<Markdown>`이 크래시한다.

**Tech Stack:** Tauri 2 (plugin-dialog, plugin-opener), React 19, react-markdown 10, remark-gfm/remark-frontmatter, rehype-raw, shiki 4.2 (sync core + JS regex engine), github-markdown-css 5.9, vitest 4.1 (node/jsdom projects) + RTL.

**Spec:** `docs/superpowers/specs/2026-06-10-file-open-rendering-design.md`

**컨벤션 메모 (모든 태스크 공통):**
- TDD: 테스트 먼저 → FAIL 확인 → 최소 구현 → PASS 확인 → 커밋. TDD 예외는 스펙 §7에서 승인된 것만(Rust `read_file`, App.css/main.tsx, OS 통합 수동 확인).
- 테스트: `test-code-style` 스킬 준수 — vitest 전역 사용(import 금지), 최상위 `describe` = 대상 파일명, 분기는 `const context = describe`, 다중 입력은 `test.each`, 설명은 한국어, 모킹 금지(DI만).
- 코드: `code-style` 스킬 준수 — 함수 파라미터는 구조분해 객체(단, DOM/서드파티 콜백 시그니처는 플랫폼 형태 유지), guard clause + early return, `else if`/type assertion/non-null assertion 금지, export 함수는 파일 상단에 function 선언으로, 파일명 = 대표 export 이름.
- **스펙과의 의도적 차이:** 스펙 §4.2의 `src/lib/markdownFile.ts`는 code-style의 "파일명 = export 함수명" 규칙에 따라 `src/lib/isMarkdownPath.ts`로 구현한다(역할 동일).
- 스캐폴드 파일 다수(src/, index.html 등)가 아직 untracked다. 각 태스크는 자신이 만들거나 수정한 파일만 `git add`한다(untracked 파일도 그 시점에 처음 커밋에 포함되면 정상).
- 실행 명령은 전부 저장소 루트 기준. 패키지 매니저는 **pnpm**(npm 금지).

---

## File Structure (전체 조감)

| 동작 | 파일 | 책임 |
|---|---|---|
| 수정 | `package.json` (+lockfile) | 의존성 6개 추가 |
| 수정 | `src-tauri/Cargo.toml` | `tauri-plugin-dialog` 추가 |
| 수정 | `src-tauri/capabilities/default.json` | `dialog:default` 권한 |
| 수정 | `src-tauri/src/lib.rs` | `read_file` 커맨드, dialog 플러그인 등록, `greet` 제거 |
| 생성 | `src/lib/isMarkdownPath.ts` + `isMarkdownPath.spec.ts` | 마크다운 경로 판정 + 허용 확장자 상수 |
| 생성 | `src/lib/highlighter.ts` | 동기 Shiki 싱글턴 (MarkdownView spec이 커버) |
| 생성 | `src/components/MarkdownView.tsx` + `MarkdownView.spec.tsx` | 렌더링 파이프라인 + 링크 DI |
| 생성 | `src/hooks/useFileDrop.ts` + `useFileDrop.spec.tsx` | drag-drop 구독 (subscribe DI) |
| 교체 | `src/App.tsx` + 생성 `src/App.spec.tsx` | 상태/열기 흐름/빈 상태/에러 배너 (pickFile/readFile/subscribeDragDrop DI) |
| 수정 | `src/main.tsx` | github-markdown-css import 한 줄 |
| 교체 | `src/App.css` | 컨테이너/배경/color-scheme |
| 삭제 | `src/assets/react.svg`, `public/tauri.svg` | App.tsx 교체로 고아가 되는 스캐폴드 자산 |

---

### Task 1: 의존성 + 권한 설정

**Files:**
- Modify: `package.json` (pnpm이 자동 수정)
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: JS 의존성 추가**

Run:
```bash
pnpm add @tauri-apps/plugin-dialog github-markdown-css rehype-raw remark-frontmatter @shikijs/themes @shikijs/langs
```
Expected: 6개 패키지가 `dependencies`에 추가되고 exit 0. (현재 latest: plugin-dialog 2.7.1, github-markdown-css 5.9.0, rehype-raw 7.0.0, remark-frontmatter 5.0.0, @shikijs/themes·langs 4.2.0. 모두 build script 없음 — pnpm 승인 프롬프트가 뜨면 안 됨.)

> `@shikijs/themes`/`@shikijs/langs`는 이미 shiki의 전이 의존성으로 존재하지만 우리가 직접 import하므로 명시 선언한다(스펙 §4.5).

- [ ] **Step 2: Rust 의존성 추가**

`src-tauri/Cargo.toml`의 `[dependencies]` 블록을 다음으로 수정:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
tauri-plugin-dialog = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

- [ ] **Step 3: capability에 dialog 권한 추가**

`src-tauri/capabilities/default.json` 전체를 다음으로 교체:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "dialog:default"
  ]
}
```

> drag-drop 이벤트는 기존 `core:default`로 충분하고 `dragDropEnabled`는 기본 활성이라 tauri.conf.json 변경은 없다(스펙 §4.5).

- [ ] **Step 4: 컴파일 확인**

Run:
```bash
cargo check --manifest-path src-tauri/Cargo.toml
```
Expected: `Finished` 출력, exit 0 (plugin-dialog 크레이트 다운로드 + 컴파일).

Run:
```bash
pnpm test
```
Expected: `No test files found, exiting with code 0` (기존 green 유지).

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/capabilities/default.json
git commit -m "chore: add file-open and rendering dependencies"
```

---

### Task 2: Rust `read_file` 커맨드 (TDD 예외 — 스펙 §7 승인)

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: lib.rs 교체**

`src-tauri/src/lib.rs` 전체를 다음으로 교체 (`greet` 데모 제거, `read_file` 추가, dialog 플러그인 등록, opener 유지):

```rust
#[tauri::command]
async fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|err| err.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

> async 커맨드라 tokio worker에서 실행되어 UI를 막지 않는다. 비UTF-8/디렉터리/권한 오류는 전부 `Err(문자열)`로 떨어지고 JS의 `invoke` reject로 전달된다(스펙 §4.4 — lossy 변환하지 않기로 결정).

- [ ] **Step 2: 컴파일 확인**

Run:
```bash
cargo check --manifest-path src-tauri/Cargo.toml
```
Expected: exit 0, `greet` 참조 에러 없음.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add read_file command and register dialog plugin"
```

---

### Task 3: `isMarkdownPath` (TDD)

**Files:**
- Test: `src/lib/isMarkdownPath.spec.ts` (node 프로젝트에서 실행됨)
- Create: `src/lib/isMarkdownPath.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/isMarkdownPath.spec.ts` 생성:

```typescript
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
```

- [ ] **Step 2: FAIL 확인**

Run:
```bash
pnpm test src/lib/isMarkdownPath.spec.ts
```
Expected: FAIL — `Cannot find module './isMarkdownPath'` 류의 모듈 미존재 에러.

- [ ] **Step 3: 최소 구현**

`src/lib/isMarkdownPath.ts` 생성:

```typescript
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
```

- [ ] **Step 4: PASS 확인**

Run:
```bash
pnpm test src/lib/isMarkdownPath.spec.ts
```
Expected: PASS — 9 cases green (`node` 프로젝트에서 실행).

- [ ] **Step 5: Commit**

```bash
git add src/lib/isMarkdownPath.ts src/lib/isMarkdownPath.spec.ts
git commit -m "feat: add markdown path predicate"
```

---

### Task 4: `MarkdownView` (TDD — 5 사이클)

**Files:**
- Test: `src/components/MarkdownView.spec.tsx` (jsdom 프로젝트)
- Create: `src/components/MarkdownView.tsx`
- Create: `src/lib/highlighter.ts` (사이클 2의 GREEN에서 생성 — 동작은 이 spec이 커버, 스펙 §4.2)

각 사이클: spec에 테스트 추가 → FAIL 확인 → 구현 → PASS 확인 → 커밋.
Run/Expected는 모든 사이클 동일하므로 한 번만 적는다:

Run:
```bash
pnpm test src/components/MarkdownView.spec.tsx
```
FAIL 시 Expected: 새로 추가한 테스트만 실패(사이클 1은 모듈 미존재 에러). PASS 시 Expected: 누적 전체 green.

- [ ] **Step 1 (사이클 1 RED): GFM 테스트 작성**

`src/components/MarkdownView.spec.tsx` 생성:

```tsx
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
});

function noopLinkClick() {
  // 링크 클릭을 검증하지 않는 테스트용 no-op
}
```

- [ ] **Step 2 (사이클 1): FAIL 확인** — 모듈 미존재 에러

- [ ] **Step 3 (사이클 1 GREEN): 최소 구현**

`src/components/MarkdownView.tsx` 생성 (이 사이클은 GFM만 — shiki/raw/frontmatter는 다음 사이클에서):

```tsx
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
```

> `onLinkClick`은 `MarkdownViewProps` 타입에는 지금 선언하지만(테스트가 이미 prop을 넘기므로), tsconfig의 `noUnusedParameters: true` 때문에 **사이클 5 전까지 구조분해로 받지 않는다**. 사이클 5에서 `{ source, onLinkClick }`으로 바꾼다.

- [ ] **Step 4 (사이클 1): PASS 확인 후 Commit**

```bash
git add src/components/MarkdownView.tsx src/components/MarkdownView.spec.tsx
git commit -m "feat: render GFM markdown in MarkdownView"
```

- [ ] **Step 5 (사이클 2 RED): 코드펜스 테스트 추가**

`MarkdownView.spec.tsx`의 최상위 `describe` 안에 추가:

```tsx
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
```

- [ ] **Step 6 (사이클 2): FAIL 확인** — `pre.shiki` 미존재로 첫 테스트 실패

- [ ] **Step 7 (사이클 2 GREEN): highlighter + rehype 플러그인 구현**

`src/lib/highlighter.ts` 생성:

```typescript
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
```

`src/components/MarkdownView.tsx`의 import/플러그인 부분을 다음으로 수정:

```tsx
import rehypeShikiFromHighlighter from "@shikijs/rehype/core";
import Markdown, { type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlighter } from "../lib/highlighter";

const remarkPlugins: Options["remarkPlugins"] = [remarkGfm];

const rehypePlugins: Options["rehypePlugins"] = [
  [
    rehypeShikiFromHighlighter,
    highlighter,
    {
      themes: { light: "github-light", dark: "github-dark" },
      // light-dark() 인라인 색상 — :root { color-scheme: light dark }가 전제(Task 7의 App.css)
      defaultColor: "light-dark()",
      // 미지원 언어/언어 없는 펜스가 절대 throw하지 않게 하는 안전망
      fallbackLanguage: "text",
      defaultLanguage: "text",
      // 주의: lazy: true 금지 — 파이프라인이 비동기가 되어 동기 <Markdown>이 크래시한다
    },
  ],
];
```

`<Markdown>`에 `rehypePlugins={rehypePlugins}`를 추가:

```tsx
      <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
        {source}
      </Markdown>
```

> 타입 에러가 나면: `[rehypeShikiFromHighlighter, highlighter, { ... }]` 튜플은 unified의 `[plugin, ...settings]` 형태다. `Options["rehypePlugins"]` 주석(annotation)으로 해결되지 않으면 옵션 객체를 변수로 추출해 `satisfies` (assertion 금지)로 맞춘다.

- [ ] **Step 8 (사이클 2): PASS 확인 후 Commit**

```bash
git add src/lib/highlighter.ts src/components/MarkdownView.tsx src/components/MarkdownView.spec.tsx
git commit -m "feat: highlight code fences with sync shiki dual themes"
```

- [ ] **Step 9 (사이클 3 RED): frontmatter 테스트 추가**

최상위 `describe` 안에 추가:

```tsx
  context("YAML frontmatter가 있는 경우", () => {
    test("frontmatter는 본문에 표시하지 않습니다.", () => {
      render(
        <MarkdownView
          source={"---\ntitle: secret\n---\n\n# 제목"}
          onLinkClick={noopLinkClick}
        />,
      );

      expect(screen.queryByText(/title: secret/)).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "제목" })).toBeInTheDocument();
    });
  });
```

- [ ] **Step 10 (사이클 3): FAIL 확인** — `title: secret`이 본문에 렌더되어 실패

- [ ] **Step 11 (사이클 3 GREEN):** `MarkdownView.tsx`에 두 줄 추가

```tsx
import remarkFrontmatter from "remark-frontmatter";
```

```tsx
const remarkPlugins: Options["remarkPlugins"] = [remarkGfm, remarkFrontmatter];
```

- [ ] **Step 12 (사이클 3): PASS 확인 후 Commit**

```bash
git add src/components/MarkdownView.tsx src/components/MarkdownView.spec.tsx
git commit -m "feat: hide YAML frontmatter in MarkdownView"
```

- [ ] **Step 13 (사이클 4 RED): raw HTML 테스트 추가**

최상위 `describe` 안에 추가:

```tsx
  context("마크다운 내 HTML 태그가 있는 경우", () => {
    test("kbd 같은 인라인 태그를 렌더합니다.", () => {
      const { container } = render(
        <MarkdownView
          source={"<kbd>Cmd</kbd> + <kbd>O</kbd>"}
          onLinkClick={noopLinkClick}
        />,
      );

      expect(container.querySelectorAll("kbd")).toHaveLength(2);
    });

    test("details/summary 블록을 렌더합니다.", () => {
      const { container } = render(
        <MarkdownView
          source={"<details><summary>요약</summary>본문</details>"}
          onLinkClick={noopLinkClick}
        />,
      );

      expect(container.querySelector("details")).toHaveTextContent("요약");
    });
  });
```

- [ ] **Step 14 (사이클 4): FAIL 확인** — react-markdown 기본 동작이 raw HTML을 제거해 실패

- [ ] **Step 15 (사이클 4 GREEN):** `MarkdownView.tsx`에 rehype-raw 추가 — **반드시 shiki보다 앞** (스펙 §3)

```tsx
import rehypeRaw from "rehype-raw";
```

```tsx
const rehypePlugins: Options["rehypePlugins"] = [
  rehypeRaw,
  [
    rehypeShikiFromHighlighter,
    // ... (기존 그대로)
  ],
];
```

- [ ] **Step 16 (사이클 4): PASS 확인 후 Commit**

```bash
git add src/components/MarkdownView.tsx src/components/MarkdownView.spec.tsx
git commit -m "feat: render raw HTML tags in MarkdownView"
```

- [ ] **Step 17 (사이클 5 RED): 링크 클릭 테스트 추가**

최상위 `describe` 안에 추가:

```tsx
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
  });
```

- [ ] **Step 18 (사이클 5): FAIL 확인** — `clickedUrls`가 빈 배열로 남아 실패 (jsdom이 "Not implemented: navigation" 에러를 로그할 수 있음 — preventDefault 구현 후 사라져야 정상)

- [ ] **Step 19 (사이클 5 GREEN): 커스텀 `a` 컴포넌트**

`MarkdownView.tsx`의 컴포넌트 본문을 다음 최종형으로 교체 (사이클 1의 TS6133 회피로 `onLinkClick`을 빼놨다면 다시 받는다):

```tsx
export function MarkdownView({ source, onLinkClick }: MarkdownViewProps) {
  return (
    <article className="markdown-body">
      <Markdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(event) => {
                event.preventDefault();
                if (href === undefined) {
                  return;
                }
                onLinkClick({ url: href });
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {source}
      </Markdown>
    </article>
  );
}
```

- [ ] **Step 20 (사이클 5): PASS 확인** — 링크 테스트 포함 전체 green, jsdom navigation 에러 로그 없음(출력 pristine)

- [ ] **Step 21: Commit**

```bash
git add src/components/MarkdownView.tsx src/components/MarkdownView.spec.tsx
git commit -m "feat: open links via injected handler in MarkdownView"
```

---

### Task 5: `useFileDrop` (TDD)

**Files:**
- Test: `src/hooks/useFileDrop.spec.tsx` (jsdom 프로젝트 — renderHook 사용)
- Create: `src/hooks/useFileDrop.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/hooks/useFileDrop.spec.tsx` 생성:

```tsx
import { act, renderHook } from "@testing-library/react";
import {
  type DragDropPayload,
  type DragDropSubscriber,
  useFileDrop,
} from "./useFileDrop";

const context = describe;

describe("useFileDrop", () => {
  context("drop 이벤트가 온 경우", () => {
    test("onDrop에 paths를 전달하고 isDragging은 false입니다.", () => {
      const fakeSubscriber = createFakeDragDropSubscriber();
      const droppedPaths: string[][] = [];
      const { result } = renderHook(() =>
        useFileDrop({
          onDrop: ({ paths }) => {
            droppedPaths.push(paths);
          },
          subscribe: fakeSubscriber.subscribe,
        }),
      );

      act(() => {
        fakeSubscriber.emit({ type: "drop", paths: ["/tmp/note.md"] });
      });

      expect(droppedPaths).toEqual([["/tmp/note.md"]]);
      expect(result.current).toBe(false);
    });
  });

  context("드래그가 진행 중인 경우", () => {
    const dragInProgressCases: Array<[string, DragDropPayload]> = [
      ["enter", { type: "enter", paths: ["/tmp/note.md"] }],
      ["over", { type: "over" }],
    ];

    test.each(dragInProgressCases)(
      "%s 이벤트가 오면 isDragging이 true가 됩니다.",
      (_eventType, payload) => {
        const fakeSubscriber = createFakeDragDropSubscriber();
        const { result } = renderHook(() =>
          useFileDrop({ onDrop: noopDrop, subscribe: fakeSubscriber.subscribe }),
        );

        act(() => {
          fakeSubscriber.emit(payload);
        });

        expect(result.current).toBe(true);
      },
    );
  });

  context("드래그가 취소된 경우", () => {
    test("leave 이벤트가 오면 isDragging이 false로 돌아갑니다.", () => {
      const fakeSubscriber = createFakeDragDropSubscriber();
      const { result } = renderHook(() =>
        useFileDrop({ onDrop: noopDrop, subscribe: fakeSubscriber.subscribe }),
      );

      act(() => {
        fakeSubscriber.emit({ type: "enter", paths: [] });
      });
      act(() => {
        fakeSubscriber.emit({ type: "leave" });
      });

      expect(result.current).toBe(false);
    });
  });

  context("hook이 unmount되는 경우", () => {
    test("구독 해제 함수(unlisten)를 호출합니다.", async () => {
      const fakeSubscriber = createFakeDragDropSubscriber();
      const { unmount } = renderHook(() =>
        useFileDrop({ onDrop: noopDrop, subscribe: fakeSubscriber.subscribe }),
      );

      unmount();
      // unlisten은 subscribe가 반환한 Promise의 then에서 호출되므로 microtask를 비운다
      await act(async () => {});

      expect(fakeSubscriber.getUnlistenCount()).toBe(1);
    });
  });
});

function noopDrop() {
  // 드롭을 검증하지 않는 테스트용 no-op
}

function createFakeDragDropSubscriber() {
  let registeredHandler: ((payload: DragDropPayload) => void) | null = null;
  let unlistenCount = 0;
  const subscribe: DragDropSubscriber = ({ onEvent }) => {
    registeredHandler = onEvent;
    return Promise.resolve(() => {
      unlistenCount += 1;
    });
  };
  return {
    subscribe,
    emit: (payload: DragDropPayload) => {
      registeredHandler?.(payload);
    },
    getUnlistenCount: () => unlistenCount,
  };
}
```

- [ ] **Step 2: FAIL 확인**

Run:
```bash
pnpm test src/hooks/useFileDrop.spec.tsx
```
Expected: FAIL — `Cannot find module './useFileDrop'` 류의 모듈 미존재 에러.

- [ ] **Step 3: 최소 구현**

`src/hooks/useFileDrop.ts` 생성:

```typescript
/**
 * @fileoverview Tauri 웹뷰의 네이티브 파일 drag-drop 이벤트를 구독하는 hook입니다.
 * 'drop'이면 onDrop에 절대 경로 배열을 전달하고, 'enter'/'over'/'leave'로 isDragging 상태를 관리합니다.
 * subscribe를 주입(DI)할 수 있어 테스트에서 모킹 없이 가짜 구독자를 쓸 수 있고,
 * 기본값은 getCurrentWebview().onDragDropEvent입니다(권한은 기존 core:default로 충분).
 * 주의: onDrop/subscribe는 참조가 안정적이어야 한다(불안정하면 재구독 race) — App은 useCallback으로 전달한다.
 */
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useState } from "react";

export type DragDropPayload =
  | { type: "enter"; paths: string[] }
  | { type: "over" }
  | { type: "drop"; paths: string[] }
  | { type: "leave" };

export type DragDropSubscriber = (args: {
  onEvent: (payload: DragDropPayload) => void;
}) => Promise<() => void>;

type UseFileDropParams = {
  /** 'drop' 이벤트의 절대 경로 배열을 받는다 */
  onDrop: (args: { paths: string[] }) => void;
  /** drag-drop 이벤트 구독 함수
   * @default Tauri 웹뷰 구독(subscribeToWebviewDragDrop)
   */
  subscribe?: DragDropSubscriber;
};

export function useFileDrop({
  onDrop,
  subscribe = subscribeToWebviewDragDrop,
}: UseFileDropParams): boolean {
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const unlistenPromise = subscribe({
      onEvent: (payload) => {
        if (payload.type === "drop") {
          setIsDragging(false);
          onDrop({ paths: payload.paths });
          return;
        }
        if (payload.type === "enter" || payload.type === "over") {
          setIsDragging(true);
          return;
        }
        setIsDragging(false);
      },
    });
    return () => {
      unlistenPromise.then((unlisten) => {
        unlisten();
      });
    };
  }, [onDrop, subscribe]);

  return isDragging;
}

function subscribeToWebviewDragDrop({
  onEvent,
}: {
  onEvent: (payload: DragDropPayload) => void;
}): Promise<() => void> {
  return getCurrentWebview().onDragDropEvent((event) => {
    onEvent(event.payload);
  });
}
```

> Tauri의 payload 타입(`position` 필드 포함)은 우리의 `DragDropPayload`에 구조적으로 할당 가능하다 — position은 쓰지 않으므로 타입을 소유하지 않는다.

- [ ] **Step 4: PASS 확인**

Run:
```bash
pnpm test src/hooks/useFileDrop.spec.tsx
```
Expected: PASS — 5 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useFileDrop.ts src/hooks/useFileDrop.spec.tsx
git commit -m "feat: add useFileDrop hook with injectable subscriber"
```

---

### Task 6: `App` (TDD — 4 사이클)

**Files:**
- Test: `src/App.spec.tsx` (jsdom 프로젝트)
- Modify(교체): `src/App.tsx`
- Delete: `src/assets/react.svg`, `public/tauri.svg` (App.tsx 교체로 고아가 되는 자산)

Run/Expected는 모든 사이클 동일:

Run:
```bash
pnpm test src/App.spec.tsx
```

- [ ] **Step 1 (사이클 1 RED): 빈 상태 + 열기 성공/취소/실패 테스트 작성**

`src/App.spec.tsx` 생성:

```tsx
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import {
  type DragDropPayload,
  type DragDropSubscriber,
} from "./hooks/useFileDrop";

const context = describe;

describe("App", () => {
  context("파일을 열기 전", () => {
    test("빈 상태 안내와 열기 버튼을 렌더합니다.", () => {
      const fakeDeps = createFakeDeps({});

      render(<App {...fakeDeps.props} />);

      expect(
        screen.getByRole("button", { name: /파일 열기/ }),
      ).toBeInTheDocument();
    });
  });

  context("열기 버튼으로 파일을 여는 경우", () => {
    test("선택한 파일 내용을 렌더합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/note.md"],
        files: { "/tmp/note.md": "# 제목" },
      });
      render(<App {...fakeDeps.props} />);

      await user.click(screen.getByRole("button", { name: /파일 열기/ }));

      expect(
        await screen.findByRole("heading", { name: "제목" }),
      ).toBeInTheDocument();
    });

    test("다이얼로그를 취소하면 아무것도 읽지 않고 빈 상태를 유지합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({ pickedPaths: [null] });
      render(<App {...fakeDeps.props} />);

      await user.click(screen.getByRole("button", { name: /파일 열기/ }));

      expect(fakeDeps.readPaths).toHaveLength(0);
      expect(
        screen.getByRole("button", { name: /파일 열기/ }),
      ).toBeInTheDocument();
    });

    test("읽기에 실패하면 에러 배너를 띄우고 기존 문서를 유지합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/good.md", "/tmp/broken.md"],
        files: { "/tmp/good.md": "# 기존 문서" },
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("heading", { name: "기존 문서" });

      // 두 번째 열기: /tmp/broken.md는 files에 없어 읽기 실패
      const openButtons = screen.queryAllByRole("button", {
        name: /파일 열기/,
      });
      expect(openButtons).toHaveLength(0); // 문서가 열리면 빈 상태 버튼은 사라진다
      act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "o", metaKey: true }),
        );
      });

      expect(await screen.findByRole("alert")).toHaveTextContent(/읽기 실패/);
      expect(
        screen.getByRole("heading", { name: "기존 문서" }),
      ).toBeInTheDocument();
    });
  });
});

type CreateFakeDepsParams = {
  /** pickFile이 순서대로 반환할 값 (null = 다이얼로그 취소) */
  pickedPaths?: Array<string | null>;
  /** readFile이 성공할 경로 → 내용. 없는 경로는 읽기 실패로 reject */
  files?: Record<string, string>;
};

function createFakeDeps({ pickedPaths = [], files = {} }: CreateFakeDepsParams) {
  const remainingPicks = [...pickedPaths];
  const readPaths: string[] = [];
  const fakeSubscriber = createFakeDragDropSubscriber();
  const props = {
    pickFile: () => Promise.resolve(remainingPicks.shift() ?? null),
    readFile: ({ path }: { path: string }) => {
      readPaths.push(path);
      const content = files[path];
      if (content === undefined) {
        return Promise.reject(new Error(`읽기 실패: ${path}`));
      }
      return Promise.resolve(content);
    },
    subscribeDragDrop: fakeSubscriber.subscribe,
  };
  return { props, readPaths, emitDragDrop: fakeSubscriber.emit };
}

function createFakeDragDropSubscriber() {
  let registeredHandler: ((payload: DragDropPayload) => void) | null = null;
  const subscribe: DragDropSubscriber = ({ onEvent }) => {
    registeredHandler = onEvent;
    return Promise.resolve(() => {
      registeredHandler = null;
    });
  };
  return {
    subscribe,
    emit: (payload: DragDropPayload) => {
      registeredHandler?.(payload);
    },
  };
}
```

> `createFakeDragDropSubscriber`는 useFileDrop.spec.tsx에도 비슷한 헬퍼가 있다 — 테스트 지역성을 위해 의도적으로 중복한다(공용 헬퍼를 src에 두면 커버리지 대상에 섞임).

- [ ] **Step 2 (사이클 1): FAIL 확인** — App이 아직 greet 데모라 버튼/제목 못 찾음. (이 사이클의 마지막 테스트는 Cmd+O 의존 — 구현 전이므로 함께 실패하는 게 정상)

- [ ] **Step 3 (사이클 1 GREEN): App.tsx 전체 교체**

`src/App.tsx` 전체를 다음으로 교체:

```tsx
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useState } from "react";
import { MarkdownView } from "./components/MarkdownView";
import { type DragDropSubscriber, useFileDrop } from "./hooks/useFileDrop";
import { isMarkdownPath, MARKDOWN_EXTENSIONS } from "./lib/isMarkdownPath";
import "./App.css";

type OpenedDocument = {
  path: string;
  content: string;
};

type AppProps = {
  /** 파일 선택 다이얼로그 — 취소 시 null
   * @default Tauri dialog open()
   */
  pickFile?: () => Promise<string | null>;
  /** 경로의 파일 내용 읽기 — 실패 시 reject
   * @default invoke("read_file")
   */
  readFile?: (args: { path: string }) => Promise<string>;
  /** drag-drop 구독 — useFileDrop에 전달
   * @default Tauri 웹뷰 구독 (useFileDrop의 기본값)
   */
  subscribeDragDrop?: DragDropSubscriber;
};

function App({
  pickFile = pickMarkdownFile,
  readFile = readMarkdownFile,
  subscribeDragDrop,
}: AppProps) {
  const [openedDocument, setOpenedDocument] = useState<OpenedDocument | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const openPath = useCallback(
    async ({ path }: { path: string }) => {
      try {
        const content = await readFile({ path });
        setOpenedDocument({ path, content });
        setErrorMessage(null);
      } catch (error) {
        setErrorMessage(String(error));
      }
    },
    [readFile],
  );

  const openViaDialog = useCallback(async () => {
    const path = await pickFile();
    if (path === null) {
      return;
    }
    await openPath({ path });
  }, [pickFile, openPath]);

  const handleDrop = useCallback(
    ({ paths }: { paths: string[] }) => {
      const markdownPath = paths.find((path) => isMarkdownPath({ path }));
      if (markdownPath === undefined) {
        return;
      }
      void openPath({ path: markdownPath });
    },
    [openPath],
  );

  const isDragging = useFileDrop({
    onDrop: handleDrop,
    subscribe: subscribeDragDrop,
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || event.key !== "o") {
        return;
      }
      event.preventDefault();
      void openViaDialog();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openViaDialog]);

  return (
    <main className={isDragging ? "app dragging" : "app"}>
      {errorMessage !== null && (
        <div role="alert" className="error-banner">
          {errorMessage}
        </div>
      )}
      {openedDocument === null ? (
        <div className="empty-state">
          <p>마크다운 파일을 끌어다 놓거나 열기 버튼을 누르세요</p>
          <button type="button" onClick={() => void openViaDialog()}>
            파일 열기 (⌘O)
          </button>
        </div>
      ) : (
        <MarkdownView
          source={openedDocument.content}
          onLinkClick={handleLinkClick}
        />
      )}
    </main>
  );
}

export default App;

function pickMarkdownFile(): Promise<string | null> {
  return open({
    multiple: false,
    directory: false,
    filters: [{ name: "Markdown", extensions: MARKDOWN_EXTENSIONS }],
  });
}

function readMarkdownFile({ path }: { path: string }): Promise<string> {
  // invoke의 기본 반환은 Promise<unknown> — 제네릭으로 응답 타입을 지정한다(type assertion 아님)
  return invoke<string>("read_file", { path });
}

function handleLinkClick({ url }: { url: string }) {
  void openUrl(url);
}
```

> - `subscribeDragDrop`이 undefined면 useFileDrop의 기본값(Tauri 구독)이 적용된다 — 스펙 §4.2의 "기본값 = Tauri 구독"은 이 경로로 충족.
> - `open()`의 반환 타입이 `string | null`로 추론되지 않으면(오버로드 이슈) `multiple: false, directory: false`가 리터럴로 전달되는지 확인한다 — assertion으로 덮지 말 것.

- [ ] **Step 4 (사이클 1): PASS 확인** — Cmd+O 테스트까지 포함 4 cases green (keydown 리스너가 이번 구현에 포함되므로)

- [ ] **Step 5 (사이클 1): 고아 자산 정리 + Commit**

```bash
rm src/assets/react.svg public/tauri.svg
git add src/App.tsx src/App.spec.tsx
git commit -m "feat: open markdown files via dialog with empty/error states"
```

(react.svg/tauri.svg는 untracked라 `rm`만으로 충분 — git 커밋 대상 아님.)

- [ ] **Step 6 (사이클 2 RED): Cmd+O 전용 테스트 추가**

최상위 `describe` 안에 추가 (사이클 1의 실패-경로 테스트는 keydown을 이미 사용했지만, 빈 상태에서의 Cmd+O 동작을 명시적으로 고정한다):

```tsx
  context("Cmd+O를 누르는 경우", () => {
    test("빈 상태에서도 파일 열기를 트리거합니다.", async () => {
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/note.md"],
        files: { "/tmp/note.md": "# 단축키로 열기" },
      });
      render(<App {...fakeDeps.props} />);

      act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "o", metaKey: true }),
        );
      });

      expect(
        await screen.findByRole("heading", { name: "단축키로 열기" }),
      ).toBeInTheDocument();
    });
  });
```

- [ ] **Step 7 (사이클 2): 즉시 PASS 여부 확인**

이 테스트는 사이클 1 구현으로 이미 통과할 수 있다(keydown 리스너 기 구현). **즉시 통과하면 RED 단계가 없었던 것이므로**, 리스너 구현을 잠시 주석 처리해 FAIL을 확인하고(올바른 이유로 실패하는지 검증) 되돌린 뒤 PASS를 확인한다.

- [ ] **Step 8 (사이클 2): Commit**

```bash
git add src/App.spec.tsx
git commit -m "test: pin Cmd+O shortcut behavior on empty state"
```

- [ ] **Step 9 (사이클 3 RED): 드롭 동작 테스트 추가**

최상위 `describe` 안에 추가:

```tsx
  context("파일을 드롭하는 경우", () => {
    test("드롭된 경로 중 첫 마크다운 파일을 엽니다.", async () => {
      const fakeDeps = createFakeDeps({
        files: { "/tmp/note.md": "# 드롭으로 열기" },
      });
      render(<App {...fakeDeps.props} />);

      act(() => {
        fakeDeps.emitDragDrop({
          type: "drop",
          paths: ["/tmp/image.png", "/tmp/note.md"],
        });
      });

      expect(
        await screen.findByRole("heading", { name: "드롭으로 열기" }),
      ).toBeInTheDocument();
      expect(fakeDeps.readPaths).toEqual(["/tmp/note.md"]);
    });

    test("마크다운 파일이 없으면 무시합니다.", async () => {
      const fakeDeps = createFakeDeps({});
      render(<App {...fakeDeps.props} />);

      act(() => {
        fakeDeps.emitDragDrop({ type: "drop", paths: ["/tmp/image.png"] });
      });

      expect(fakeDeps.readPaths).toHaveLength(0);
      expect(
        screen.getByRole("button", { name: /파일 열기/ }),
      ).toBeInTheDocument();
    });

    test("드래그 중에는 dragging 클래스로 하이라이트합니다.", () => {
      const fakeDeps = createFakeDeps({});
      const { container } = render(<App {...fakeDeps.props} />);

      act(() => {
        fakeDeps.emitDragDrop({ type: "enter", paths: ["/tmp/note.md"] });
      });

      expect(container.querySelector("main.dragging")).not.toBeNull();
    });
  });
```

- [ ] **Step 10 (사이클 3): 즉시 PASS 여부 확인** — 사이클 1 구현(handleDrop/isDragging)으로 이미 통과할 수 있다. 즉시 통과하면 `handleDrop`의 `paths.find` 줄을 잠시 `paths[0]` 사용으로 바꿔 첫 테스트가 올바르게 실패하는지 확인 후 되돌린다.

- [ ] **Step 11 (사이클 3): Commit**

```bash
git add src/App.spec.tsx
git commit -m "test: pin drag-drop open/ignore/highlight behavior"
```

- [ ] **Step 12 (사이클 4): 전체 테스트 green 확인**

Run:
```bash
pnpm test
```
Expected: 4개 spec 파일 전체 PASS, 출력 pristine (jsdom navigation 에러/React act 경고 없음).

---

### Task 7: 스타일 + 엔트리 (TDD 예외 — 스펙 §7 승인)

**Files:**
- Modify: `src/main.tsx`
- Modify(교체): `src/App.css`

- [ ] **Step 1: main.tsx에 CSS import 추가**

`src/main.tsx` 전체를 다음으로 교체 (import 한 줄 추가 외 변경 없음):

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import "github-markdown-css/github-markdown.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

(기존 `as HTMLElement`는 스캐폴드 코드 — 이번 변경 범위가 아니므로 유지.)

- [ ] **Step 2: App.css 전체 교체**

`src/App.css` 전체를 다음으로 교체:

```css
/* light-dark() 인라인 색상(shiki)이 시스템 테마를 따르기 위한 전제 (스펙 §3) */
:root {
  color-scheme: light dark;
}

/* github-markdown-css는 .markdown-body 안만 칠한다 — 페이지 배경은 직접 지정 (스펙 §4.2) */
body {
  margin: 0;
  background-color: #ffffff;
}

@media (prefers-color-scheme: dark) {
  body {
    background-color: #0d1117;
  }
}

.markdown-body {
  box-sizing: border-box;
  min-width: 200px;
  max-width: 980px;
  margin: 0 auto;
  padding: 45px;
}

.shiki {
  overflow-x: auto;
}

.app.dragging {
  outline: 3px dashed #58a6ff;
  outline-offset: -3px;
  min-height: 100vh;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  gap: 12px;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
}

.error-banner {
  position: sticky;
  top: 0;
  padding: 8px 16px;
  background-color: #b62324;
  color: #ffffff;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
}
```

- [ ] **Step 3: 빌드/테스트 green 확인**

Run:
```bash
pnpm test && pnpm build
```
Expected: 테스트 전체 PASS + `tsc` 통과 + `dist/` 생성, exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/main.tsx src/App.css
git commit -m "feat: apply github-markdown-css and app chrome styles"
```

---

### Task 8: 통합 검증 (스펙 §6 수동 체크리스트)

**Files:** 없음 (검증만)

- [ ] **Step 1: 전체 자동 검증**

Run:
```bash
pnpm test && pnpm coverage && pnpm build
```
Expected: 전부 exit 0. 커버리지 리포트에서 `src/lib`, `src/components`, `src/hooks`, `App.tsx`의 branch 커버리지가 100%에 근접하는지 확인 (목표 — 부족한 분기는 테스트 추가).

- [ ] **Step 2: 검증용 fixture 작성 (저장소 외부)**

````bash
cat > /tmp/markdownviewer-fixture.md <<'EOF'
---
title: fixture
---

# 검증 문서

| 기능 | 상태 |
| --- | --- |
| GFM 표 | ✅ |

- [x] 체크박스
- [ ] ~~취소선~~

```typescript
const answer: number = 42;
```

```unknownlang
fallback text
```

<details><summary>접기</summary><kbd>Cmd</kbd>+<kbd>O</kbd></details>

[Tauri 공식 문서](https://tauri.app/)
EOF
````

- [ ] **Step 3: `pnpm tauri dev`로 수동 체크리스트 실행**

Run:
```bash
pnpm tauri dev
```

체크리스트 (전부 통과해야 완료):
- [ ] 빈 상태 화면이 뜨고, "파일 열기" 버튼으로 `/tmp/markdownviewer-fixture.md`를 열 수 있다
- [ ] Cmd+O로도 다이얼로그가 뜬다 (다이얼로그 필터에 .md/.markdown/.mdx만 활성)
- [ ] Finder에서 fixture를 창에 드래그&드롭하면 열린다 (드래그 중 점선 하이라이트 표시)
- [ ] frontmatter가 본문에 보이지 않는다
- [ ] 표/체크박스/취소선/`<details>`/`<kbd>`가 렌더된다
- [ ] typescript 펜스가 하이라이팅되고, unknownlang 펜스는 플레인 텍스트로 나온다
- [ ] 시스템 다크모드를 토글하면 본문 배경과 코드블록 색이 **함께** 전환된다
- [ ] 링크 클릭 시 웹뷰가 이동하지 않고 기본 브라우저가 열린다
- [ ] .png 등 비마크다운 파일 드롭은 무시된다
- [ ] 디렉터리를 드롭하면 에러 배너가 뜨고, 열려 있던 문서는 유지된다

- [ ] **Step 4: 프로덕션 번들 확인**

Run (포그라운드 셸에서 — dmg의 AppleScript 단계 때문, 메모리/스펙 참고):
```bash
pnpm tauri build
```
Expected: `app`/`dmg` 번들 생성, 패키지 앱 실행 시 fixture가 정상 렌더.

- [ ] **Step 5: 잔여 변경 커밋 여부 확인**

```bash
git status --short
```
Expected: 이 작업 범위의 tracked 변경 없음 (스캐폴드의 기존 untracked 파일은 그대로여도 됨).
