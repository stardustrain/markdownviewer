# 파일 열기 + 마크다운 렌더링 설계

- 날짜: 2026-06-10
- 대상 프로젝트: markdownviewer (Tauri 2 + Vite 8 + React 19 + TypeScript, pnpm)
- 상태: 승인됨 (구현 계획 작성 전)
- 검증: 핵심 기술 주장(플러그인 설정·drag-drop API·react-markdown×Shiki 동기 통합·github-markdown-css 동작)을 다중 에이전트로 공식 문서/npm 레지스트리/플러그인 소스와 교차검증 완료(2026-06-10).

로드맵의 2번(파일 열기) + 3번(마크다운 렌더링, GFM + Shiki 하이라이팅)을 구현한다.
Finder `.md` 더블클릭 연동(5번)과 파일 watcher(4번)는 범위 밖이며, 이 설계는 그 합류 지점(경로 → 읽기 → 렌더 파이프라인)만 마련해 둔다.

## 1. 배경

현재 `src/`는 스캐폴드(greet 데모) 그대로이고, 렌더링 파이프라인 의존성(react-markdown 10 / remark-gfm 4 / shiki 4.2 / @shikijs/rehype 4.2)은 설치만 되어 있다.
vitest 인프라(node + jsdom projects, RTL)는 [2026-06-10-vitest-infra-design.md](2026-06-10-vitest-infra-design.md)로 구성 완료 — 이 설계의 구현은 **TDD**(red-green-refactor)로 진행하며, `test-code-style` 스킬의 제약(모킹 금지 → DI, colocated spec, 한국어 description, exported만 테스트)을 그대로 따른다.

## 2. 목표 / 비목표

### 목표

- 파일 열기: **다이얼로그**(Cmd+O / 빈 화면의 열기 버튼) + **드래그&드롭** 두 경로
- 파일 읽기: **커스텀 Rust 커맨드** `read_file` (scope 기계장치 없이 임의 경로 읽기)
- 렌더링: GFM(표/체크박스/취소선/자동링크) + **Shiki 코드 하이라이팅**(시스템 라이트/다크 자동 연동) + **마크다운 내 raw HTML**(`<details>`, `<kbd>` 등) + **YAML frontmatter 숨김 처리**
- 본문 스타일: **github-markdown-css** (auto 변형, 시스템 라이트/다크 연동)
- 외부 링크: 클릭 시 기본 브라우저로 (`plugin-opener`) — 웹뷰 이탈 방지
- 전 모듈 TDD (useFileDrop 포함, §7)

### 비목표 (이번 작업 범위 밖)

- 상대 경로 이미지(`![](./img.png)`) — 사용자 결정으로 제외. asset protocol + URL 재작성이 필요해 별도 작업
- XSS sanitize(기존 프로젝트 결정: 신뢰할 수 없는 .md 없음), 파일 watcher(4번), Finder 연동(5번)
- 네이티브 File 메뉴 (Cmd+O는 프론트 keydown으로 처리)
- Rust 측 테스트 (vitest 인프라 설계의 기존 비목표 유지)
- 커버리지 threshold 도입 (별도 결정)

## 3. 결정 사항과 근거

