# 파일 watcher (저장 시 자동 리렌더) 설계 — 로드맵 4번

- 날짜: 2026-06-12
- 상태: 승인됨 (구현 계획 작성 전)
- 진행 위치: `worktree-file-open-rendering` 브랜치에 스택 (2+3번 위, 5번보다 먼저 — dev에서 테스트 가능하므로)
- 검증: notify 크레이트 생태계·atomic save 동작·Tauri 이벤트·교차검증을 다중 에이전트로 공식 문서/소스 레벨 확인 완료(2026-06-12). 관련 스펙: [2026-06-10-file-open-rendering-design.md](2026-06-10-file-open-rendering-design.md), [2026-06-12-os-file-open-design.md](2026-06-12-os-file-open-design.md)

열려 있는 마크다운 파일이 저장되면 자동으로 다시 읽어 리렌더한다.

## 1. 목표 / 비목표

### 목표

- 열린 파일 저장 → 자동 재읽기·리렌더 (디바운스 300ms)
- 파일 삭제/이동 → **내용 유지 + 배너** (사용자 결정), 같은 경로에 재생성되면 배너 해제 + 재읽기
- 새 파일 열기 → 이전 watch 자동 교체
- scope 기계장치 금지 결정 유지 (plugin-fs 미사용)

### 비목표

- 부모 디렉터리 자체의 삭제/이동 감지 (watcher가 조용히 죽음 — 개인 뷰어 기준 수용, 문서화된 한계)
- watcher 비정상 종료 감지/재시작
- Rust 측 단위 테스트 (기존 결정 유지 — 수동 검증)
- async 하이라이터 전환 (큰 문서에서 재하이라이팅이 느리면 그때 별도 작업 — §5)

## 2. 결정 사항과 근거

| 결정 | 선택 | 근거 |
|---|---|---|
| watch 구현 | **커스텀 Rust + `notify-debouncer-full = "0.7"`** (notify 8.2 재export, macOS FSEvents 백엔드 기본 활성) | scope 없는 커스텀 커맨드 철학 유지. 대안 기각: plugin-fs watch는 `fs:allow-watch` + 임의 경로 scope 필요(회귀), 폴링은 배터리/지연 열세. debouncer-mini는 EventKind를 버려서 부적합 |
| watch 대상 | **부모 디렉터리** NonRecursive + 파일명 필터 + `exists()` stat 판정 | 에디터 atomic save(임시파일+rename, TextEdit/vim 등)가 단일 파일 watch를 죽이는 표준 함정. EventKind 분기는 에디터별로 달라 신뢰 불가(notify 공식 경고) — stat이 정답. 파일이 지워져도 watch 생존, 재생성 감지 |
| 디바운스 | 300ms (tick = timeout/4 기본) | notify의 FSEvents 스트림은 latency 0 + NoDefer라 커널 측 병합 없음 — 디바운서가 유일한 디바운스. 100ms는 멀티스텝 저장이 두 번 렌더될 수 있고 500ms는 체감 지연 |
| 이벤트 형태 | 단일 `"file-watch"` 이벤트, payload `{ path: string, kind: "changed" \| "removed" }` (camelCase) | 프론트 구독 1개로 충분. path는 교체 직후 이전 watcher의 잔여 이벤트(최대 1틱) 및 5번의 문서 교체 필터링에 사용 |
| **경로 정체성** | `start_watching`이 **canonical 경로를 반환**, App이 그것을 `openedDocument.path`로 저장 | FSEvents가 경로를 canonicalize(`/tmp`→`/private/tmp`)하므로 원래 경로와 문자열 비교하면 이벤트가 전부 버려짐(교차검증에서 발견). canonical 경로 = 문서의 단일 식별자 |
| watcher 수명 | `Mutex<Option<Debouncer<RecommendedWatcher, RecommendedCache>>>` managed state, 새 파일 열면 `Some(new)`로 교체 | Debouncer는 drop 가드(drop 시 정지, non-blocking). 교체가 곧 정지+시작 |
| 호출 순서 | **`readFile` 성공 후에만 `startWatching`** | 실패 시에도 교체하면 A 문서를 보면서 B를 watch하는 버그(기존 문서 유지 정책과 충돌) |
| 재읽기 race | 세대(generation) 카운터 — 문서 열기/재읽기마다 증가, 늦게 resolve된 이전 세대 읽기는 무시 | 연속 저장 시 읽기 #1이 #2보다 늦게 도착하면 stale 내용 렌더 방지 |
| Shiki 비용 | 재읽은 내용이 기존과 같으면 **문서 setState만** 생략 (동일성 단락 — notice 해제는 항상 수행) | atomic save의 중복 이벤트 흡수 + 불필요한 동기 재하이라이팅 회피. notice까지 건너뛰면 삭제→동일 내용 재생성 시 배너가 안 사라짐. 추가 완화는 §5 |
| 상태 모델 | `errorMessage: string` → **`notice: { kind: "read-error" \| "file-removed", message: string } \| null`** | "읽기 실패(문서 유지)"와 "파일 삭제됨(문서 유지)"의 전이를 구분해 테스트로 고정. 배너 UI는 동일 |
| 권한 | 변경 없음 | Rust emit → JS listen은 기존 `core:default`(`core:event:allow-listen` 포함)로 충분(검증) |

