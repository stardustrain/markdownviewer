# 탭 문서 열기 설계

- 날짜: 2026-06-13
- 상태: 승인됨 (구현 계획 작성 전)
- 진행 위치: `feature/tab` 브랜치
- 검증: 현재 코드/기존 스펙 확인, Context7로 Tauri v2 이벤트·메뉴 API와 React effect cleanup 확인, Exa로 VS Code/JetBrains/Sublime 외부 변경 동작 및 WAI-ARIA Tabs Pattern 확인, `.agents/skills/tauri-v2`와 `.agents/skills/vercel-react-best-practices` 지침 반영

현재 앱은 하나의 뷰에서 하나의 마크다운 파일만 보여준다. 탭 기능을 추가해 마크다운 링크 클릭, 파일 열기, 드래그앤드롭, OS/Finder/CLI open이 모두 탭 모델을 통해 문서를 열게 한다. 사용자는 상단 탭 스트립에서 문서를 전환하고, `Cmd+Shift+[` / `Cmd+Shift+]`로 이전/다음 탭을 순환한다.

## 1. 목표 / 비목표

### 목표

- 본문 위 상단 탭 스트립 추가
- 마크다운 링크 클릭 → 새 탭에서 열고 활성화
- 파일 열기 메뉴/버튼 → 선택 파일을 탭에서 열고 활성화
- 드래그앤드롭과 OS/Finder/CLI open → 전달된 마크다운 파일을 모두 탭으로 열고 마지막 파일 활성화
- 같은 파일을 다시 열면 중복 탭을 만들지 않고 기존 탭 활성화
- 각 탭 닫기 지원, 마지막 탭을 닫으면 기존 빈 상태로 복귀
- 열린 모든 탭의 파일을 watch해 비활성 탭도 외부 저장/삭제 상태를 반영
- `Cmd+Shift+[` / `Cmd+Shift+]`로 이전/다음 탭 순환
- 읽기 전용 뷰어 범위 안에서 구현하되, 나중에 편집기 확장을 막지 않는 탭 상태 모델 사용

### 비목표

- 편집 기능, dirty 표시, conflict UI, diff UI
- 탭 복원(session restore), 탭 재정렬, 탭 그룹, 멀티 윈도우
- preview tab, split editor, 사이드바 문서 목록
- 비마크다운 상대 링크의 탭화. 기존처럼 OS 기본 앱으로 연다
- Tauri global-shortcut 플러그인 사용. 앱 포커스 내부 단축키만 필요하므로 브라우저 `keydown`으로 처리한다

## 2. 사용자 결정

| 주제 | 결정 |
|---|---|
| 탭 배치 | 본문 위 상단 탭 스트립 |
| 같은 파일 재열기 | 기존 탭 활성화 |
| 탭 닫기 | 각 탭에 닫기 버튼, 마지막 탭 닫기 시 빈 상태 |
| 비활성 탭 외부 변경 | 모든 열린 탭 감시 |
| 편집기 확장 대비 | 내부 상태 모델만 확장 가능하게 하고, UI는 읽기 전용 범위 유지 |
| 다중 파일 수신 | 모두 탭으로 열고 마지막 파일 활성화 |
| 탭 primitive | `@radix-ui/react-tabs` 사용 |

## 3. 결정 사항과 근거

