# 파일 watcher (저장 시 자동 리렌더) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 열려 있는 마크다운 파일이 저장되면 자동으로 재읽기·리렌더하고, 삭제되면 내용 유지 + 배너를 띄운다.

**Architecture:** Rust `start_watching` 커맨드가 대상 파일의 **부모 디렉터리**를 `notify-debouncer-full`(300ms)로 watch하고(에디터 atomic save 대응), 파일명 매칭 + stat으로 `"file-watch"` 이벤트 `{ path, kind: "changed"|"removed" }`를 emit. 커맨드는 **canonical 경로를 반환**하고 App이 그것을 문서 식별자로 저장해 이벤트를 필터링한다. 프론트는 세대 카운터로 늦게 도착한 이전 읽기를 폐기하고, 동일 내용이면 문서 setState만 생략(notice 해제는 항상). `errorMessage`는 `notice { kind: "read-error"|"file-removed" }`로 교체.

**Tech Stack:** notify-debouncer-full 0.7 (notify 8.2 재export, FSEvents), Tauri 2 emit/listen, React 19 + vitest 4.1/RTL (DI, 모킹 금지).

**Spec:** `docs/superpowers/specs/2026-06-12-file-watcher-design.md`

**컨벤션 (모든 태스크 공통):** 2026-06-10 플랜과 동일 — `.claude/skills/code-style/SKILL.md` + `.claude/skills/test-code-style/SKILL.md` 준수, TDD(RED 증거 필수, 즉시 통과하는 테스트는 구현을 임시로 깨서 올바른 이유로 실패하는지 확인 후 복원), pnpm 전용, 워크트리 `/Users/lucas.han/workspace/markdownviewer/.claude/worktrees/file-open-rendering`에서 작업, 브랜치 `worktree-file-open-rendering`에 직접 커밋. `cargo`는 `~/.cargo/bin/cargo`.

---

## File Structure

| 동작 | 파일 | 책임 |
|---|---|---|
| 수정 | `src-tauri/Cargo.toml` | `notify-debouncer-full = "0.7"` 추가 |
| 수정 | `src-tauri/src/lib.rs` | `start_watching` 커맨드 + `WatcherState` (TDD 예외 — Rust) |
| 생성 | `src/hooks/useFileWatch.ts` + `useFileWatch.spec.tsx` | `"file-watch"` 구독 hook (subscribe DI, useFileDrop과 동일 패턴) |
| 수정 | `src/App.tsx` + `App.spec.tsx` | notice 모델, openPath 세대 카운터·watch 연동, reload, 이벤트 필터 |

---

### Task 1: Rust `start_watching` (TDD 예외 — 스펙 비목표: Rust 테스트 없음)

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Cargo.toml 의존성 추가** — `[dependencies]`에 한 줄 추가:

```toml
notify-debouncer-full = "0.7"
```

(notify 8.2를 재export하며 macOS FSEvents 백엔드가 기본 활성 — 추가 feature 불필요. notify 9.x RC는 사용 금지.)

- [ ] **Step 2: lib.rs 수정** — 전체를 다음으로 교체 (기존 `read_file`/플러그인/빌더는 그대로, watcher만 추가):

