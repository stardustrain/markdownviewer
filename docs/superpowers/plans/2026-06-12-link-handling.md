# 마크다운 링크 동작 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 본문 링크를 실제로 동작시킨다 — 외부 링크는 기본 브라우저, 상대 경로 md는 뷰어에서 열기(문서 교체), 상대 경로 비md는 OS 기본 앱, `#앵커`는 문서 내 스크롤.

**Architecture:** 순수 함수 `classifyLink`가 href를 external/relative/ignored로 분류하고, App의 `handleLinkClick`이 분류별로 라우팅한다(외부 → openUrl, md → 기존 `openPath` 머신 재사용, 비md → opener openPath). 앵커는 MarkdownView가 preventDefault를 생략해 WKWebView 네이티브 fragment 스크롤에 위임하고, 헤딩 id는 rehype-slug가 생성한다. Rust 코드 변경 없음 — 권한(capabilities)과 plugin 설정만 추가.

**Tech Stack:** React 19 + react-markdown 10, rehype-slug@^6(신규 의존성), @tauri-apps/plugin-opener 2, vitest 4(node/jsdom 프로젝트 분리).

**스펙:** `docs/superpowers/specs/2026-06-12-link-handling-design.md`

**중요 배경 (스펙에서 검증된 사실):**
- react-markdown@10은 href를 **항상 percent-encoded**로 전달한다 (`./한글.md` → `./%ED%95%9C...md`). 파일 경로로 쓰려면 fragment 분리 → `decodeURIComponent`(URIError 시 raw fallback) 순서가 필수.
- react-markdown 기본 urlTransform이 `file:` 등 비허용 스킴의 href를 `""`로 치환한다. 통과하는 형태: http/https/irc/ircs/mailto/xmpp 스킴, 상대 경로, `/` 시작 경로, `#앵커`.
- `opener:default`는 `open_path`를 허용하지 않는다 — scope 있는 `opener:allow-open-path` 권한이 별도로 필요하고, dot 디렉터리 경로 매칭에는 `requireLiteralLeadingDot: false`가 필요하다.
- 경로 정규화는 하지 않는다 — `..`/`.`은 std::fs(`read_file`/`start_watching`)와 OS가 해석하고, `start_watching`의 canonicalize가 문서 식별자를 정리한다(기존 메커니즘).
- 테스트 실행: `pnpm test <파일경로>` (vitest run). `*.spec.ts`는 node, `*.spec.tsx`는 jsdom 프로젝트에서 돈다.

---

### Task 1: classifyLink 순수 모듈

**Files:**
- Create: `src/lib/classifyLink.ts`
- Test: `src/lib/classifyLink.spec.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/classifyLink.spec.ts` 생성:

```typescript
import { classifyLink } from "./classifyLink";

const context = describe;

describe("classifyLink", () => {
  context("스킴이 있는 href인 경우", () => {
    test.each([
      [
        "https://tauri.app/docs",
        { kind: "external", url: "https://tauri.app/docs" },
      ],
      [
        "mailto:someone@example.com",
        { kind: "external", url: "mailto:someone@example.com" },
      ],
    ])("'%s'를 external로 분류합니다.", (href, expected) => {
      expect(classifyLink({ href })).toEqual(expected);
    });
  });

  context("지원하지 않는 형태인 경우", () => {
    test.each([
      [""],
      ["/abs/path.md"],
      ["//host/share.md"],
      ["#section"],
    ])("'%s'를 ignored로 분류합니다.", (href) => {
      expect(classifyLink({ href })).toEqual({ kind: "ignored" });
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
      expect(
        classifyLink({ href: "%ED%95%9C%EA%B8%80%20%EB%85%B8%ED%8A%B8.md" }),
      ).toEqual({ kind: "relative", path: "한글 노트.md" });
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
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test src/lib/classifyLink.spec.ts`
Expected: FAIL — `classifyLink.ts` 모듈이 없어 import 에러.

- [ ] **Step 3: 최소 구현**

`src/lib/classifyLink.ts` 생성:

