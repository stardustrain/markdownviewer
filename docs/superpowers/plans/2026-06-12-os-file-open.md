# OS 파일 열기 (Finder 더블클릭 + CLI open) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finder 더블클릭("다음으로 열기")과 `open -a markdownviewer A.md`로 파일을 열 수 있게 한다 (콜드 스타트 + 실행 중, 현재 문서 교체).

**Architecture:** `bundle.fileAssociations`로 md/markdown/mdx를 선언(Viewer)하고, lib.rs를 `.build().run(클로저)`로 재구성해 `RunEvent::Opened`를 처리 — 경로를 버퍼에 적재 + `"opened"` emit + 창 복구. 콜드 스타트는 Opened가 웹뷰 로드 전에 발생하므로 프론트가 마운트 시 `opened_files` 커맨드(drain)로 1회 pull. 여러 파일은 마지막 것만(last-wins). 열기는 기존 `openPath` 재사용(watcher 자동 전환).

**Tech Stack:** Tauri 2 RunEvent::Opened / fileAssociations, React 19 + vitest (DI, 모킹 금지).

**Spec:** `docs/superpowers/specs/2026-06-12-os-file-open-design.md`

**전제:** 플랜 `2026-06-12-file-watcher.md` 완료 상태(App.tsx에 notice/openPath 세대 카운터 존재). 컨벤션은 해당 플랜과 동일 (code-style/test-code-style, TDD RED 증거, pnpm, 워크트리 `/Users/lucas.han/workspace/markdownviewer/.claude/worktrees/file-open-rendering`, `cargo`는 `~/.cargo/bin/cargo`).

---

## File Structure

| 동작 | 파일 | 책임 |
|---|---|---|
| 수정 | `src-tauri/tauri.conf.json` | `bundle.fileAssociations` 추가 |
| 수정 | `src-tauri/src/lib.rs` | `.build().run(클로저)` 재구성, `OpenedFiles` 버퍼, `opened_files` 커맨드(drain), Opened 핸들러 (TDD 예외 — Rust) |
| 수정 | `src/App.tsx` + `App.spec.tsx` | `fetchOpenedFiles`/`subscribeOpened` DI + last-wins 열기 |

---

### Task 1: fileAssociations + RunEvent::Opened (TDD 예외 — Rust)

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: tauri.conf.json** — `"bundle"` 객체에 `fileAssociations` 추가 (기존 키들 유지):

```json
  "bundle": {
    "active": true,
    "targets": ["app", "dmg"],
    "fileAssociations": [
      {
        "ext": ["md", "markdown", "mdx"],
        "name": "Markdown",
        "role": "Viewer"
      }
    ],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
```

> `role` 기본값이 Editor라 Viewer 명시. **`mimeType`/`exportedType`은 추가 금지** — mimeType은 LSItemContentTypes를 주입해 macOS가 확장자 매칭을 무시하게 만들고(plain-text 전체 클레임 사고), exportedType은 시스템이 이미 선언한 `net.daringfireball.markdown` UTI의 소유권을 클레임함 (스펙 §2).

- [ ] **Step 2: lib.rs 재구성** — `run()` 함수와 import를 수정하고 `OpenedFiles`/`opened_files`를 추가한다. `read_file`/`start_watching`/`WatcherState`/`FileWatchPayload`는 watcher 플랜 그대로 유지. 변경/추가분:

import 줄은 다음을 갖추면 된다(기존과 병합):

```rust
use std::sync::Mutex;
use std::time::Duration;

use notify_debouncer_full::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{
    new_debouncer, DebounceEventResult, Debouncer, RecommendedCache,
};
use serde::Serialize;
use tauri::{Emitter, Manager};
```

추가할 state/커맨드:

```rust
/// 웹뷰가 뜨기 전(콜드 스타트)에 도착한 파일 경로 버퍼.
/// 읽을 때 비운다(drain) — 웹뷰 리로드 시 이전 파일 재전달·무한 증식 방지 (스펙 §2)
struct OpenedFiles(Mutex<Vec<String>>);

#[tauri::command]
fn opened_files(app: tauri::AppHandle) -> Vec<String> {
    std::mem::take(&mut *app.state::<OpenedFiles>().0.lock().unwrap())
}
```