| 결정 | 선택 | 근거 |
|---|---|---|
| 파일 열기 UX | 다이얼로그 + 드래그&드롭 | 사용자 선택. Tauri 내장 drag-drop 이벤트라 추가 비용 작음 |
| 파일 읽기 | **커스텀 Rust 커맨드** (`std::fs::read_to_string`) | 앱 자체 커맨드는 capability 설정 없이 기본 허용(공식 문서 확인). 다이얼로그·드롭·향후 Finder 연동·최근 파일까지 동일 동작, 재시작 무관. 대안인 plugin-fs는 `fs:allow-read-text-file` + scope 설정 + (최근 파일 시) persisted-scope까지 필요 |
| Shiki 통합 | `@shikijs/rehype/core`의 `rehypeShikiFromHighlighter` + `createHighlighterCoreSync` + JS 정규식 엔진 | **기본 `@shikijs/rehype`는 비동기라 react-markdown v10의 동기 `<Markdown>`에서 런타임 크래시** (`runSync finished async` — react-markdown#680, shikiji#22로 확인). 동기 하이라이터는 추가 의존성 없이 shiki 4.2로 가능 |
| Shiki 테마 | github-light + github-dark 듀얼, `defaultColor: 'light-dark()'` | 시스템 라이트/다크 자동 연동(사용자 선택). `light-dark()`는 override CSS 0줄, macOS 14.5+ WKWebView 필요 — 현 환경(macOS 26) 충족. 전제조건 `:root { color-scheme: light dark }` 명시 |
| 본문 스타일 | github-markdown-css 5.9 auto 변형 | 사용자 선택. `prefers-color-scheme`로 자동 전환. body 배경은 패키지가 안 칠하므로 직접 지정 |
| raw HTML | rehype-raw 포함 | 사용자 선택. react-markdown은 기본적으로 raw HTML 제거 — `<details>`/`<kbd>`/`<br>` 사용을 위해 필요. 동기 플러그인이라 안전. **rehypePlugins에서 shiki보다 앞에** 배치 |
| frontmatter | remark-frontmatter 포함 | 사용자 선택. 없으면 `---` 블록이 구분선+제목으로 깨져 보임 |
| 외부 링크 | `MarkdownView`의 `a` 컴포넌트 → 주입된 `onLinkClick` → App에서 `openUrl`(plugin-opener) | 미처리 시 웹뷰가 링크로 이동해 앱 사실상 고장. opener는 이미 설치·권한 부여됨 |
| Cmd+O | window keydown 리스너 | 네이티브 메뉴는 Rust 코드가 과함(개인 앱) |
| 비UTF-8 파일 | lossy 변환 없이 에러 처리 | 본인 작성 .md는 전부 UTF-8. 조용히 깨진 문자보다 명시적 실패 |
| DI 시그니처 | §4.2 표 참고 | test-code-style의 모킹 금지 제약 → 외부(Tauri) 의존은 전부 주입 |

## 4. 설계

### 4.1 데이터 흐름

```
경로 획득 ──┬─ 다이얼로그: open({ filters: [md, markdown, mdx] }) → string | null(취소)
            ├─ 드롭: onDragDropEvent 'drop' → paths에서 isMarkdownPath 첫 매치 (없으면 무시)
            └─ (5번에서 Finder 더블클릭 경로가 여기에 합류)
      ↓
invoke('read_file', { path }) ── Rust: std::fs::read_to_string → Result<String, String>
      ↓
App 상태 { path, content } 갱신 (실패 시 error만 갱신, 기존 문서 유지)
      ↓
<MarkdownView source={content} onLinkClick={openUrl} /> 동기 렌더
```

상태는 App의 `useState` 두 개(`document: { path, content } | null`, `error: string | null`)로 충분. 전역 상태 관리 없음.

### 4.2 모듈 구성

| 파일 | 역할 | DI 시그니처 (모킹 금지 대응) |
|---|---|---|
| `src/lib/markdownFile.ts` (신규) | `isMarkdownPath(path)` 등 순수 판정 로직. 허용 확장자 상수(`md`/`markdown`/`mdx`, 대소문자 무관)는 다이얼로그 필터와 공유 | 순수 함수 — DI 불필요 |
| `src/lib/highlighter.ts` (신규) | 동기 Shiki 싱글턴: `createHighlighterCoreSync` + `createJavaScriptRegexEngine({ forgiving: true })` + github-light/dark + 언어 정적 import | 인스턴스 export. 동작은 MarkdownView spec이 커버 |
| `src/components/MarkdownView.tsx` (신규) | react-markdown 래퍼. remark: `gfm`, `frontmatter` / rehype: `raw` → `[rehypeShikiFromHighlighter, highlighter, options]`. 플러그인 배열은 모듈 레벨 상수 | `onLinkClick: (url: string) => void` prop. `openUrl` 직접 import 금지 |
| `src/hooks/useFileDrop.ts` (신규) | drag-drop 구독 + `isDragging` 상태. 'drop' → `onDrop(paths)`, 'enter'/'over' → true, 'leave' → false. unmount 시 unlisten | `subscribe` 인자(기본값 = `(handler) => getCurrentWebview().onDragDropEvent(handler)`)로 구독 함수 주입 |
| `src/App.tsx` (교체) | 빈 상태 화면(열기 버튼 + 드래그 안내), Cmd+O keydown, 드래그 중 하이라이트, 에러 배너, 본문 렌더. 드롭 paths는 `isMarkdownPath` 첫 매치만 열기 | `pickFile`/`readFile`/`subscribeDragDrop` 기본값 있는 prop 주입 (기본값 = dialog `open` / `invoke('read_file')` / Tauri 구독). `subscribeDragDrop`은 useFileDrop에 전달 — 없으면 jsdom 테스트에서 기본값이 Tauri API를 호출해 실패 |
| `src/App.css` (교체) | `.markdown-body` 컨테이너(max-width 980px, padding 45px), body 배경 라이트(#fff)/다크(#0d1117), `:root { color-scheme: light dark }`, `.shiki` overflow/radius | — |
| `src-tauri/src/lib.rs` (수정) | `read_file` 커맨드 추가(`Err(e.to_string())`), `greet` 데모 제거, `tauri_plugin_dialog::init()` 추가. **opener 플러그인 유지**(링크 열기 사용) | — |
| `src/main.tsx` (수정) | `github-markdown-css/github-markdown.css` import 추가 | — |

언어 번들(정적 import만 번들에 포함 — fine-grained): typescript, tsx, javascript, json, bash, python, rust, css, html, yaml, sql, markdown. 그 외 언어는 `fallbackLanguage: 'text'`로 플레인 렌더(throw 없음), 언어 없는 펜스는 `defaultLanguage: 'text'`.

### 4.3 Shiki 플러그인 옵션 (확정)

```ts
[rehypeShikiFromHighlighter, highlighter, {
  themes: { light: 'github-light', dark: 'github-dark' },
  defaultColor: 'light-dark()',   // :root color-scheme 전제 (App.css)
  fallbackLanguage: 'text',
  defaultLanguage: 'text',
  // lazy: true 금지 — 파이프라인이 비동기가 되어 동기 <Markdown>이 크래시 (교차검증 확인)
}]
```

### 4.4 에러 처리

- 읽기 실패(권한·비UTF-8·디렉터리 드롭 등): Rust가 `Err(문자열)` → 에러 배너 표시, **기존 문서는 유지**
- 다이얼로그 취소(`null`): 무동작
- 드롭 paths에 마크다운 파일이 없으면: 무시 (배너 없음)
- 디렉터리를 드롭한 경우: `read_to_string`이 Err → 위 읽기 실패 경로로 자연 처리

### 4.5 의존성 변경

- pnpm 추가: `@tauri-apps/plugin-dialog`, `github-markdown-css`, `rehype-raw`, `remark-frontmatter`, `@shikijs/themes`, `@shikijs/langs`
  (마지막 둘은 현재 shiki의 전이 의존성으로만 존재하는데 직접 import하므로 명시 선언 — 교차검증 권고)
- Cargo 추가: `tauri-plugin-dialog = "2"`
- `src-tauri/capabilities/default.json`: `"dialog:default"` 한 줄 추가 (drag-drop은 기존 `core:default`로 충분, `dragDropEnabled`는 기본 활성)

## 5. 트레이드오프 / 리스크

- **`light-dark()` 의존**: macOS 14.5+ WKWebView 전용. 구형 macOS에선 코드블록이 라이트로 고정되는 silent 실패. 단일 사용자·최신 macOS 전제로 수용. 문제가 되면 classic `--shiki-dark` CSS 변수 + `!important` 미디어쿼리로 전환(코드 변경은 옵션 한 줄 + CSS 블록)
- **`forgiving: true`**: JS 엔진이 변환 못 하는 문법은 조용히 부분 하이라이팅. `fallbackLanguage`와 함께 silent degradation 2겹 — 개인 뷰어 기준 수용, `onError`는 추가하지 않음(로드된 언어의 토큰화 에러까지 삼키므로)
- **동기 하이라이팅이 렌더 경로에 위치**: 매우 큰 코드블록은 메인 스레드 블록. 열어서 보는 용도론 무관, 4번(watcher) 작업 시 재평가
- **Rust `read_file`의 블로킹 I/O**: async 커맨드라 UI는 안 멈춤(tokio worker 점유만). 네트워크 볼륨 hang 등은 개인 앱 기준 수용
- **CSP `null` 전제**: shiki 인라인 style 속성이 CSP 없이는 무제약. CSP를 켜는 날엔 `style-src 'unsafe-inline'` 필요 — 켜지 않는 것이 기존 프로젝트 결정

## 6. 검증 기준 (TDD — red-green-refactor)

각 spec은 대상 파일과 colocate, 구현 전 작성 → fail 확인 → 최소 구현 → green. 모킹 없이 DI로만.

| spec (env) | 검증 내용 |
|---|---|
| `markdownFile.spec.ts` (node) | 확장자 판정: md/markdown/mdx 허용(대소문자 무관), 그 외·확장자 없음·디렉터리형 경로 거부 — `test.each` |
| `MarkdownView.spec.tsx` (jsdom) | GFM 표/체크박스/취소선 렌더, 코드펜스(번들 언어 → shiki 토큰 출력 / 미지원 언어 → 플레인 / 언어 없음 → 플레인), frontmatter 미표시, raw HTML(`<kbd>`/`<details>`) 렌더, 링크 클릭 → `onLinkClick(href)` 호출 + 기본 네비게이션 방지 |
| `useFileDrop.spec.tsx` (jsdom) | 주입한 fake `subscribe`로: 'drop' → `onDrop(paths)` + isDragging false / 'enter'·'over' → true / 'leave' → false / unmount → unlisten 호출 |
| `App.spec.tsx` (jsdom) | 주입한 `pickFile`/`readFile`/`subscribeDragDrop`으로: 열기 성공 → 본문 렌더 / 읽기 실패 → 에러 배너 + 기존 문서 유지 / 취소(null) → 무동작 / 빈 상태 ↔ 문서 상태 전환 / Cmd+O keydown → 열기 트리거 / fake 드롭: 마크다운 경로 포함 → 해당 파일 열기, 비마크다운만 → 무시 |

**수동 체크리스트 (`pnpm tauri dev`, OS 통합 glue만):** 실제 다이얼로그로 .md 열기, Finder에서 실제 드래그&드롭, 비마크다운 파일 드롭 무시, 디렉터리 드롭 에러 배너, 시스템 다크모드 전환 시 본문+코드블록 동시 전환, 외부 링크가 기본 브라우저로 열림, Cmd+O 동작. 마지막으로 `pnpm test` + `pnpm build` + `pnpm tauri build` green.

## 7. TDD 범위 결정 기록

- useFileDrop 포함 모든 프론트 모듈 TDD (사용자 결정 — subscribe DI 채택)
- TDD 예외(사용자 승인): Rust `read_file`(기존 비목표), App.css/main.tsx import(설정성 변경), 실제 OS 통합(다이얼로그 UI·실드롭·다크모드 시각) → 수동 체크리스트

## 8. 추가 결정 (수동 검증 중 사용자 요청): 네이티브 File > Open… 메뉴

- **방식**: JS 메뉴 API. `Menu.default()`로 기본 메뉴 사본 생성 → File 서브메뉴(텍스트 "File"로 탐색, 고정 id 없음)에 `MenuItem`("Open…", accelerator `CmdOrCtrl+O`)을 0번 위치에 삽입 → `setAsAppMenu()`. Rust 변경 0줄, 권한은 기존 `core:default`(`core:menu:default` 포함)로 충분. 기본 메뉴 사본 수정이므로 Edit 메뉴의 네이티브 복사/붙여넣기 동작 보존(메뉴를 처음부터 만들면 macOS에서 Cmd+C/V가 죽는 함정 회피 — tauri#7428).
- **기존 ⌘O keydown 리스너 제거 (필수)**: macOS WKWebView는 Cmd 키를 웹페이지에 먼저 전달한 뒤 메뉴로 넘김(wry 소스 확인). 둘 다 두면 다이얼로그 이중 오픈, keydown에서 preventDefault하면 메뉴 액셀러레이터 사장. 열기 트리거의 단일 소유자 = 메뉴.
- **DI**: App에 `installMenu?: (args: { onOpen: () => void }) => void` prop 추가(기본값 = 실제 `installAppMenu` 래퍼). 테스트는 가짜 installMenu가 캡처한 onOpen을 호출해 기존 시나리오(빈 상태 열기, 실패 후 두 번째 열기)를 메뉴 트리거로 검증 — 모킹 없음. 기존 Cmd+O keydown 테스트 2건은 메뉴 트리거 테스트로 교체.
- **TDD 예외 (사용자 승인 포함)**: `src/lib/installAppMenu.ts`는 전부 Tauri 메뉴 API 글루 → 단위 테스트 없음, vitest 커버리지 exclude에 추가(main.tsx와 동일 취급), 수동 체크리스트로 검증.
- **알려진 특성**: 메뉴 액션은 JS Channel이라 웹뷰 리로드 시 죽음 → 페이지 로드마다 재설치(모듈 플래그는 같은 페이지 내 StrictMode 중복만 방지). tauri ≥ 2.6.0 필요 — 현재 2.11.2 ✓. 앱 시작 직후 잠깐 기본 메뉴가 보였다 교체되는 플래시는 수용. macOS Tahoe에서 dialog 플러그인이 modifier 상태를 뒤집는다는 리포트(plugins-workspace#3245) 존재 — 수동 검증에서 ⌘O 동작 확인 필요.
- **수동 체크리스트 추가 항목**: File 메뉴에 Open…(⌘O) 표시, 메뉴 클릭으로 열기 동작, ⌘O로 다이얼로그가 **정확히 한 번** 열림, Edit 메뉴 복사/붙여넣기 정상.