```rust
use std::sync::Mutex;
use std::time::Duration;

use notify_debouncer_full::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{
    new_debouncer, DebounceEventResult, Debouncer, RecommendedCache,
};
use serde::Serialize;
use tauri::{Emitter, Manager};

struct WatcherState(Mutex<Option<Debouncer<RecommendedWatcher, RecommendedCache>>>);

#[derive(Clone, Serialize)]
struct FileWatchPayload {
    path: String,
    kind: &'static str, // "changed" | "removed"
}

#[tauri::command]
async fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|err| err.to_string())
}

#[tauri::command]
fn start_watching(app: tauri::AppHandle, path: String) -> Result<String, String> {
    // FSEvents가 경로를 canonicalize하므로(/tmp -> /private/tmp) 처음부터 canonical을
    // 문서 식별자로 쓴다 — 반환값을 프론트가 저장해 이벤트 필터에 사용 (스펙 §2)
    let canonical = std::fs::canonicalize(&path).map_err(|err| err.to_string())?;
    let parent = canonical
        .parent()
        .ok_or_else(|| "감시할 부모 디렉터리가 없습니다".to_string())?
        .to_path_buf();
    let file_name = canonical
        .file_name()
        .ok_or_else(|| "파일 이름이 없습니다".to_string())?
        .to_os_string();

    let emit_path = canonical.to_string_lossy().into_owned();
    let target = canonical.clone();
    let handle = app.clone();

    let mut debouncer = new_debouncer(
        Duration::from_millis(300),
        None, // tick = timeout/4
        move |result: DebounceEventResult| {
            let Ok(events) = result else {
                return; // watcher 사망 감지는 비목표 (스펙 §5)
            };
            let touches_target = events
                .iter()
                .flat_map(|event| event.paths.iter())
                .any(|event_path| event_path.file_name() == Some(file_name.as_os_str()));
            if !touches_target {
                return;
            }
            // EventKind 분기 대신 stat — 에디터별 atomic save 편차 회피 (스펙 §2)
            let kind = if target.exists() { "changed" } else { "removed" };
            let _ = handle.emit(
                "file-watch",
                FileWatchPayload {
                    path: emit_path.clone(),
                    kind,
                },
            );
        },
    )
    .map_err(|err| err.to_string())?;

    // 파일이 아닌 부모 디렉터리를 watch — 파일이 지워져도 watch가 살아 재생성을 감지 (스펙 §2)
    debouncer
        .watch(&parent, RecursiveMode::NonRecursive)
        .map_err(|err| err.to_string())?;

    // 교체 = 이전 Debouncer drop = 정지 (drop 가드, non-blocking)
    *app.state::<WatcherState>().0.lock().unwrap() = Some(debouncer);

    Ok(emit_path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(WatcherState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![read_file, start_watching])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

> 타입/시그니처가 0.7 실제 API와 다르면(`new_debouncer` 인자, `Debouncer` 제네릭, `.watch()` 위치) docs.rs/notify-debouncer-full 0.7.0을 확인해 맞추고 보고서에 기록 — 임의 변형 금지.

- [ ] **Step 3: 컴파일 확인** — Run: `cargo check --manifest-path src-tauri/Cargo.toml` → exit 0 (notify 계열 크레이트 다운로드+컴파일).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs
git commit -m "feat: add start_watching command with parent-dir debounced watcher"
```

---

### Task 2: `useFileWatch` (TDD)

**Files:**
- Test: `src/hooks/useFileWatch.spec.tsx` (jsdom)
- Create: `src/hooks/useFileWatch.ts`

- [ ] **Step 1 (RED):** `src/hooks/useFileWatch.spec.tsx` 생성:

```tsx
import { act, renderHook } from "@testing-library/react";
import {
  type FileWatchPayload,
  type FileWatchSubscriber,
  useFileWatch,
} from "./useFileWatch";

const context = describe;

describe("useFileWatch", () => {
  context("file-watch 이벤트가 온 경우", () => {
    test("onEvent에 payload를 그대로 전달합니다.", () => {
      const fakeSubscriber = createFakeFileWatchSubscriber();
      const receivedPayloads: FileWatchPayload[] = [];
      renderHook(() =>
        useFileWatch({
          onEvent: (payload) => {
            receivedPayloads.push(payload);
          },
          subscribe: fakeSubscriber.subscribe,
        }),
      );

      act(() => {
        fakeSubscriber.emit({ path: "/private/tmp/note.md", kind: "changed" });
      });

      expect(receivedPayloads).toEqual([
        { path: "/private/tmp/note.md", kind: "changed" },
      ]);
    });
  });

  context("hook이 unmount되는 경우", () => {
    test("구독 해제 함수(unlisten)를 호출합니다.", async () => {
      const fakeSubscriber = createFakeFileWatchSubscriber();
      const { unmount } = renderHook(() =>
        useFileWatch({ onEvent: noopEvent, subscribe: fakeSubscriber.subscribe }),
      );

      unmount();
      await act(async () => {});

      expect(fakeSubscriber.getUnlistenCount()).toBe(1);
    });
  });
});

function noopEvent() {
  // 이벤트를 검증하지 않는 테스트용 no-op
}

function createFakeFileWatchSubscriber() {
  let registeredHandler: ((payload: FileWatchPayload) => void) | null = null;
  let unlistenCount = 0;
  const subscribe: FileWatchSubscriber = ({ onEvent }) => {
    registeredHandler = onEvent;
    return Promise.resolve(() => {
      unlistenCount += 1;
    });
  };
  return {
    subscribe,
    emit: (payload: FileWatchPayload) => {
      registeredHandler?.(payload);
    },
    getUnlistenCount: () => unlistenCount,
  };
}
```