## 3. 설계

### 3.1 데이터 흐름

```
openPath(path) ── readFile 성공 ──> setOpenedDocument + generation++ ──> startWatching({path})
                                                                          └─> canonical 경로 반환 → openedDocument.path 갱신
Rust: 부모 디렉터리 watch ── 파일명 매칭 이벤트 ── stat ──┬─ exists  → emit "file-watch" {path, kind:"changed"}
                                                          └─ !exists → emit "file-watch" {path, kind:"removed"}
프론트: payload.path === 현재 문서 canonical path 인가? ── 아니면 무시
  changed → readFile 재실행(현재 세대 캡처, stale이면 결과 폐기) ──┬─ 성공·내용 동일 → 문서 setState만 생략, **notice는 해제** (삭제→같은 내용 재생성 시 배너가 남는 것 방지)
                                                                    ├─ 성공·내용 다름 → setOpenedDocument + notice 해제
                                                                    └─ 실패 → notice{read-error} + 내용 유지
  removed → notice{file-removed} + 내용 유지 (재생성되면 changed가 와서 해제)
```

### 3.2 모듈 구성

| 파일 | 역할 | DI |
|---|---|---|
| `src-tauri/src/lib.rs` (수정) | `start_watching(path)` 커맨드: canonicalize → 부모 디렉터리 watch 시작(기존 watcher 교체) → canonical 경로 반환. 콜백(디바운서 스레드)에서 cloned AppHandle로 emit | — |
| `src/hooks/useFileWatch.ts` (신규) | `"file-watch"` 구독 hook — useFileDrop과 동일 패턴(subscribe DI, unmount 시 unlisten) | `subscribe` 기본값 = `listen("file-watch")` 래퍼 |
| `src/App.tsx` (수정) | `startWatching` DI prop 추가, openPath에 세대 카운터·동일성 단락·notice 전이, 현재 canonical 경로는 ref로 유지(stable 콜백에서 비교) | `startWatching?: (args: { path: string }) => Promise<string>`, `subscribeFileWatch?` (hook에 전달) |

onEvent 콜백은 stable해야 하므로(재구독 race — useFileDrop 동일 경고) 현재 문서 경로를 `useRef`로 들고 stable `useCallback`에서 ref를 읽는다.

### 3.3 Rust 커맨드 형태 (개요)

```rust
struct WatcherState(Mutex<Option<Debouncer<RecommendedWatcher, RecommendedCache>>>);

#[tauri::command]
fn start_watching(app: tauri::AppHandle, path: String) -> Result<String, String>
// canonicalize → 부모 dir new_debouncer(300ms) watch → state 교체 → canonical 경로 반환
// 콜백: 이벤트 paths 중 file_name == 대상 파일명 인 것만 → target.exists() stat → emit
```

`.watch()/.unwatch()`는 0.7에서 Debouncer에 직접 호출(`.watcher()` deprecated). 디바운서 에러 콜백은 무시(워처 사망 감지는 비목표).

## 4. 검증 기준

**TDD (모킹 없이 DI fake):**

| spec | 케이스 |
|---|---|
| `useFileWatch.spec.tsx` (jsdom) | fake subscribe로: 이벤트 전달 / unmount 시 unlisten (useFileDrop spec과 동일 구조) |
| `App.spec.tsx` 추가 (jsdom) | changed → 재읽기·리렌더 / removed → 배너 + 내용 유지 / removed 후 changed → 배너 해제 + 재읽기 / **다른 경로 이벤트 무시** / **세대 race: 느린 이전 읽기가 새 내용을 덮지 않음**(fake readFile의 지연 promise로 재현) / **removed 후 동일 내용으로 재생성 → 배너 해제**(동일성 단락이 notice 해제를 막지 않음을 고정) / 읽기 실패 시 read-error notice + 내용 유지 / **readFile 실패 시 startWatching 미호출** |
| 기존 spec 갱신 | notice 모델 교체에 따른 기존 에러 배너 테스트 수정 (role="alert" 유지) |

**수동 (`pnpm tauri dev`로 가능):** vim·VS Code·TextEdit(atomic save)에서 저장 → 자동 갱신, 파일 삭제 → 배너+내용 유지, 같은 이름 재생성 → 복구, 다른 파일 열기 → 이전 파일 저장해도 무반응.

## 5. 트레이드오프 / 리스크

- **동기 Shiki 재하이라이팅이 저장마다 실행** — 300ms 디바운스 + 동일성 단락으로 빈도를 줄였고, 그래도 큰 문서에서 느리면 정도(正道)는 async 하이라이터 전환(이번 범위 밖, 필요해지면 별도 스펙). `startTransition` 래핑은 그때 함께 검토
- 교체 직후 이전 디바운서의 잔여 이벤트가 최대 1틱(~75ms) 도착 가능 → 경로 필터가 흡수
- 부모 디렉터리 삭제/이동 시 watcher가 조용히 죽음 — 문서화된 비목표
- 디바운서 에러 무시로 "watcher 죽음 = 변경 없음"과 구분 불가 — 동일하게 수용