```typescript
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
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test src/lib/classifyLink.spec.ts`
Expected: PASS — 9개 테스트 전부 통과.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/classifyLink.ts src/lib/classifyLink.spec.ts
git commit -m "feat: add classifyLink for routing markdown link clicks"
```

---

### Task 2: MarkdownView — 헤딩 slug + 앵커 네이티브 위임

**Files:**
- Modify: `src/components/MarkdownView.tsx`
- Test: `src/components/MarkdownView.spec.tsx`
- Modify: `package.json` (rehype-slug 추가)

- [ ] **Step 1: rehype-slug 설치**

Run: `pnpm add rehype-slug`
Expected: `dependencies`에 `"rehype-slug": "^6.0.0"` 추가됨.

- [ ] **Step 2: 실패하는 테스트 작성**

`src/components/MarkdownView.spec.tsx`에 컨텍스트 2개 추가 (기존 `context("본문에 링크가 있는 경우", ...)` 안에 앵커 테스트, 새 컨텍스트로 헤딩 테스트):

```typescript
  context("헤딩이 있는 경우", () => {
    test("한글 헤딩에 slug id를 생성합니다.", () => {
      render(<MarkdownView source={"# 한글 제목"} onLinkClick={noopLinkClick} />);

      expect(
        screen.getByRole("heading", { name: "한글 제목" }),
      ).toHaveAttribute("id", "한글-제목");
    });

    test("raw HTML 헤딩에도 id를 생성합니다.", () => {
      render(
        <MarkdownView source={"<h2>요약 정리</h2>"} onLinkClick={noopLinkClick} />,
      );

      expect(
        screen.getByRole("heading", { name: "요약 정리" }),
      ).toHaveAttribute("id", "요약-정리");
    });
  });
```

기존 `context("본문에 링크가 있는 경우", ...)` 블록 안에 추가:

```typescript
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
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm test src/components/MarkdownView.spec.tsx`
Expected: FAIL 3건 — 헤딩에 id 없음(2건), 앵커 클릭이 preventDefault됨(1건). 기존 테스트는 전부 PASS 유지.

- [ ] **Step 4: 구현**

`src/components/MarkdownView.tsx` 수정. import 추가:

```typescript
import rehypeSlug from "rehype-slug";
```

rehypePlugins 배열 수정 (rehypeRaw **뒤**, shiki 앞):

```typescript
// 주의: rehypeRaw는 raw HTML 노드를 실제 hast 노드로 변환하므로 shiki보다 먼저 와야 한다
// rehypeSlug는 rehypeRaw 뒤여야 raw HTML 헤딩에도 id가 붙는다 (스펙 §2)
const rehypePlugins: Options["rehypePlugins"] = [
  rehypeRaw,
  rehypeSlug,
  [rehypeShikiFromHighlighter, highlighter, shikiOptions],
];
```

`a` 컴포넌트의 onClick 수정:

```tsx
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(event) => {
                if (href === undefined || href.startsWith("#")) {
                  return; // 비링크 또는 앵커 — 네이티브 fragment 스크롤에 위임 (스펙 §2)
                }
                event.preventDefault();
                onLinkClick({ url: href });
              }}
            >
              {children}
            </a>
          ),
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm test src/components/MarkdownView.spec.tsx`
Expected: PASS — 신규 3건 포함 전부 통과 (기존 "링크 클릭의 기본 네비게이션을 막습니다"는 https 링크라 여전히 PASS, "href가 없는 앵커는 onLinkClick을 호출하지 않습니다"도 동작 동일).

- [ ] **Step 6: 커밋**

```bash
git add package.json pnpm-lock.yaml src/components/MarkdownView.tsx src/components/MarkdownView.spec.tsx
git commit -m "feat: generate heading slugs and let anchor links scroll natively"
```

---

### Task 3: App 라우팅 — 외부/md/비md 분기

**Files:**
- Modify: `src/App.tsx`
- Test: `src/App.spec.tsx`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/App.spec.tsx`의 `CreateFakeDepsParams`에 필드 추가:

```typescript
  /** true면 openWithOS가 reject한다 (깨진 비마크다운 링크 배너 검증용) */
  failOpenWithOS?: boolean;
```

`createFakeDeps` 함수 시그니처의 구조 분해에 `failOpenWithOS = false,` 추가. 함수 본문 상단에 기록용 배열 추가:

```typescript
  const externalUrls: string[] = [];
  const osOpenedFilePaths: string[] = [];
```

`props` 객체에 fake 2개 추가:

```typescript
    openExternal: ({ url }: { url: string }) => {
      externalUrls.push(url);
      return Promise.resolve();
    },
    openWithOS: ({ path }: { path: string }) => {
      osOpenedFilePaths.push(path);
      if (failOpenWithOS) {
        return Promise.reject(new Error(`열기 실패: ${path}`));
      }
      return Promise.resolve();
    },
```

반환 객체에 `externalUrls, osOpenedFilePaths,` 추가.

새 컨텍스트를 `describe("App", ...)` 안에 추가:

```typescript
  context("본문 링크를 클릭하는 경우", () => {
    test("외부 링크는 openExternal로 엽니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/docs/index.md"],
        files: { "/tmp/docs/index.md": "[공식 문서](https://tauri.app/)" },
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("link", { name: "공식 문서" });

      await user.click(screen.getByRole("link", { name: "공식 문서" }));

      expect(fakeDeps.externalUrls).toEqual(["https://tauri.app/"]);
      expect(fakeDeps.osOpenedFilePaths).toHaveLength(0);
    });

    test("상대 경로 마크다운 링크는 현재 문서 디렉터리 기준으로 열고 watch도 교체합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/docs/index.md"],
        files: {
          "/tmp/docs/index.md": "[다음 문서](other.md)",
          "/tmp/docs/other.md": "# 다음 문서 내용",
        },
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("link", { name: "다음 문서" });

      await user.click(screen.getByRole("link", { name: "다음 문서" }));

      expect(
        await screen.findByRole("heading", { name: "다음 문서 내용" }),
      ).toBeInTheDocument();
      expect(fakeDeps.readPaths).toEqual([
        "/tmp/docs/index.md",
        "/tmp/docs/other.md",
      ]);
      expect(fakeDeps.watchedPaths).toEqual([
        "/tmp/docs/index.md",
        "/tmp/docs/other.md",
      ]);
    });

    test("./ 접두사 경로는 정규화 없이 그대로 조합합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/docs/index.md"],
        files: {
          "/tmp/docs/index.md": "[다음 문서](./other.md)",
          "/tmp/docs/./other.md": "# 점 경로 내용",
        },
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("link", { name: "다음 문서" });

      await user.click(screen.getByRole("link", { name: "다음 문서" }));

      // "."를 정규화하지 않는다 — OS가 해석하고 canonicalize가 식별자를 정리한다 (스펙 §2)
      expect(
        await screen.findByRole("heading", { name: "점 경로 내용" }),
      ).toBeInTheDocument();
      expect(fakeDeps.readPaths.at(-1)).toBe("/tmp/docs/./other.md");
    });

    test("percent-encoded 한글 링크를 디코딩해 엽니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/docs/index.md"],
        files: {
          "/tmp/docs/index.md": "[한글 노트](한글%20노트.md)",
          "/tmp/docs/한글 노트.md": "# 한글 내용",
        },
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("link", { name: "한글 노트" });

      await user.click(screen.getByRole("link", { name: "한글 노트" }));

      expect(
        await screen.findByRole("heading", { name: "한글 내용" }),
      ).toBeInTheDocument();
      expect(fakeDeps.readPaths.at(-1)).toBe("/tmp/docs/한글 노트.md");
    });

    test("비마크다운 링크는 OS 기본 앱으로 열고 문서는 유지합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/docs/index.md"],
        files: { "/tmp/docs/index.md": "# 현재 문서\n\n[보고서](report.pdf)" },
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("link", { name: "보고서" });

      await user.click(screen.getByRole("link", { name: "보고서" }));
      await act(async () => {});

      expect(fakeDeps.osOpenedFilePaths).toEqual(["/tmp/docs/report.pdf"]);
      expect(fakeDeps.readPaths).toEqual(["/tmp/docs/index.md"]);
      expect(
        screen.getByRole("heading", { name: "현재 문서" }),
      ).toBeInTheDocument();
    });

    test("비마크다운 열기에 실패하면 read-error 배너를 띄우고 문서를 유지합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/docs/index.md"],
        files: { "/tmp/docs/index.md": "# 현재 문서\n\n[보고서](report.pdf)" },
        failOpenWithOS: true,
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("link", { name: "보고서" });

      await user.click(screen.getByRole("link", { name: "보고서" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(/열기 실패/);
      expect(
        screen.getByRole("heading", { name: "현재 문서" }),
      ).toBeInTheDocument();
    });

    test("절대 경로 링크는 무시합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/docs/index.md"],
        files: { "/tmp/docs/index.md": "[절대](/abs/file.md)" },
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("link", { name: "절대" });

      await user.click(screen.getByRole("link", { name: "절대" }));
      await act(async () => {});

      expect(fakeDeps.externalUrls).toHaveLength(0);
      expect(fakeDeps.osOpenedFilePaths).toHaveLength(0);
      expect(fakeDeps.readPaths).toEqual(["/tmp/docs/index.md"]);
    });
  });
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test src/App.spec.tsx`
Expected: FAIL — 외부 링크 테스트는 기존 모듈 스코프 `handleLinkClick`이 실제 `openUrl`(Tauri IPC 없음)을 호출해 fake가 기록 못 함, 상대 경로 테스트들은 라우팅이 없어 실패.