- [ ] **Step 2: FAIL 확인** — Run: `pnpm test src/hooks/useFileWatch.spec.tsx` → 모듈 미존재 에러.

- [ ] **Step 3 (GREEN):** `src/hooks/useFileWatch.ts` 생성:

```typescript
/**
 * @fileoverview Rust watcher가 emit하는 "file-watch" 이벤트를 구독하는 hook입니다.
 * payload.path는 canonical 경로(start_watching 반환값과 동일) — 호출자(App)가 현재 문서
 * 경로와 비교해 필터링합니다(이전 watcher의 잔여 이벤트·다른 문서 이벤트 무시).
 * subscribe DI는 useFileDrop과 동일 패턴: 기본값은 Tauri listen, 테스트는 fake 주입(모킹 금지).
 * 주의: onEvent/subscribe 참조는 안정적이어야 한다(불안정하면 재구독 race).
 */
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

export type FileWatchPayload = {
  path: string;
  kind: "changed" | "removed";
};

export type FileWatchSubscriber = (args: {
  onEvent: (payload: FileWatchPayload) => void;
}) => Promise<() => void>;

type UseFileWatchParams = {
  /** "file-watch" payload를 받는다 — 필터링은 호출자 책임 */
  onEvent: (payload: FileWatchPayload) => void;
  /** 이벤트 구독 함수
   * @default Tauri listen("file-watch")
   */
  subscribe?: FileWatchSubscriber;
};

export function useFileWatch({
  onEvent,
  subscribe = subscribeToFileWatch,
}: UseFileWatchParams): void {
  useEffect(() => {
    const unlistenPromise = subscribe({ onEvent });
    return () => {
      unlistenPromise.then((unlisten) => {
        unlisten();
      });
    };
  }, [onEvent, subscribe]);
}

function subscribeToFileWatch({
  onEvent,
}: {
  onEvent: (payload: FileWatchPayload) => void;
}): Promise<() => void> {
  return listen<FileWatchPayload>("file-watch", (event) => {
    onEvent(event.payload);
  });
}
```

- [ ] **Step 4: PASS 확인** — Run: `pnpm test src/hooks/useFileWatch.spec.tsx` → 2 green.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useFileWatch.ts src/hooks/useFileWatch.spec.tsx
git commit -m "feat: add useFileWatch hook with injectable subscriber"
```

---

### Task 3: App 통합 (TDD — 3 사이클)

**Files:**
- Modify: `src/App.spec.tsx`
- Modify: `src/App.tsx`

Run/Expected는 모든 사이클 동일: `pnpm test src/App.spec.tsx`

#### 사이클 A — fake 인프라 + 기본 watcher 동작

- [ ] **Step 1 (RED):** `src/App.spec.tsx` 수정.

(a) import에 `type FileWatchPayload` 추가:

```tsx
import { type FileWatchPayload } from "./hooks/useFileWatch";
```

(b) `createFakeDeps`를 다음으로 전체 교체 (watch fake + 파일 내용 변경 헬퍼 + 지연 읽기 추가 — 기존 필드는 유지):

```tsx
type CreateFakeDepsParams = {
  /** pickFile이 순서대로 반환할 값 (null = 다이얼로그 취소) */
  pickedPaths?: Array<string | null>;
  /** readFile이 성공할 경로 → 내용. 없는 경로는 읽기 실패로 reject */
  files?: Record<string, string>;
  /** true면 readFile이 즉시 settle하지 않고 pendingReads에 쌓인다 (호출 시점 내용 스냅샷) */
  deferReads?: boolean;
  /** fake startWatching이 반환할 canonical 경로의 접두사 (기본 "" = 경로 그대로) */
  canonicalPrefix?: string;
};