| 결정 | 선택 | 근거 |
|---|---|---|
| UI primitive | `@radix-ui/react-tabs` | Headless/unstyled라 현재 CSS와 맞고, tablist/tab/tabpanel ARIA와 표준 키보드 동작을 위임할 수 있다. Tailwind 전제인 shadcn/ui보다 범위가 작고, React Aria Components보다 탭 하나만 도입하는 비용이 낮다 |
| 탭 상태 위치 | `App.tsx`가 소유, `TabBar`는 controlled UI | 파일 열기, watcher, OS open, 링크 라우팅이 모두 App의 DI와 연결되어 있다. 상태는 App에 두고 UI는 분리해 기존 테스트 패턴을 유지한다 |
| 순수 탭 유틸 | `src/lib/documentTabs.ts` | 같은 파일 중복 방지, 닫기 후 활성 탭 결정, 경로 배열 병합은 race와 별개인 순수 상태 전이라 단위 테스트로 고정한다 |
| 다중 watcher | Rust `WatcherState`를 `HashMap<String, Debouncer<...>>`로 확장 | 열린 모든 탭의 외부 변경을 반영해야 한다. 기존 단일 watcher는 활성 문서만 감시할 수 있다 |
| watcher 이벤트 | 기존 `"file-watch"` payload `{ path, kind }` 유지 | Tauri 이벤트는 Rust background notification에 맞고, 기존 hook/test 패턴을 재사용한다. 고빈도 스트림이 아니므로 Channel 불필요 |
| watcher 정리 | `stop_watching(path)` 커맨드 추가 | 탭 닫기 시 해당 watcher를 제거한다. 새 커맨드는 `generate_handler!`에 등록한다 |
| 키보드 단축키 | App 레벨 단일 `keydown` listener | 요구 단축키는 앱 내부 동작이다. React best practices에 따라 탭마다 리스너를 만들지 않고 cleanup을 명확히 한다 |
| 탭 조회 | 렌더 순서는 배열, 반복 조회는 `Map`/유틸 | React 렌더 순서가 필요하므로 배열이 기본이다. 경로/id 조회가 반복되는 곳은 `Map`으로 O(1) lookup을 사용한다 |
| 파생 상태 | `activeTab`은 저장하지 않고 렌더 중 계산 | React 지침의 derived state 원칙을 따른다. 상태 drift와 불필요한 effect를 피한다 |

## 4. 데이터 모델

구현은 아래 타입명과 상태 의미를 기준으로 한다. 구현 중 더 작은 내부 타입으로 쪼갤 수는 있지만, 공개 동작과 테스트는 이 모델을 따른다.

```ts
type AppNotice = {
  kind: "read-error" | "file-removed";
  message: string;
};

type DocumentTab = {
  id: string;
  path: string; // startWatching이 반환한 canonical path, 실패 시 요청 path
  title: string; // 파일명 표시용
  content: string;
  notice: AppNotice | null;
  status: "ready" | "deleted";
  openGeneration: number;
  reloadSequence: number;
};

type TabsState = {
  tabs: DocumentTab[];
  activeTabId: string | null;
};
```

편집기 확장 대비는 상태 경계로만 남긴다. 나중에 `status` 또는 별도 필드에 `dirty`, `externalChanged`, `conflict`를 추가할 수 있지만 이번 UI에는 표시하지 않는다.

## 5. 데이터 흐름

### 5.1 파일 열기

```
openPaths(paths)
  → markdown path만 선택
  → 같은 canonical/opened path가 이미 있으면 해당 탭 활성화
  → 새 경로는 readFile(path)
  → 성공 시 startWatching(path)
  → canonical path 기준으로 중복 재확인
  → 탭 추가/교체 후 마지막 성공 탭 활성화
  → 실패 시 현재 탭 유지 + read-error notice 표시
```

초기에는 read 전에 canonical path를 알 수 없다. 따라서 중복 방지는 두 단계로 처리한다.

1. 이미 열린 탭의 `path`와 요청 경로 문자열이 같은 경우 즉시 활성화
2. `startWatching`이 canonical path를 반환한 뒤 같은 canonical path 탭이 있으면 새 탭을 만들지 않고 기존 탭 활성화

### 5.2 링크 클릭

기존 `classifyLink` 흐름은 유지한다.

- external → `openExternal`
- relative markdown → 현재 활성 탭의 디렉터리 기준으로 resolve 후 `openPaths([resolvedPath])`
- relative non-markdown → `openWithOS`
- ignored/anchor → 기존 동작 유지

마크다운 링크는 더 이상 현재 문서를 교체하지 않고 탭을 추가하거나 기존 탭으로 이동한다.

### 5.3 드래그앤드롭 / OS open

기존 단일 문서 정책의 `.at(-1)`를 제거한다.

- 드롭된 경로 중 마크다운 파일을 모두 연다
- OS/Finder/CLI open으로 전달된 경로 중 마크다운 파일을 모두 연다
- 여러 개가 성공하면 마지막 성공 탭을 활성화한다
- 모두 실패하면 기존 상태를 유지하고 마지막 실패 메시지를 배너로 보여준다

