# mermaid 다이어그램 렌더링 설계

- 날짜: 2026-06-12
- 상태: 승인됨 (구현 계획 작성 전)
- 진행 위치: `feature/mermaid` 브랜치 (로드맵 2~5번 main 머지 이후 신규 항목)
- 검증: exa/context7 리서치 완료(2026-06-12) — shiki rehype의 fallbackLanguage 동작은 소스 레벨 확인, mermaid render/initialize/테마 API는 공식 문서. 계획 단계에서 실제 설치 패키지로 스파이크 2회 + 다중 에이전트 적대적 리뷰(9 에이전트) 수행: 초안의 remark `data.hName` 방식은 `<pre>` 래퍼가 남는 결함이 확인되어 remark-rehype `handlers.code` 오버라이드로 교체, components 인라인 매핑의 remount 결함은 useMemo 안정화로 해결(아래 §2에 반영). 관련 스펙: [2026-06-10-file-open-rendering-design.md](2026-06-10-file-open-rendering-design.md)

\`\`\`mermaid 코드펜스를 GitHub처럼 SVG 다이어그램으로 렌더한다. 다이어그램 렌더링만 — 확대/패닝/코드 토글 등 부가 기능 없음 (사용자 결정).

## 1. 목표 / 비목표

### 목표

- \`\`\`mermaid 펜스 → SVG 다이어그램 렌더
- OS 라이트/다크 테마 추종 (전환 시 재렌더)
- 문법 오류 시 원본 코드 + 에러 메시지 표시 (편집 중 저장 → watcher 재렌더에서 빈번)
- mermaid 펜스 없는 문서에는 비용 0 (dynamic import로 청크 분리)

### 비목표

- 확대/패닝, 원본 코드 토글, 내보내기 등 부가 기능
- 다이어그램별 개별 테마 지정 (mermaid init 지시어 등)
- jsdom에서 실제 mermaid 렌더 결과 검증 (SVG 측정이 필요해 불가 — 수동 검증으로 커버)

## 2. 결정 사항과 근거

| 결정 | 선택 | 근거 |
|---|---|---|
| 가로채기 지점 | **remark-rehype `handlers.code` 오버라이드**: `lang === "mermaid"`면 `<pre>` 래퍼 없이 `<mermaid-block code="...">` hast 엘리먼트를 직접 생성, 그 외엔 `defaultHandlers.code` 위임 | 현재 파이프라인은 `fallbackLanguage: "text"`라 shiki가 mermaid 펜스를 소비하고 `language-mermaid` 클래스를 없앤다(소스 확인) — 흔한 "code 컴포넌트 className 검사" 패턴이 통하지 않음. 초안의 remark 플러그인 + `data.hName` 방식은 mdast-util-to-hast의 code 핸들러가 hName을 내부 엘리먼트에만 적용 후 무조건 `<pre>`로 감싸 다이어그램이 코드박스 안에 갇히는 결함이 리뷰에서 확인되어 기각(스파이크 재검증). 핸들러 방식은 `pre > code`가 아닌 bare 엘리먼트를 만들어 shiki·rehypeRaw·blockquote 중첩 모두 통과(스파이크 검증) |
| 렌더 방식 | **컴포넌트 내부 비동기** `mermaid.render` (useEffect) | 파이프라인은 동기 유지 — 동기 `<Markdown>` 제약(기존 결정)과 충돌 없음. rehype-mermaid류 비동기 플러그인은 크래시라 기각 |
| 라이브러리 | **mermaid 직접 사용** (+ `mdast-util-to-hast` — `defaultHandlers` 위임용 런타임 의존성, react-markdown의 transitive를 직접 의존성으로 승격) | react-markdown-mermaid 기각: 저사용 신생 라이브러리, 테마 재렌더·에러 UX가 우리 결정과 맞는지 보장 없음 |
| components 안정성 | **`useMemo`로 components 객체 참조 고정** (deps: `[onLinkClick, mermaid]`), `onLinkClick`/`mermaid` prop은 참조 안정 요구를 jsdoc에 명시 | react-markdown은 components 매핑 함수를 React element type으로 그대로 사용 — 인라인 매핑은 렌더마다 새 identity가 되어 source 변경(watcher 재로드)·드래그 오버 등 모든 재렌더에서 MermaidDiagram이 remount되고 SVG가 소실된다(리뷰에서 확인, 스파이크 재검증). 아래 "이전 SVG 유지" 결정의 전제 조건 |
| 테마 | `matchMedia("(prefers-color-scheme: dark)")` 구독 — 다크면 `theme: "dark"`, 라이트면 `"default"`, 전환 시 재렌더 (사용자 결정) | mermaid는 렌더 시점에 SVG에 색을 박아 CSS `light-dark()`로 전환 불가. 렌더 직전 `initialize({ theme })` 호출이 공식 테마 전환 방법 |
| 에러 UX | 에러 메시지 + 원본 코드를 일반 코드블록으로 표시 (사용자 결정). `suppressErrorRendering: true` | 로컬 편집 뷰어 용도 — 무엇이 틀렸는지 보면서 고친다. mermaid가 DOM에 직접 꽂는 에러 SVG는 차단 |
| 로딩/재렌더 | 첫 렌더 전엔 원본 코드 표시(로컬이라 수십 ms), code 변경 시 **이전 SVG 유지** 후 완료되면 교체 | 저장마다 깜빡임 방지. code가 같으면 effect deps 동일 → 재렌더 자체가 없음 |
| render id | 모듈 레벨 카운터 `mermaid-{n}` | React `useId()`는 `:` 포함 — mermaid 내부 selector 충돌 위험 |
| 번들 | mermaid **dynamic import** | ~2MB JS. 앱 시작·mermaid 없는 문서에 비용 0, 최초 mermaid 문서에서 1회 로드 |
| DI | `renderDiagram`·`subscribeColorScheme`을 주입 가능한 prop으로, 기본값은 실제 구현 | 프로젝트 원칙(no mocking, 기본값 있는 DI). jsdom엔 matchMedia도 없어 주입이 필수 |
| 보안 설정 | mermaid 기본값 유지 (`securityLevel: "strict"`) | untrusted .md 없음(기존 결정)이지만 기본값을 바꿀 이유도 없음 |

## 3. 설계

### 3.1 데이터 흐름

```
source
  → remark: gfm, frontmatter
  → remark-rehype (handlers.code 오버라이드):
      mermaid 펜스 → <mermaid-block code="..."> (pre 래퍼 없음)
      그 외 펜스 → defaultHandlers.code 위임 (기존과 동일한 pre>code)
  → rehype: rehypeRaw → shiki — 둘 다 mermaid-block 통과 (pre>code 아님)
  → react-markdown components(useMemo로 참조 고정): "mermaid-block" → <MermaidDiagram code={...}>