function createFakeDeps({
  pickedPaths = [],
  files = {},
  deferReads = false,
  canonicalPrefix = "",
}: CreateFakeDepsParams) {
  const remainingPicks = [...pickedPaths];
  const readPaths: string[] = [];
  const watchedPaths: string[] = [];
  const pendingReads: Array<{ settle: () => void }> = [];
  const fakeSubscriber = createFakeDragDropSubscriber();
  let menuOpenHandler: (() => void) | null = null;
  let fileWatchHandler: ((payload: FileWatchPayload) => void) | null = null;
  const props = {
    pickFile: () => Promise.resolve(remainingPicks.shift() ?? null),
    readFile: ({ path }: { path: string }) => {
      readPaths.push(path);
      // 호출 시점 스냅샷 — 실제 디스크 읽기 의미론(늦게 resolve돼도 내용은 읽은 시점 것)
      const snapshot = files[path];
      if (!deferReads) {
        if (snapshot === undefined) {
          return Promise.reject(new Error(`읽기 실패: ${path}`));
        }
        return Promise.resolve(snapshot);
      }
      return new Promise<string>((resolve, reject) => {
        pendingReads.push({
          settle: () => {
            if (snapshot === undefined) {
              reject(new Error(`읽기 실패: ${path}`));
              return;
            }
            resolve(snapshot);
          },
        });
      });
    },
    subscribeDragDrop: fakeSubscriber.subscribe,
    installMenu: ({ onOpen }: { onOpen: () => void }) => {
      menuOpenHandler = onOpen;
    },
    startWatching: ({ path }: { path: string }) => {
      watchedPaths.push(path);
      return Promise.resolve(`${canonicalPrefix}${path}`);
    },
    subscribeFileWatch: ({
      onEvent,
    }: {
      onEvent: (payload: FileWatchPayload) => void;
    }) => {
      fileWatchHandler = onEvent;
      return Promise.resolve(() => {
        fileWatchHandler = null;
      });
    },
  };
  return {
    props,
    readPaths,
    watchedPaths,
    emitDragDrop: fakeSubscriber.emit,
    triggerMenuOpen: () => {
      menuOpenHandler?.();
    },
    emitFileWatch: (payload: FileWatchPayload) => {
      fileWatchHandler?.(payload);
    },
    setFileContent: (path: string, content: string) => {
      files[path] = content;
    },
    removeFile: (path: string) => {
      delete files[path];
    },
    settlePendingRead: (index: number) => {
      pendingReads[index]?.settle();
    },
  };
}
```

(c) 최상위 `describe("App")` 안에 새 context 추가:

```tsx
  context("열린 파일이 변경(저장)된 경우", () => {
    test("자동으로 재읽기해 새 내용을 렌더합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/note.md"],
        files: { "/tmp/note.md": "# 버전1" },
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("heading", { name: "버전1" });

      fakeDeps.setFileContent("/tmp/note.md", "# 버전2");
      act(() => {
        fakeDeps.emitFileWatch({ path: "/tmp/note.md", kind: "changed" });
      });

      expect(
        await screen.findByRole("heading", { name: "버전2" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    test("다른 경로의 이벤트는 무시합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/note.md"],
        files: { "/tmp/note.md": "# 버전1" },
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("heading", { name: "버전1" });
      const readsBefore = fakeDeps.readPaths.length;

      act(() => {
        fakeDeps.emitFileWatch({ path: "/tmp/other.md", kind: "changed" });
      });
      await act(async () => {});

      expect(fakeDeps.readPaths).toHaveLength(readsBefore);
    });

    test("재읽기에 실패하면 read-error 배너를 띄우고 내용을 유지합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/note.md"],
        files: { "/tmp/note.md": "# 버전1" },
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("heading", { name: "버전1" });

      fakeDeps.removeFile("/tmp/note.md");
      act(() => {
        fakeDeps.emitFileWatch({ path: "/tmp/note.md", kind: "changed" });
      });

      expect(await screen.findByRole("alert")).toHaveTextContent(/읽기 실패/);
      expect(
        screen.getByRole("heading", { name: "버전1" }),
      ).toBeInTheDocument();
    });
  });

  context("열린 파일이 삭제/이동된 경우", () => {
    test("내용을 유지하고 삭제 배너를 띄웁니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/note.md"],
        files: { "/tmp/note.md": "# 버전1" },
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("heading", { name: "버전1" });

      act(() => {
        fakeDeps.emitFileWatch({ path: "/tmp/note.md", kind: "removed" });
      });

      expect(await screen.findByRole("alert")).toHaveTextContent(/삭제/);
      expect(
        screen.getByRole("heading", { name: "버전1" }),
      ).toBeInTheDocument();
    });
  });

  context("파일 watch 시작 조건", () => {
    test("열기 성공 시 startWatching을 호출합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/note.md"],
        files: { "/tmp/note.md": "# 제목" },
      });
      render(<App {...fakeDeps.props} />);

      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("heading", { name: "제목" });

      expect(fakeDeps.watchedPaths).toEqual(["/tmp/note.md"]);
    });

    test("읽기에 실패하면 startWatching을 호출하지 않습니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({ pickedPaths: ["/tmp/broken.md"] });
      render(<App {...fakeDeps.props} />);

      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("alert");

      expect(fakeDeps.watchedPaths).toHaveLength(0);
    });
  });
