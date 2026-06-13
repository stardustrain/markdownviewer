# 마크다운 링크 동작 설계

- 날짜: 2026-06-12
- 상태: 승인됨 (구현 계획 작성 전)
- 진행 위치: `fix/link` 브랜치
- 검증: opener 권한/scope 모델(plugins-workspace 소스)·rehype-slug 한글 슬러그(github-slugger@2 실증)·react-markdown@10 href 인코딩(mdast-util-to-hast/micromark 소스)·WKWebView fragment 네비게이션(HTML 스펙 + tauri PR #1947)을 다중 에이전트로 소스/공식 문서 레벨 확인 (2026-06-12)

본문 링크가 실제로 동작하게 한다: 외부 링크는 기본 브라우저, 상대 경로 `.md`는 뷰어에서 열기(현재 문서 교체), 상대 경로 비마크다운은 OS 기본 앱, `#앵커`는 문서 내 스크롤. 현재는 모든 링크가 `preventDefault` 후 `openUrl`로 가서 상대 경로·앵커가 조용히 실패한다.

## 1. 목표 / 비목표

### 목표

- 스킴 있는 외부 링크(`http:`/`https:`/`mailto:` 등) → 기본 브라우저 (`openUrl`, 현행 유지)
- 상대 경로 `.md`/`.markdown`/`.mdx` → 기존 `openPath`로 열기 (문서 교체, watcher 자동 전환, 에러 배너 재사용)
- 상대 경로 비마크다운(`./report.pdf` 등) → opener `openPath`로 OS 기본 앱
- `#앵커` → 같은 문서 내 헤딩으로 스크롤 (rehype-slug id 생성 + 네이티브 fragment 네비게이션)

### 비목표

- 절대 경로(`/...`)·`file://` 링크 — 무시 (사용자 결정: 상대 경로만 지원)
- `./other.md#section`의 섹션 스크롤 — 파일만 열고 fragment는 버림 (향후)
- 탭/멀티 문서 — 사용자가 "md 링크는 새 탭" 희망했으나 탭 인프라가 더 큰 작업이라 분리, 이번엔 단일 문서(교체) 유지. 탭 스펙에서 md 링크 동작을 새 탭으로 바꾼다
- 뒤로 가기, 상대 경로 이미지(기존 제외 유지)

## 2. 결정 사항과 근거

| 결정 | 선택 | 근거 (검증됨) |
|---|---|---|
| 분류 위치 | 프론트 순수 함수 `classifyLink` | Rust 변경 0, node 프로젝트에서 순수 함수 테스트. Rust `open_link` 커맨드 안(로직이 IPC로 쪼개짐)·rehype 플러그인 안(클릭 시점 분류와 결과 동일한데 인프라만 증가) |
| 앵커 처리 | `preventDefault` 생략 → 네이티브 | HTML 스펙 "select the indicated part"가 fragment를 percent-decode해 id 매칭 — 한글 id도 동작. WKWebView의 same-document 네비게이션은 리로드 없음·커스텀 프로토콜 미경유(tauri PR #1947). JS 스크롤 코드 불필요 |
| 헤딩 id | `rehype-slug@^6`, rehypeRaw **뒤** | hast v3 기반 — react-markdown@10 호환. github-slugger@2: `"한글 제목"` → `"한글-제목"`(유니코드 보존, 실증). raw HTML 헤딩은 rehypeRaw가 element로 만든 뒤에야 보이므로 순서 필수. 중복 헤딩은 `-1` 접미사, 기존 id는 건너뜀 |
| href 디코딩 | raw에서 첫 `#`로 fragment 분리 → `decodeURIComponent` + try/catch fallback | react-markdown@10은 href를 normalizeUri로 percent-encode해 전달(`./한글.md` → `./%ED%95%9C...md`). `50%off.md`류는 normalizeUri를 통과하지만 decode 시 URIError → raw 그대로 사용. decode 후 분리하면 `%23`(리터럴 `#`)과 fragment 구분 불가 — 반드시 분리 먼저 |
| 위험 스킴 방어 | 추가 안 함 | react-markdown 기본 urlTransform이 `file:` 등 비허용 스킴 href를 `""`로 치환(통과: http/https/irc/ircs/mailto/xmpp + 상대·절대 경로 + 앵커). 빈 href는 ignored 처리 |
| 경로 조합 | `dirname(현재 canonical 경로) + "/" + 상대경로`, 정규화 없음 | `..`은 std::fs(`read_file`/`start_watching`)와 OS가 해석. `start_watching`의 canonicalize가 문서 식별자를 정리(기존 메커니즘). 현재 경로는 canonical 절대 경로라 `/` 항상 존재 |
| 비md 열기 권한 | `opener:allow-open-path` + `"allow": [{"path": "/**"}]` | `opener:default`는 open_path를 전혀 허용 안 함(allow-open-url + reveal + default-urls뿐). scope 없는 bare 권한도 전부 거부("Not allowed to open path"). 추가로 Unix 기본 `require_literal_leading_dot=true` 때문에 dot 디렉터리 경로가 glob에 안 걸림 → `tauri.conf.json`에 `plugins.opener.requireLiteralLeadingDot: false` |
| 깨진 링크 | md → 기존 read-error 배너(공짜) / 비md → openPath reject → 같은 배너 | opener open_path는 openWith 없으면 `metadata()` 존재 확인 후 reject — "No such file or directory (os error 2)" (소스 확인) |
| DI | `openExternal`/`openWithOS` props | 기존 패턴(`pickFile`/`readFile`/`startWatching` 등)과 동일 — mocking 없이 fake 주입 |

## 3. 설계

### 3.1 데이터 흐름

```
클릭 → MarkdownView: href 없음 또는 "#" 시작 → return (네이티브 fragment 스크롤)
                     그 외 → preventDefault + onLinkClick({ url: href })
     → App.handleLinkClick → classifyLink({ href: url })
        external → void openExternal({ url })                      (실패 무시 — 현행 동일)
        relative → resolved = dirname(openedPathRef.current) + "/" + path
                   isMarkdownPath → void openPath({ path: resolved })   (기존: 읽기 → watch 교체 → 배너)
                   그 외        → openWithOS({ path: resolved })        (reject → read-error 배너)
        ignored  → 무동작
```

### 3.2 classifyLink 명세 — `src/lib/classifyLink.ts` (신규, 순수)

```ts
type LinkClassification =
  | { kind: "external"; url: string }   // 스킴 있음 — URL 원본 그대로
  | { kind: "relative"; path: string }  // fragment 제거 + 디코딩 완료된 상대 경로
  | { kind: "ignored" };                // 빈 href, "/" 시작(절대 경로·protocol-relative), fragment 분리 후 빈 경로

function classifyLink(args: { href: string }): LinkClassification;
```

판정 순서:

1. `/^[a-zA-Z][a-zA-Z0-9+.-]*:/` 매치 → `external`
2. 빈 문자열 또는 `/` 시작 → `ignored`
3. 나머지: raw href를 첫 `#`에서 자른 앞부분이 빈 문자열이면 `ignored`, 아니면 `decodeURIComponent`(URIError 시 raw fallback)한 값으로 `relative`

`#` 시작 앵커는 MarkdownView가 위임 전에 거르므로 정상 흐름에선 이 함수에 도달하지 않지만, 도달해도 3번 규칙(분리 후 빈 경로 → `ignored`)으로 총함수로 동작한다.

### 3.3 모듈 구성

| 파일 | 변경 | DI |
|---|---|---|
| `src/lib/classifyLink.ts` (신규) | href 분류 + fragment 분리 + 디코딩 | — (순수) |
| `src/components/MarkdownView.tsx` (수정) | `rehypePlugins: [rehypeRaw, rehypeSlug, shiki]`, 클릭 핸들러에서 href 없음·`#` 시작은 통과 | 기존 `onLinkClick` 유지 |
| `src/App.tsx` (수정) | `handleLinkClick`을 컴포넌트 내부 useCallback으로(라우팅 로직), 모듈 스코프 `handleLinkClick`·`openUrl` 직접 import 제거(이번 변경의 고아) | `openExternal?: (args: { url: string }) => Promise<void>`(기본: openUrl 래퍼), `openWithOS?: (args: { path: string }) => Promise<void>`(기본: opener openPath 래퍼) 추가 |
| `src-tauri/capabilities/default.json` (수정) | `{"identifier": "opener:allow-open-path", "allow": [{"path": "/**"}]}` 추가 | — |
| `src-tauri/tauri.conf.json` (수정) | `"plugins": {"opener": {"requireLiteralLeadingDot": false}}` 추가 | — |

신규 의존성: `rehype-slug@^6` 1개. Rust 코드 변경 없음.

### 3.4 에러 처리

- md 링크 대상 없음/읽기 실패 → 기존 read-error 배너, 현재 문서 유지(openPath의 generation 가드가 실패 시 상태를 건드리지 않음)
- 비md 링크 대상 없음 → `openWithOS` reject 메시지를 read-error 배너로 표시
- 외부 링크 중 opener scope 밖 스킴(irc/xmpp — urlTransform은 통과하지만 opener 기본 scope는 http/https/mailto/tel만) → reject 무시(현행 동일)
- `decodeURIComponent` 실패 → raw 문자열로 진행(읽기 실패 시 배너가 사용자에게 알림)

## 4. 검증 기준

**TDD (DI fake, mocking 없음):**

- `classifyLink.spec.ts` (node): `https://...`/`mailto:` → external / 빈 문자열·`/abs/path.md`·`//host`·`#sec`(방어) → ignored / `./%ED%95%9C%EA%B8%80.md` → relative `"./한글.md"` / `./other.md#sec` → relative `"./other.md"` / `50%off.md` → relative raw fallback / `sub/no-prefix.md` → relative
- `MarkdownView.spec.tsx` (jsdom): `"# 한글 제목"` → `id="한글-제목"` 헤딩 / `[a](#한글-제목)` 클릭 → preventDefault 안 됨 + onLinkClick 미호출 / 일반 링크 기존 테스트(위임 + preventDefault) 유지
- `App.spec.tsx` (jsdom): 외부 링크 클릭 → `openExternal` 호출 / `./other.md` 클릭 → `readFile`이 `{현재 dir}/other.md`로 호출 + 문서 교체 / `./file.pdf` 클릭 → `openWithOS` 호출 + `readFile` 미호출 / `openWithOS` reject → read-error 배너 / 절대 경로 링크 → 아무 호출 없음

**수동 (`pnpm tauri dev` — 네이티브 스크롤·브라우저·OS 앱은 jsdom 검증 불가):**

- [ ] 외부 https 링크 → 기본 브라우저
- [ ] `./other.md` → 문서 교체, 이후 other.md 저장 시 watcher 갱신이 따라옴
- [ ] `../` 포함 상대 경로 → 열림
- [ ] 한글·공백 파일명 링크 → 열림
- [ ] `./xxx.pdf` → 미리보기(기본 앱)로 열림
- [ ] 없는 파일 링크(md/비md 각각) → 배너
- [ ] 한글 헤딩 앵커 → 문서 내 스크롤(리로드 없음)
- [ ] dot 디렉터리 아래 비md 파일(`.notes/x.pdf` 류) → 열림 (requireLiteralLeadingDot 확인)
- [ ] 절대 경로·`file://` 링크 → 무동작

## 5. 트레이드오프 / 리스크

- **`"/**"` scope는 사실상 전체 파일시스템 개방** — 개인 도구·신뢰된 .md만 보는 방침(기존 `read_file`도 임의 경로 허용)과 일치. 배포 계획 없음
- **`100%20.md`처럼 유효 %hex 시퀀스를 리터럴로 가진 파일명은 잘못 디코딩**(`100 .md`) — normalizeUri 설계상 불가피한 손실 케이스, 한계로 문서화 (회피하려면 mdast `node.url`을 인코딩 전에 보존하는 커스텀 플러그인 필요 — 과함)
- irc/xmpp 스킴은 urlTransform 통과 집합과 opener 허용 집합의 차이로 조용히 실패 — 실사용 영향 없음
- **raw 공백을 가진 상대 경로(`[노트](한글 노트.md)`)는 링크 자체가 생성되지 않음** — CommonMark상 유효한 destination이 아니라 react-markdown이 `<a>`를 만들지 않는다. 작성자가 `한글%20노트.md` 또는 `<한글 노트.md>`로 써야 동작(검증됨, 한계)
- 네이티브 앵커 스크롤은 jsdom에서 검증 불가(스펙상 "preventDefault 안 함"만 고정) → 수동 항목으로 커버
- location.hash가 앵커 클릭으로 바뀌어 잔류하지만 라우터가 없어 무해