### 5.4 Watcher 이벤트

```
file-watch { path, kind }
  → path로 탭 찾기
  → 없으면 이전 watcher 잔여 이벤트로 보고 무시
  → removed: 해당 탭 status="deleted", notice=file-removed, content 유지
  → changed: 해당 탭만 readFile(path)
      성공: content 갱신, notice 해제, status="ready"
      실패: content 유지, notice=read-error
      stale reload: 결과 폐기
```

비활성 탭도 같은 상태 전이를 적용한다. 전역 배너는 활성 탭의 `notice`만 표시한다.

## 6. Race 처리

- 열기 generation은 탭 또는 pending open 단위로 관리한다.
- 늦게 도착한 이전 `readFile`/`startWatching` 결과는 최신 generation이 아니면 폐기한다.
- reload sequence는 탭별로 관리한다.
- `removed` 이벤트는 해당 탭의 reload sequence를 증가시켜 in-flight reload가 삭제 배너를 지우지 못하게 한다.
- 새 탭 추가/닫기/활성화는 functional `setState`로 처리해 stale closure를 피한다.
- App의 stable callback에서 최신 탭 목록이 필요하면 `useRef`를 보조로 사용하되, UI 상태 자체는 React state에 둔다.

## 7. 컴포넌트 / 모듈 구성

| 파일 | 역할 |
|---|---|
| `src/App.tsx` | 탭 상태 소유, 파일 열기/링크/드롭/OS open/watcher/단축키 wiring |
| `src/components/TabBar.tsx` | Radix Tabs 기반 상단 탭 스트립. 파일명, 닫기 버튼, 열기 버튼 렌더 |
| `src/lib/documentTabs.ts` | 탭 중복 방지, 닫기 후 활성 탭 결정, 경로 배열 병합 등 순수 유틸 |
| `src-tauri/src/lib.rs` | 다중 watcher state, `start_watching`, `stop_watching`, 기존 opened file 이벤트 |
| `src/App.css` | 탭 스트립, overflow, 활성/비활성/삭제 상태 스타일 |

`TabBar`는 컴포넌트를 내부 함수로 만들지 않는다. Radix의 `Tabs.Root`는 controlled mode로 사용한다.

```tsx
<Tabs.Root value={activeTabId ?? undefined} onValueChange={onSelectTab}>
  <Tabs.List aria-label="열린 문서">
    ...
  </Tabs.List>
</Tabs.Root>
```

본문은 active tab의 `MarkdownView`만 렌더한다. 모든 탭의 MarkdownView를 숨긴 채 유지하면 mermaid/shiki 비용과 DOM 비용이 커지고, 현재 요구는 읽기 전환이지 백그라운드 렌더 유지가 아니다.

## 8. Tauri 변경

현재 Rust state:

```rust
struct WatcherState(Mutex<Option<Debouncer<RecommendedWatcher, RecommendedCache>>>);
```

변경 방향:

```rust
struct WatcherState(Mutex<HashMap<String, Debouncer<RecommendedWatcher, RecommendedCache>>>);
```

- key는 canonical path string
- `start_watching(app, path)`:
  - canonicalize
  - 부모 디렉터리 watch 시작
  - 같은 canonical key가 있으면 교체
  - canonical path 반환
- `stop_watching(path)`:
  - 가능한 경우 canonicalize, 실패하면 입력 path 그대로 key 시도
  - map에서 제거
  - 제거된 debouncer drop으로 watch 정지

기존 `"file-watch"` 이벤트와 payload는 유지한다. 새 플러그인을 추가하지 않으므로 capability 파일에는 새 권한을 추가하지 않는다. `core:default`로 기존 event listen과 command invoke 흐름을 유지한다.

## 9. 단축키

App에 `keydown` listener를 한 번 등록한다.

- 조건: `event.metaKey && event.shiftKey`
- 이전 탭: `event.key === "["` 또는 `event.code === "BracketLeft"`
- 다음 탭: `event.key === "]"` 또는 `event.code === "BracketRight"`
- 탭이 0~1개면 무시
- 처리 시 `event.preventDefault()`
- cleanup에서 listener 제거