- [ ] **Step 3: 구현**

`src/App.tsx` 수정.

import 변경 — opener에서 `openPath`를 별칭으로 추가(컴포넌트 내부 `openPath` 콜백과 이름 충돌 방지), `classifyLink` import 추가:

```typescript
import { openPath as openPathWithDefaultApp, openUrl } from "@tauri-apps/plugin-opener";
import { classifyLink } from "./lib/classifyLink";
```

`AppProps`에 prop 2개 추가 (기존 JSDoc 스타일 유지):

```typescript
  /** 외부 링크(스킴 있는 href)를 기본 브라우저로 열기
   * @default Tauri opener openUrl 래퍼
   */
  openExternal?: (args: { url: string }) => Promise<void>;
  /** 파일을 OS 기본 앱으로 열기 — 비마크다운 상대 경로 링크용
   * @default Tauri opener openPath 래퍼
   */
  openWithOS?: (args: { path: string }) => Promise<void>;
```

`App` 함수 시그니처의 구조 분해에 추가:

```typescript
  openExternal = openExternalUrl,
  openWithOS = openFileWithOS,
```

컴포넌트 안(예: `openViaDialog` 위)에 `handleLinkClick` 추가 — `openPath` useCallback 선언 **뒤**에 와야 한다:

```typescript
  const handleLinkClick = useCallback(
    ({ url }: { url: string }) => {
      const classification = classifyLink({ href: url });
      if (classification.kind === "ignored") {
        return;
      }
      if (classification.kind === "external") {
        void openExternal({ url: classification.url });
        return;
      }
      const openedPath = openedPathRef.current;
      if (openedPath === null) {
        return; // 문서 없이는 MarkdownView가 렌더되지 않으므로 도달 불가 — 방어
      }
      // 정규화 없이 조합 — "."/".."은 OS가 해석, canonicalize가 식별자 정리 (스펙 §2)
      const resolvedPath = `${openedPath.slice(0, openedPath.lastIndexOf("/"))}/${classification.path}`;
      if (isMarkdownPath({ path: resolvedPath })) {
        void openPath({ path: resolvedPath });
        return;
      }
      void openWithOS({ path: resolvedPath }).catch((error) => {
        setNotice({ kind: "read-error", message: String(error) });
      });
    },
    [openExternal, openPath, openWithOS],
  );
```