```

- [ ] **Step 2: FAIL 확인** — App에 `startWatching`/`subscribeFileWatch` prop이 없어 tsc 에러 및/또는 새 테스트 실패. 기록.

- [ ] **Step 3 (GREEN):** `src/App.tsx` 전체를 다음으로 교체 (**의도적으로 세대 카운터는 아직 없음** — 사이클 C의 RED를 위해 최소 구현):

```tsx
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState } from "react";
import { MarkdownView } from "./components/MarkdownView";
import { type DragDropSubscriber, useFileDrop } from "./hooks/useFileDrop";
import {
  type FileWatchPayload,
  type FileWatchSubscriber,
  useFileWatch,
} from "./hooks/useFileWatch";
import { installAppMenu } from "./lib/installAppMenu";
import { isMarkdownPath, MARKDOWN_EXTENSIONS } from "./lib/isMarkdownPath";
import "./App.css";

type OpenedDocument = {
  path: string;
  content: string;
};

type AppNotice = {
  kind: "read-error" | "file-removed";
  message: string;
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
  /** 네이티브 앱 메뉴 설치 — onOpen이 File > Open…(⌘O)의 액션이 된다
   * @default installAppMenu 래퍼(installDefaultAppMenu)
   */
  installMenu?: (args: { onOpen: () => void }) => void;
  /** 파일 watch 시작 — canonical 경로를 반환. 실패해도 열람은 진행(자동 갱신만 비활성)
   * @default invoke("start_watching")
   */
  startWatching?: (args: { path: string }) => Promise<string>;
  /** "file-watch" 이벤트 구독 — useFileWatch에 전달
   * @default Tauri listen (useFileWatch의 기본값)
   */
  subscribeFileWatch?: FileWatchSubscriber;
};