Tauri 메뉴 accelerator는 이번 범위에서 제외한다. 브래킷 accelerator 문자열의 플랫폼 호환성 검증 부담이 있고, 요구사항은 앱 포커스 안의 탭 이동이다.

## 10. 에러 처리

- 새 파일 읽기 실패: 기존 활성 탭 유지, read-error 배너 표시
- 링크로 연 파일 읽기 실패: 기존 탭 유지, read-error 배너 표시
- watcher 시작 실패: 기존 동작처럼 열람은 진행하고 요청 path를 탭 식별자로 사용
- 탭 reload 실패: 해당 탭 content 유지, 해당 탭 notice=read-error
- 탭 삭제 이벤트: content 유지, 해당 탭 notice=file-removed, status=deleted
- 비활성 탭 notice는 탭 선택 시 배너로 보인다
- 닫힌 탭의 늦은 이벤트/읽기 결과는 무시한다

## 11. 테스트 계획

### TDD

- `src/lib/documentTabs.spec.ts`
  - 같은 path/canonical path 중복 방지
  - 여러 경로 추가 시 순서 유지와 마지막 활성화
  - 탭 닫기 후 다음 활성 탭 결정
  - 마지막 탭 닫기 시 `activeTabId: null`
- `src/components/TabBar.spec.tsx`
  - 탭 목록 렌더
  - 클릭 전환 콜백
  - 닫기 버튼 콜백
  - 열기 버튼 콜백
  - role 기반 접근성(`tablist`, `tab`, selected 상태)
- `src/App.spec.tsx`
  - 파일 열기 → 탭 생성
  - 마크다운 링크 클릭 → 새 탭 활성화
  - 같은 파일 다시 열기 → 기존 탭 활성화, read 중복 최소화
  - 드롭/OS open 여러 파일 → 모두 탭 생성, 마지막 활성화
  - 탭 닫기 → `stopWatching` 호출
  - 마지막 탭 닫기 → 빈 상태
  - 비활성 탭 changed → 탭 content 갱신 후 선택 시 최신 내용
  - 비활성 탭 removed → 선택 시 삭제 배너
  - stale open/reload 결과 폐기
  - `Cmd+Shift+[` / `Cmd+Shift+]` 순환 전환

### 수동 검증

- `pnpm tauri dev`
- 여러 파일을 메뉴/버튼으로 열고 탭 전환
- 드래그앤드롭 여러 파일 → 모두 탭 생성
- Finder/CLI open 여러 파일 → 모두 탭 생성
- 마크다운 링크 클릭 → 새 탭 또는 기존 탭 활성화
- 비활성 탭 파일 저장/삭제 후 해당 탭 선택
- 탭 닫기 후 이전 파일 저장 이벤트가 더 이상 반영되지 않음
- `Cmd+Shift+[` / `Cmd+Shift+]` 순환
- `pnpm test`
- `pnpm typecheck`
- `pnpm build`

## 12. 트레이드오프 / 리스크

- **Radix 의존성 추가**: 탭 하나 때문에 dependency가 늘지만, ARIA와 키보드 동작을 직접 구현하는 위험을 줄인다.
- **다중 watcher 비용**: 열린 탭 수만큼 watcher가 생긴다. 개인 마크다운 뷰어의 일반 탭 수에서는 수용 가능하다. 대량 탭 제한/경고는 비목표다.
- **canonical 중복 방지의 두 단계성**: read 전에는 canonical path를 모른다. startWatching 후 재확인으로 중복 탭을 막는다.
- **비활성 탭 자동 reload**: 읽기 전용이므로 안전하다. 편집 기능이 생기면 dirty/conflict 상태에서 자동 overwrite를 막는 정책을 추가해야 한다.
- **본문 한 개만 렌더**: 탭 전환 시 MarkdownView가 다시 렌더될 수 있다. 비용이 문제가 되면 React Activity/keep-alive류를 별도 스펙에서 검토한다.
- **OS open 중복 전달**: 콜드 스타트 pull과 runtime emit이 같은 파일을 중복 전달할 수 있다. 같은 파일 기존 탭 활성화 정책으로 최종 상태는 멱등이어야 한다.