모듈 하단의 기존 `handleLinkClick` 함수를 **삭제**하고, 그 자리에 기본 래퍼 2개 추가:

```typescript
function openExternalUrl({ url }: { url: string }): Promise<void> {
  return openUrl(url);
}

function openFileWithOS({ path }: { path: string }): Promise<void> {
  return openPathWithDefaultApp(path);
}
```

JSX의 `<MarkdownView ... onLinkClick={handleLinkClick} />`는 그대로 — 이제 컴포넌트 내부 콜백을 참조한다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm test src/App.spec.tsx`
Expected: PASS — 신규 7건 포함 전부 통과. 기존 테스트 회귀 없음.

- [ ] **Step 5: 전체 테스트로 회귀 확인**

Run: `pnpm test`
Expected: 전체 PASS (Task 1~3의 신규 테스트 + 기존 58건).

- [ ] **Step 6: 커밋**

```bash
git add src/App.tsx src/App.spec.tsx
git commit -m "feat: route body links to browser, viewer, or OS default app"
```

---

### Task 4: opener open_path 권한 + plugin 설정

**Files:**
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: capability에 open_path 권한 추가**

`src-tauri/capabilities/default.json`의 `permissions` 배열을 다음으로 교체 (`opener:default`는 open_path를 허용하지 않으므로 scope 있는 권한을 추가, 스펙 §2):

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    {
      "identifier": "opener:allow-open-path",
      "allow": [{ "path": "/**" }]
    },
    "dialog:default"
  ]
}
```

- [ ] **Step 2: dot 디렉터리 glob 매칭 설정**

`src-tauri/tauri.conf.json`에 최상위 `plugins` 키 추가 (없으면 `.obsidian/` 같은 dot 디렉터리 경로가 `/**`에 매칭되지 않아 거부됨, 스펙 §2). `"bundle"` 키 앞에 삽입:

```json
  "plugins": {
    "opener": {
      "requireLiteralLeadingDot": false
    }
  },
```

- [ ] **Step 3: 설정 유효성 확인 (dev 기동)**

Run: `pnpm tauri dev` 실행 후 창이 뜨면 종료 (Ctrl+C)
Expected: capability/설정 스키마 오류 없이 빌드·기동. 잘못된 permission identifier나 plugins 키 오타면 여기서 에러가 난다.

- [ ] **Step 4: 커밋**

```bash
git add src-tauri/capabilities/default.json src-tauri/tauri.conf.json
git commit -m "chore: grant opener open_path scope for linked files"
```

---

### Task 5: 최종 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: 전체 테스트 + 린트 + 타입 체크**

Run:

```bash
pnpm test && pnpm lint && pnpm build
```

Expected: 테스트 전체 PASS, lint 경고/에러 0, tsc + vite build 성공.

- [ ] **Step 2: 수동 검증 (스펙 §4 체크리스트)**

`pnpm tauri dev`로 실행하고, 아래를 모두 담은 테스트용 마크다운을 열어 확인:

- [ ] 외부 https 링크 → 기본 브라우저로 열림
- [ ] `other.md`/`./other.md` 상대 링크 → 문서 교체, 이후 대상 파일 저장 시 watcher 갱신이 따라옴
- [ ] `../` 포함 상대 경로 → 열림
- [ ] 한글·공백 파일명 링크 → 열림
- [ ] `./xxx.pdf` → 기본 앱(미리보기)으로 열림
- [ ] 없는 파일 링크(md/비md 각각) → read-error 배너, 현재 문서 유지
- [ ] 한글 헤딩 앵커(`[위로](#한글-제목)`) → 문서 내 스크롤, 리로드 없음
- [ ] dot 디렉터리 아래 비md 파일(`.notes/x.pdf` 류) → 열림
- [ ] 절대 경로·`file://` 링크 → 무동작

- [ ] **Step 3: 완료 처리**

superpowers:finishing-a-development-branch 스킬로 머지/정리 옵션을 사용자에게 제시.