`run()`을 다음으로 교체 (`.run(generate_context!())` → `.build(...).run(클로저)` — RunEvent 관찰은 클로저 형태만 가능):

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(WatcherState(Mutex::new(None)))
        .manage(OpenedFiles(Mutex::new(Vec::new())))
        .invoke_handler(tauri::generate_handler![
            read_file,
            start_watching,
            opened_files
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // RunEvent는 #[non_exhaustive] — if let으로 Opened만 처리
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                // file:// URL → 경로 (to_file_path가 percent-decode — 한글/공백 OK).
                // filter_map은 비파일(deep link) URL 방어 (스펙 §2)
                let files: Vec<String> = urls
                    .into_iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .map(|path| path.to_string_lossy().into_owned())
                    .collect();
                if files.is_empty() {
                    return;
                }
                app.state::<OpenedFiles>()
                    .0
                    .lock()
                    .unwrap()
                    .extend(files.clone());
                // 실행 중인 경우 즉시 반영 — 콜드 스타트에선 웹뷰 로드 전이라 유실되므로
                // 버퍼 + opened_files pull이 본선 (스펙 §2)
                let _ = app.emit("opened", files);
                // macOS가 앱은 자동 활성화하지만 최소화 창은 복구 안 함 — 방어적 복구
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        });
}
```

- [ ] **Step 3: 컴파일 확인** — Run: `cargo check --manifest-path src-tauri/Cargo.toml` → exit 0.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/src/lib.rs
git commit -m "feat: declare markdown file associations and handle RunEvent::Opened"
```

---

### Task 2: App 연동 (TDD)

**Files:**
- Modify: `src/App.spec.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1 (RED):** `src/App.spec.tsx` 수정.

(a) `createFakeDeps`에 OS-open fake 추가. `CreateFakeDepsParams`에 필드 추가:

```tsx
  /** 콜드 스타트 버퍼 — fake fetchOpenedFiles가 한 번 읽고 비운다(drain 의미론) */
  osOpenedPaths?: string[];
```

함수 본문에 추가 (기존 필드 유지, `props`에 두 항목 추가):

```tsx
  const remainingOsOpened = [...osOpenedPaths];
  let openedHandler: ((args: { paths: string[] }) => void) | null = null;
```

```tsx
    fetchOpenedFiles: () => {
      const drained = [...remainingOsOpened];
      remainingOsOpened.length = 0;
      return Promise.resolve(drained);
    },
    subscribeOpened: ({
      onOpen,
    }: {
      onOpen: (args: { paths: string[] }) => void;
    }) => {
      openedHandler = onOpen;
      return Promise.resolve(() => {
        openedHandler = null;
      });
    },
```

반환 객체에 추가:

```tsx
    emitOpened: (paths: string[]) => {
      openedHandler?.({ paths });
    },