MermaidDiagram: useEffect[code, isDark]
  → renderDiagram({ id, code, theme })  (기본값: dynamic import mermaid
      → initialize({ startOnLoad: false, suppressErrorRendering: true, theme }) → render)
  ├─ 성공 → SVG 교체 (이전 SVG는 완료까지 유지)
  └─ 실패 → 에러 메시지 + 원본 코드 (다음 성공 시 해제)
OS 테마 변경 → subscribeColorScheme 콜백 → isDark 갱신 → effect 재실행 → 재렌더
```

### 3.2 모듈 구성

| 파일 | 역할 | DI |
|---|---|---|
| `src/lib/renderMermaidDiagram.ts` (신규) | 기본 렌더 구현: dynamic import + initialize(테마) + render. 시그니처 `({ id, code, theme }) => Promise<{ svg: string }>` | — |
| `src/components/MermaidDiagram.tsx` (신규) | 비동기 렌더 상태기계(코드 표시 → SVG / 에러), 테마 구독, id 카운터 | `renderDiagram?` 기본값 = renderMermaidDiagram, `subscribeColorScheme?` 기본값 = matchMedia 래퍼 |
| `src/components/MarkdownView.tsx` (수정) | `remarkRehypeOptions.handlers.code`에 비공개 핸들러(`mermaidAwareCodeHandler`) 연결, `components`에 `"mermaid-block"` 매핑(JSX IntrinsicElements 선언 병합으로 type assertion 없이 — 계획 단계 스파이크로 검증)을 useMemo로 고정, MermaidDiagram DI prop 전달 통로. 핸들러는 export하지 않는 모듈 내부 함수라 단위 spec 의무가 없고 MarkdownView 통합 테스트가 행동을 고정한다 | `mermaid?: { renderDiagram?, subscribeColorScheme? }` (App은 기본값 사용 — prop 미전달) |

`subscribeColorScheme`은 useFileDrop/useFileWatch와 동일한 subscribe DI 패턴: `({ onChange }) => unsubscribe`. **계약: 구독 즉시 현재 값을 동기로 1회 전달하고, 이후 변경마다 전달** — 컴포넌트가 초기 테마를 별도로 읽을 필요 없음. 기본값은 matchMedia 래퍼(`matches` 즉시 전달 + change 이벤트).

## 4. 검증 기준

**TDD (모킹 없이 DI fake):**

| spec | 케이스 |
|---|---|
| `MermaidDiagram.spec.tsx` (jsdom) | 렌더 완료 전 원본 코드 표시 / 성공 → SVG 표시 / 실패 → 에러 메시지 + 원본 코드 / 에러 후 재성공 → 에러 해제 / code 변경 → 새 code 인자로 재호출 + 완료까지 이전 SVG 유지(지연 promise로 재현) / 늦은 stale resolve 무시(race) / 테마 변경 → `theme: "dark"`로 재호출 / unmount 시 구독 해제 (unmount 후 늦은 resolve는 단독 실패 조건을 정의할 수 없어 동일 코드 경로인 race 테스트가 커버) |
| `MarkdownView.spec.tsx` 추가 (jsdom) | mermaid 펜스 → fake renderDiagram에 코드 원문 전달·SVG 표시 / **다이어그램이 pre 코드박스 안에 렌더되지 않음**(핸들러 회귀) / mermaid 펜스가 있어도 일반 코드펜스는 여전히 shiki 처리 / **source 변경 rerender에도 같은 펜스의 SVG 유지 + 재호출 없음**(components 안정성 회귀) |

**수동 (`pnpm tauri dev`):** flowchart·sequence 등 실제 렌더 확인, OS 다크 전환 → 즉시 재렌더, 문법 오류 저장 → 에러+코드 → 수정 저장 → 다이어그램 복구, mermaid 없는 문서에서 mermaid 청크 미로드(DevTools Network).

## 5. 트레이드오프 / 리스크

- **mermaid 렌더의 레이아웃 계산은 메인 스레드** — 아주 큰 다이어그램은 잠시 버벅일 수 있음(개인 뷰어 기준 수용, 비동기라 첫 페인트는 막지 않음)
- mermaid.initialize는 전역 — 테마는 앱 전체 1개(다이어그램별 테마는 비목표)
- rehypeRaw(hast-util-raw)는 트리를 재직렬화·재파싱하지만 커스텀 엘리먼트와 속성은 보존됨(parse5는 unknown element 유지) — MarkdownView 통합 테스트가 회귀를 잡는다
- jsdom에서 실제 mermaid 동작 검증 불가 — 통합 동작은 수동 검증(기존 Rust 커맨드와 동일 철학)
- 저장(watcher 재로드)마다 다이어그램이 바뀐 블록만 재렌더 — code 동일 시 effect 미실행으로 비용 없음. 단 이 보장은 components 참조 고정(useMemo)과 `onLinkClick`/`mermaid` prop의 참조 안정성이 전제 — MarkdownView 통합 테스트가 회귀를 잡는다
- 커스텀 code 핸들러가 모든 펜스의 변환 경로에 들어간다(비-mermaid는 defaultHandlers 위임) — 기존 shiki 테스트 + 신규 통합 테스트가 위임 경로의 무변경을 고정한다