function App({
  pickFile = pickMarkdownFile,
  readFile = readMarkdownFile,
  subscribeDragDrop,
  installMenu = installDefaultAppMenu,
  startWatching = startWatchingFile,
  subscribeFileWatch,
}: AppProps) {
  const [openedDocument, setOpenedDocument] = useState<OpenedDocument | null>(
    null,
  );
  const [notice, setNotice] = useState<AppNotice | null>(null);
  // 문서의 단일 식별자(canonical 경로) — watcher 이벤트 필터용.
  // stable 콜백(handleFileWatchEvent)에서 stale 클로저 없이 읽기 위해 ref
  const openedPathRef = useRef<string | null>(null);

  const openPath = useCallback(
    async ({ path }: { path: string }) => {
      let content: string;
      try {
        content = await readFile({ path });
      } catch (error) {
        setNotice({ kind: "read-error", message: String(error) });
        return;
      }
      // 읽기 성공 후에만 watch 교체 — 실패 시 이전 watch 유지 (스펙 §2)
      // watch 실패는 열람을 막지 않는다: 원래 경로를 식별자로 사용
      const watchedPath = await startWatching({ path }).catch(() => path);
      openedPathRef.current = watchedPath;
      setOpenedDocument({ path: watchedPath, content });
      setNotice(null);
    },
    [readFile, startWatching],
  );

  const reloadOpenedDocument = useCallback(async () => {
    const path = openedPathRef.current;
    if (path === null) {
      return;
    }
    try {
      const content = await readFile({ path });
      // 동일성 단락: 내용이 같으면 문서 setState 생략 — 단, notice 해제는 항상
      // (삭제 → 같은 내용 재생성 시 배너가 남는 것 방지, 스펙 §3.1)
      setNotice(null);
      setOpenedDocument((current) => {
        if (current === null || current.content === content) {
          return current;
        }
        return { ...current, content };
      });
    } catch (error) {
      setNotice({ kind: "read-error", message: String(error) });
    }
  }, [readFile]);

  const handleFileWatchEvent = useCallback(
    (payload: FileWatchPayload) => {
      if (payload.path !== openedPathRef.current) {
        return; // 이전 watcher의 잔여 이벤트·다른 문서 이벤트 무시
      }
      if (payload.kind === "removed") {
        setNotice({
          kind: "file-removed",
          message: "파일이 삭제되거나 이동되었습니다",
        });
        return;
      }
      void reloadOpenedDocument();
    },
    [reloadOpenedDocument],
  );

  useFileWatch({
    onEvent: handleFileWatchEvent,
    subscribe: subscribeFileWatch,
  });

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
    installMenu({
      onOpen: () => {
        void openViaDialog();
      },
    });
  }, [installMenu, openViaDialog]);

  return (
    <main className={isDragging ? "app dragging" : "app"}>
      {notice !== null && (
        <div role="alert" className="error-banner">
          {notice.message}
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

function startWatchingFile({ path }: { path: string }): Promise<string> {
  return invoke<string>("start_watching", { path });
}

function handleLinkClick({ url }: { url: string }) {
  void openUrl(url);
}

function installDefaultAppMenu({ onOpen }: { onOpen: () => void }) {
  void installAppMenu({ onOpen });
}
```

- [ ] **Step 4: PASS 확인** — 기존 9 + 신규 6 = 15 green (`errorMessage`→`notice` 교체는 기존 테스트의 role="alert" 단언과 호환).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.spec.tsx
git commit -m "feat: auto-reload opened file on watcher events with notice model"
```

#### 사이클 B — 삭제 후 재생성 복구

- [ ] **Step 6 (RED):** `context("열린 파일이 삭제/이동된 경우")` 안에 추가:

```tsx
    test("삭제 후 다른 내용으로 재생성되면 배너를 해제하고 새 내용을 렌더합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/note.md"],
        files: { "/tmp/note.md": "# 버전1" },
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("heading", { name: "버전1" });
      act(() => {
        fakeDeps.emitFileWatch({ path: "/tmp/note.md", kind: "removed" });
      });
      await screen.findByRole("alert");

      fakeDeps.setFileContent("/tmp/note.md", "# 버전2");
      act(() => {
        fakeDeps.emitFileWatch({ path: "/tmp/note.md", kind: "changed" });
      });

      expect(
        await screen.findByRole("heading", { name: "버전2" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    test("삭제 후 같은 내용으로 재생성되어도 배너를 해제합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/note.md"],
        files: { "/tmp/note.md": "# 버전1" },
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("heading", { name: "버전1" });
      act(() => {
        fakeDeps.emitFileWatch({ path: "/tmp/note.md", kind: "removed" });
      });
      await screen.findByRole("alert");

      // 내용은 그대로 — 동일성 단락이 notice 해제를 막으면 안 된다 (스펙 §2)
      act(() => {
        fakeDeps.emitFileWatch({ path: "/tmp/note.md", kind: "changed" });
      });

      await waitFor(() => {
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      });
      expect(
        screen.getByRole("heading", { name: "버전1" }),
      ).toBeInTheDocument();
    });
```

(`waitFor`를 `@testing-library/react` import에 추가.)

- [ ] **Step 7: 즉시 PASS 여부 확인** — 사이클 A 구현으로 이미 통과한다. RED 검증: `reloadOpenedDocument`의 `setNotice(null);` 줄을 임시 제거 → 두 테스트 모두 실패 확인 → 복원 → PASS.

- [ ] **Step 8: Commit**

```bash
git add src/App.spec.tsx
git commit -m "test: pin banner recovery on file re-creation"
```

#### 사이클 C — 재읽기 race (세대 카운터)

- [ ] **Step 9 (RED):** `context("열린 파일이 변경(저장)된 경우")` 안에 추가:

```tsx
    test("연속 변경 시 늦게 도착한 이전 읽기가 새 내용을 덮지 않습니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/note.md"],
        files: { "/tmp/note.md": "# 버전1" },
        deferReads: true,
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      act(() => {
        fakeDeps.settlePendingRead(0); // 최초 읽기(버전1 스냅샷) 완료
      });
      await screen.findByRole("heading", { name: "버전1" });

      fakeDeps.setFileContent("/tmp/note.md", "# 버전2");
      act(() => {
        fakeDeps.emitFileWatch({ path: "/tmp/note.md", kind: "changed" });
      }); // pendingReads[1] = 버전2 스냅샷 (느린 읽기)
      fakeDeps.setFileContent("/tmp/note.md", "# 버전3");
      act(() => {
        fakeDeps.emitFileWatch({ path: "/tmp/note.md", kind: "changed" });
      }); // pendingReads[2] = 버전3 스냅샷

      act(() => {
        fakeDeps.settlePendingRead(2); // 최신 읽기가 먼저 도착
      });
      await screen.findByRole("heading", { name: "버전3" });
      act(() => {
        fakeDeps.settlePendingRead(1); // 이전(stale) 읽기가 늦게 도착
      });
      await act(async () => {});

      expect(
        screen.getByRole("heading", { name: "버전3" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "버전2" }),
      ).not.toBeInTheDocument();
    });
```

- [ ] **Step 10: FAIL 확인** — 세대 카운터가 없으므로 stale 읽기(버전2)가 버전3을 덮어 실패해야 한다. 기록.

- [ ] **Step 11 (GREEN):** `App.tsx`에 세대 카운터 추가.

`openedPathRef` 선언 아래에:

```tsx
  // 읽기 세대 — 늦게 resolve된 이전 읽기의 결과를 폐기 (연속 저장/문서 전환 race, 스펙 §2)
  const readGenerationRef = useRef(0);
```

`openPath`를 다음으로 교체:

```tsx
  const openPath = useCallback(
    async ({ path }: { path: string }) => {
      const generation = readGenerationRef.current + 1;
      readGenerationRef.current = generation;
      let content: string;
      try {
        content = await readFile({ path });
      } catch (error) {
        if (readGenerationRef.current === generation) {
          setNotice({ kind: "read-error", message: String(error) });
        }
        return;
      }
      if (readGenerationRef.current !== generation) {
        return;
      }
      // 읽기 성공 후에만 watch 교체 — 실패 시 이전 watch 유지 (스펙 §2)
      // watch 실패는 열람을 막지 않는다: 원래 경로를 식별자로 사용
      const watchedPath = await startWatching({ path }).catch(() => path);
      if (readGenerationRef.current !== generation) {
        return;
      }
      openedPathRef.current = watchedPath;
      setOpenedDocument({ path: watchedPath, content });
      setNotice(null);
    },
    [readFile, startWatching],
  );
```

`reloadOpenedDocument`를 다음으로 교체:

```tsx
  const reloadOpenedDocument = useCallback(async () => {
    const path = openedPathRef.current;
    if (path === null) {
      return;
    }
    const generation = readGenerationRef.current + 1;
    readGenerationRef.current = generation;
    try {
      const content = await readFile({ path });
      if (readGenerationRef.current !== generation) {
        return;
      }
      // 동일성 단락: 내용이 같으면 문서 setState 생략 — 단, notice 해제는 항상
      // (삭제 → 같은 내용 재생성 시 배너가 남는 것 방지, 스펙 §3.1)
      setNotice(null);
      setOpenedDocument((current) => {
        if (current === null || current.content === content) {
          return current;
        }
        return { ...current, content };
      });
    } catch (error) {
      if (readGenerationRef.current === generation) {
        setNotice({ kind: "read-error", message: String(error) });
      }
    }
  }, [readFile]);
```

- [ ] **Step 12: PASS 확인** — race 테스트 포함 전체 green.

- [ ] **Step 13 (canonical 필터 테스트):** `context("파일 watch 시작 조건")` 안에 추가:

```tsx
    test("이벤트 필터는 startWatching이 반환한 canonical 경로를 기준으로 합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/note.md"],
        files: { "/tmp/note.md": "# 버전1" },
        canonicalPrefix: "/private",
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("heading", { name: "버전1" });
      const readsBefore = fakeDeps.readPaths.length;

      // 원래 경로로 온 이벤트는 무시, canonical 경로로 온 이벤트만 반영
      act(() => {
        fakeDeps.emitFileWatch({ path: "/tmp/note.md", kind: "changed" });
      });
      await act(async () => {});
      expect(fakeDeps.readPaths).toHaveLength(readsBefore);

      fakeDeps.setFileContent("/private/tmp/note.md", "# 버전2");
      act(() => {
        fakeDeps.emitFileWatch({ path: "/private/tmp/note.md", kind: "changed" });
      });

      expect(
        await screen.findByRole("heading", { name: "버전2" }),
      ).toBeInTheDocument();
    });
```

즉시 통과하면 RED 검증: `openPath`의 `openedPathRef.current = watchedPath;`를 임시로 `= path;`로 바꿔 실패 확인 → 복원.

- [ ] **Step 14: 전체 검증** — Run: `pnpm test && pnpm exec tsc --noEmit && pnpm coverage && pnpm build` → 전부 exit 0. 기대 테스트 수 **47** (35 + hook 2 + App 10). App.tsx 브랜치 커버리지 100% 유지 확인 — 미달 분기는 테스트 보강 후 보고.

- [ ] **Step 15: Commit**

```bash
git add src/App.tsx src/App.spec.tsx
git commit -m "feat: guard reloads with read generation and canonical path filter"
```

---

### Task 4: 수동 검증 (dev 가능 — 스펙 §4)

- [ ] `pnpm tauri dev` 실행 후: vim/VS Code/TextEdit에서 열린 파일 저장 → 자동 갱신(atomic save 포함) / 파일 삭제 → 배너 + 내용 유지 / 같은 이름 재생성 → 배너 해제 + 갱신 / 다른 파일 열기 → 이전 파일 저장해도 무반응 / 큰 문서(코드블록 다수)에서 저장 시 체감 멈춤 없는지 확인 (느리면 스펙 §5 기록대로 별도 작업).