```

(`osOpenedPaths = []` 기본값을 구조분해에 추가.)

(b) 최상위 `describe("App")` 안에 새 context 추가:

```tsx
  context("OS가 파일 열기를 전달한 경우", () => {
    test("콜드 스타트 버퍼의 마지막 파일을 엽니다.", async () => {
      const fakeDeps = createFakeDeps({
        files: { "/tmp/b.md": "# 마지막 파일" },
        osOpenedPaths: ["/tmp/a.md", "/tmp/b.md"],
      });
      render(<App {...fakeDeps.props} />);

      expect(
        await screen.findByRole("heading", { name: "마지막 파일" }),
      ).toBeInTheDocument();
      expect(fakeDeps.readPaths).toEqual(["/tmp/b.md"]);
    });

    test("콜드 스타트 버퍼가 비어 있으면 아무것도 하지 않습니다.", async () => {
      const fakeDeps = createFakeDeps({});
      render(<App {...fakeDeps.props} />);
      await act(async () => {});

      expect(fakeDeps.readPaths).toHaveLength(0);
      expect(
        screen.getByRole("button", { name: /파일 열기/ }),
      ).toBeInTheDocument();
    });

    test("실행 중 전달되면 현재 문서를 교체합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/old.md"],
        files: { "/tmp/old.md": "# 이전 문서", "/tmp/new.md": "# 새 문서" },
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("heading", { name: "이전 문서" });

      act(() => {
        fakeDeps.emitOpened(["/tmp/new.md"]);
      });

      expect(
        await screen.findByRole("heading", { name: "새 문서" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "이전 문서" }),
      ).not.toBeInTheDocument();
    });

    test("pull과 emit으로 같은 파일이 중복 전달되어도 최종 상태는 같습니다.", async () => {
      const fakeDeps = createFakeDeps({
        files: { "/tmp/a.md": "# 같은 문서" },
        osOpenedPaths: ["/tmp/a.md"],
      });
      render(<App {...fakeDeps.props} />);
      await screen.findByRole("heading", { name: "같은 문서" });

      act(() => {
        fakeDeps.emitOpened(["/tmp/a.md"]);
      });
      await act(async () => {});

      expect(
        screen.getByRole("heading", { name: "같은 문서" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });
```

- [ ] **Step 2: FAIL 확인** — App에 `fetchOpenedFiles`/`subscribeOpened` prop이 없어 tsc 에러 및/또는 새 테스트 실패. 기록.

- [ ] **Step 3 (GREEN):** `src/App.tsx` 수정.

import에 `listen` 추가:

```tsx
import { listen } from "@tauri-apps/api/event";
```

`AppProps`에 추가:

```tsx
  /** 콜드 스타트에 OS가 전달한 파일 경로 버퍼를 1회 pull (Rust가 drain)
   * @default invoke("opened_files")
   */
  fetchOpenedFiles?: () => Promise<string[]>;
  /** 실행 중 OS 파일 열기("opened" 이벤트) 구독
   * @default Tauri listen("opened")
   */
  subscribeOpened?: (args: {
    onOpen: (args: { paths: string[] }) => void;
  }) => Promise<() => void>;
```

구조분해에 추가:

```tsx
  fetchOpenedFiles = fetchOpenedFilesFromOS,
  subscribeOpened = subscribeToOpenedFiles,
```

`useFileWatch({...})` 호출 아래에 추가:

```tsx
  // 단일 문서 정책: 여러 파일이 와도 마지막 것만 연다 (스펙 §2)
  const openLastOf = useCallback(
    ({ paths }: { paths: string[] }) => {
      const path = paths.at(-1);
      if (path === undefined) {
        return;
      }
      void openPath({ path });
    },
    [openPath],
  );

  // 콜드 스타트: Opened가 웹뷰 로드 전에 발생하므로 버퍼를 1회 pull (스펙 §3.1)
  // Rust가 drain하므로(StrictMode 이중 실행 시 두 번째 pull은 빈 배열) 중복 열기 없음
  useEffect(() => {
    void fetchOpenedFiles().then((paths) => {
      openLastOf({ paths });
    });
  }, [fetchOpenedFiles, openLastOf]);

  // 실행 중: "opened" 이벤트 구독 (cleanup 패턴은 useFileWatch/useFileDrop과 동일)
  useEffect(() => {
    const unlistenPromise = subscribeOpened({ onOpen: openLastOf });
    return () => {
      unlistenPromise.then((unlisten) => {
        unlisten();
      });
    };
  }, [subscribeOpened, openLastOf]);
```

하단 private 함수에 추가:

```tsx
function fetchOpenedFilesFromOS(): Promise<string[]> {
  return invoke<string[]>("opened_files");
}

function subscribeToOpenedFiles({
  onOpen,
}: {
  onOpen: (args: { paths: string[] }) => void;
}): Promise<() => void> {
  return listen<string[]>("opened", (event) => {
    onOpen({ paths: event.payload });
  });
}
```

- [ ] **Step 4: PASS 확인** — Run: `pnpm test src/App.spec.tsx` → 기존 + 신규 4 green.

- [ ] **Step 5: 전체 검증** — Run: `pnpm test && pnpm exec tsc --noEmit && pnpm coverage && pnpm build` → 전부 exit 0. 기대 테스트 수 **51** (47 + 4). App.tsx 브랜치 커버리지 100% 유지 (`paths.at(-1) === undefined` 분기는 빈 배열 테스트가 커버).

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.spec.tsx
git commit -m "feat: open files delivered by the OS on cold start and at runtime"
```

---

### Task 3: 번들 수동 검증 (스펙 §4 — `tauri dev`로 불가)

- [ ] **Step 1: 디버그 번들 빌드** — Run: `pnpm tauri build --debug --bundles app` → `src-tauri/target/debug/bundle/macos/markdownviewer.app` 생성.

- [ ] **Step 2: 체크리스트** (등록: 번들 1회 실행 또는 /Applications 복사; 이름 해석이 꼬이면 번들 경로로 `open -a <경로>`):

- [ ] 콜드 스타트: 앱 종료 상태에서 `open -a markdownviewer /tmp/markdownviewer-fixture.md` → 앱 실행 + 문서 렌더
- [ ] 실행 중: 다른 .md를 `open -a` → 현재 창에서 교체 + 창 전면
- [ ] Finder "다음으로 열기 → markdownviewer"
- [ ] 한글·공백 파일명 (`/tmp/한글 파일.md` 생성해 확인)
- [ ] 멀티 선택 열기 → 마지막 파일만
- [ ] 열린 뒤 에디터로 저장 → watcher 자동 갱신 (4번과 통합 동작)
- [ ] (한계 확인) `xattr -w com.apple.quarantine "0081;;;" /tmp/q.md` 후 **앱 실행 중** 더블클릭 → 무시되는 것이 정상 (tao#1206, 콜드 스타트는 정상이어야 함)
