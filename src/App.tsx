import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath as openPathWithDefaultApp, openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState } from "react";
import { MarkdownView } from "./components/MarkdownView";
import { TabBar } from "./components/TabBar";
import { type DragDropSubscriber, useFileDrop } from "./hooks/useFileDrop";
import { type FileWatchPayload, type FileWatchSubscriber, useFileWatch } from "./hooks/useFileWatch";
import { classifyLink } from "./lib/classifyLink";
import { findTabByPath, getFileTitle, getMarkdownPaths, getNextActiveTabIdAfterClose } from "./lib/documentTabs";
import { installAppMenu } from "./lib/installAppMenu";
import { isMarkdownPath, MARKDOWN_EXTENSIONS } from "./lib/isMarkdownPath";
import "./App.css";

type DocumentTab = {
  id: string;
  path: string;
  title: string;
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

type OpenPathResult =
  | { kind: "existing"; id: string; index: number }
  | { kind: "opened"; tab: DocumentTab; index: number }
  | { kind: "failed"; error: unknown; index: number };

type OpenPathsUpdate = {
  nextState: TabsState;
  openedTabId: string | null;
};

type ReadFile = (args: { path: string }) => Promise<string>;

type StartWatching = (args: { path: string }) => Promise<string>;

type MutableRef<T> = {
  current: T;
};

type AppNotice = {
  kind: "read-error" | "file-removed";
  message: string;
};

const initialTabsState: TabsState = { tabs: [], activeTabId: null };

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
  /** 파일 watch 중지 — 탭 닫기 시 호출
   * @default invoke("stop_watching")
   */
  stopWatching?: (args: { path: string }) => Promise<void>;
  /** "file-watch" 이벤트 구독 — useFileWatch에 전달
   * @default Tauri listen (useFileWatch의 기본값)
   */
  subscribeFileWatch?: FileWatchSubscriber;
  /** 콜드 스타트에 OS가 전달한 파일 경로 버퍼를 1회 pull (Rust가 drain)
   * @default invoke("opened_files")
   */
  fetchOpenedFiles?: () => Promise<string[]>;
  /** 실행 중 OS 파일 열기("opened" 이벤트) 구독
   * @default Tauri listen("opened")
   */
  subscribeOpened?: (args: { onOpen: (args: { paths: string[] }) => void }) => Promise<() => void>;
  /** 외부 링크(스킴 있는 href)를 기본 브라우저로 열기
   * @default Tauri opener openUrl 래퍼
   */
  openExternal?: (args: { url: string }) => Promise<void>;
  /** 파일을 OS 기본 앱으로 열기 — 비마크다운 상대 경로 링크용
   * @default Tauri opener openPath 래퍼
   */
  openWithOS?: (args: { path: string }) => Promise<void>;
};

function App({
  pickFile = pickMarkdownFile,
  readFile = readMarkdownFile,
  subscribeDragDrop,
  installMenu = installDefaultAppMenu,
  startWatching = startWatchingFile,
  stopWatching = stopWatchingFile,
  subscribeFileWatch,
  fetchOpenedFiles = fetchOpenedFilesFromOS,
  subscribeOpened = subscribeToOpenedFiles,
  openExternal = openExternalUrl,
  openWithOS = openFileWithOS,
}: AppProps) {
  const [tabsState, setTabsState] = useState<TabsState>(initialTabsState);
  const [notice, setNotice] = useState<AppNotice | null>(null);
  const activeTab = getActiveTab({ state: tabsState });
  const tabsRef = useRef<TabsState>(initialTabsState);
  const nextTabIdRef = useRef(1);
  const latestOpenRequestRef = useRef(0);
  // active 문서의 단일 식별자(canonical 경로) — watcher 이벤트 필터용.
  // stable 콜백(handleFileWatchEvent)에서 stale 클로저 없이 읽기 위해 ref
  const activePathRef = useRef<string | null>(null);
  // active 전환을 시도하는 열기 세대 — 진행 중이던 이전 재읽기 결과를 무효화한다.
  const openGenerationRef = useRef(0);
  // 재읽기 시퀀스 — 재읽기와 removed 이벤트가 올린다. 늦게 도착한 stale 재읽기를 무효화
  const reloadSequenceRef = useRef(0);

  const applyTabsState = useCallback((getNextState: (current: TabsState) => TabsState) => {
    setTabsState((current) => {
      const nextState = getNextState(current);
      tabsRef.current = nextState;
      activePathRef.current = getActiveTab({ state: nextState })?.path ?? null;
      return nextState;
    });
  }, []);

  const openPaths = useCallback(
    async ({ paths }: { paths: string[] }) => {
      const markdownPaths = getMarkdownPaths({ paths });
      if (markdownPaths.length === 0) {
        return;
      }

      const requestSequence = latestOpenRequestRef.current + 1;
      latestOpenRequestRef.current = requestSequence;
      openGenerationRef.current += 1;
      const results = await Promise.all(
        markdownPaths.map((path, index): Promise<OpenPathResult> => {
          return openMarkdownPath({
            path,
            index,
            readFile,
            startWatching,
            tabsRef,
            createTabId: () => {
              const id = `tab-${nextTabIdRef.current}`;
              nextTabIdRef.current += 1;
              return id;
            },
            openGeneration: requestSequence,
          });
        }),
      );

      const failedResult = results.find((result) => result.kind === "failed");
      const shouldActivate = requestSequence === latestOpenRequestRef.current || tabsRef.current.activeTabId === null;
      const currentUpdate = getTabsStateAfterOpen({ current: tabsRef.current, results, shouldActivate });
      applyTabsState((current) => {
        return getTabsStateAfterOpen({ current, results, shouldActivate }).nextState;
      });

      if (currentUpdate.openedTabId === null) {
        if (failedResult !== undefined && requestSequence === latestOpenRequestRef.current) {
          setNotice({ kind: "read-error", message: String(failedResult.error) });
        }
        return;
      }

      if (!shouldActivate) {
        return;
      }

      setNotice(null);
      // 이전 active 문서의 재읽기가 아직 in-flight일 수 있다 — 새 active 탭을 덮지 못하게 무효화
      reloadSequenceRef.current += 1;
    },
    [applyTabsState, readFile, startWatching],
  );

  const openPath = useCallback(
    async ({ path }: { path: string }) => {
      await openPaths({ paths: [path] });
    },
    [openPaths],
  );

  const reloadOpenedDocument = useCallback(async () => {
    const path = activePathRef.current;
    if (path === null) {
      return;
    }
    const openGeneration = openGenerationRef.current;
    const sequence = reloadSequenceRef.current + 1;
    reloadSequenceRef.current = sequence;
    try {
      const content = await readFile({ path });
      if (openGenerationRef.current !== openGeneration || reloadSequenceRef.current !== sequence) {
        return;
      }
      // 동일성 단락: 내용이 같으면 문서 setState 생략 — 단, notice 해제는 항상
      // (삭제 → 같은 내용 재생성 시 배너가 남는 것 방지, 스펙 §3.1)
      setNotice(null);
      applyTabsState((current) => {
        const currentActiveTab = getActiveTab({ state: current });
        if (currentActiveTab === null || currentActiveTab.path !== path) {
          return current;
        }
        return {
          ...current,
          tabs: current.tabs.map((tab) => {
            if (tab.id !== currentActiveTab.id) {
              return tab;
            }
            if (tab.content === content && tab.status === "ready") {
              return tab;
            }
            return { ...tab, content, status: "ready", notice: null, reloadSequence: sequence };
          }),
        };
      });
    } catch (error) {
      if (openGenerationRef.current === openGeneration && reloadSequenceRef.current === sequence) {
        setNotice({ kind: "read-error", message: String(error) });
      }
    }
  }, [applyTabsState, readFile]);

  const handleFileWatchEvent = useCallback(
    (payload: FileWatchPayload) => {
      if (payload.path !== activePathRef.current) {
        return; // 이전 watcher의 잔여 이벤트·다른 문서 이벤트 무시
      }
      if (payload.kind === "removed") {
        // in-flight 재읽기가 늦게 resolve해 삭제 배너를 지우지 못하게 무효화
        reloadSequenceRef.current += 1;
        applyTabsState((current) => {
          const currentActiveTab = getActiveTab({ state: current });
          if (currentActiveTab === null || currentActiveTab.path !== payload.path) {
            return current;
          }
          return {
            ...current,
            tabs: current.tabs.map((tab) => {
              if (tab.id !== currentActiveTab.id) {
                return tab;
              }
              return {
                ...tab,
                status: "deleted",
                notice: {
                  kind: "file-removed",
                  message: "파일이 삭제되거나 이동되었습니다",
                },
              };
            }),
          };
        });
        setNotice({
          kind: "file-removed",
          message: "파일이 삭제되거나 이동되었습니다",
        });
        return;
      }
      void reloadOpenedDocument();
    },
    [applyTabsState, reloadOpenedDocument],
  );

  useFileWatch({
    onEvent: handleFileWatchEvent,
    subscribe: subscribeFileWatch,
  });

  const openAllOf = useCallback(
    ({ paths }: { paths: string[] }) => {
      void openPaths({ paths });
    },
    [openPaths],
  );

  // 콜드 스타트: Opened가 웹뷰 로드 전에 발생하므로 버퍼를 1회 pull (스펙 §3.1)
  // Rust가 drain하므로(StrictMode 이중 실행 시 두 번째 pull은 빈 배열) 중복 열기 없음
  useEffect(() => {
    void fetchOpenedFiles().then((paths) => {
      openAllOf({ paths });
    });
  }, [fetchOpenedFiles, openAllOf]);

  // 실행 중: "opened" 이벤트 구독 (cleanup 패턴은 useFileWatch/useFileDrop과 동일)
  useEffect(() => {
    const unlistenPromise = subscribeOpened({ onOpen: openAllOf });
    return () => {
      unlistenPromise.then((unlisten) => {
        unlisten();
      });
    };
  }, [subscribeOpened, openAllOf]);

  const openViaDialog = useCallback(async () => {
    const path = await pickFile();
    if (path === null) {
      return;
    }
    await openPath({ path });
  }, [pickFile, openPath]);

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
      const openedPath = activePathRef.current;
      if (openedPath === null) {
        return; // 문서 없이는 MarkdownView가 렌더되지 않으므로 도달 불가 — 방어
      }
      // 정규화 없이 조합 — "."/".."은 OS가 해석, canonicalize가 식별자 정리 (스펙 §2)
      const baseDirectory = openedPath.slice(0, openedPath.lastIndexOf("/"));
      const resolvedPath = `${baseDirectory}/${classification.path}`;
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

  const handleDrop = useCallback(
    ({ paths }: { paths: string[] }) => {
      void openPaths({ paths });
    },
    [openPaths],
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

  const selectTab = useCallback(
    ({ id }: { id: string }) => {
      reloadSequenceRef.current += 1;
      applyTabsState((current) => {
        const tab = current.tabs.find((item) => item.id === id);
        if (tab === undefined) {
          return current;
        }
        return { ...current, activeTabId: id };
      });
      setNotice(null);
    },
    [applyTabsState],
  );

  const closeTab = useCallback(
    ({ id }: { id: string }) => {
      const tab = tabsRef.current.tabs.find((item) => item.id === id);
      if (tab === undefined) {
        return;
      }
      void stopWatching({ path: tab.path });
      reloadSequenceRef.current += 1;
      applyTabsState((current) => {
        const nextActiveTabId = getNextActiveTabIdAfterClose({
          tabs: current.tabs,
          closedTabId: id,
          activeTabId: current.activeTabId,
        });
        return {
          tabs: current.tabs.filter((item) => item.id !== id),
          activeTabId: nextActiveTabId,
        };
      });
      setNotice(null);
    },
    [applyTabsState, stopWatching],
  );

  return (
    <main className={isDragging ? "app dragging" : "app"}>
      {notice !== null && (
        <div role="alert" className="error-banner">
          {notice.message}
        </div>
      )}
      {activeTab === null ? (
        <div className="empty-state">
          <p>마크다운 파일을 끌어다 놓거나 열기 버튼을 누르세요</p>
          <button type="button" onClick={() => void openViaDialog()}>
            파일 열기 (⌘O)
          </button>
        </div>
      ) : (
        <TabBar
          activeTabId={tabsState.activeTabId}
          onCloseTab={closeTab}
          onOpenFile={() => void openViaDialog()}
          onSelectTab={selectTab}
          tabs={tabsState.tabs}
        >
          <MarkdownView source={activeTab.content} onLinkClick={handleLinkClick} />
        </TabBar>
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

function stopWatchingFile({ path }: { path: string }): Promise<void> {
  return invoke<void>("stop_watching", { path });
}

function fetchOpenedFilesFromOS(): Promise<string[]> {
  return invoke<string[]>("opened_files");
}

function subscribeToOpenedFiles({ onOpen }: { onOpen: (args: { paths: string[] }) => void }): Promise<() => void> {
  return listen<string[]>("opened", (event) => {
    onOpen({ paths: event.payload });
  });
}

function openExternalUrl({ url }: { url: string }): Promise<void> {
  return openUrl(url);
}

function openFileWithOS({ path }: { path: string }): Promise<void> {
  return openPathWithDefaultApp(path);
}

function installDefaultAppMenu({ onOpen }: { onOpen: () => void }) {
  void installAppMenu({ onOpen });
}

function getActiveTab({ state }: { state: TabsState }): DocumentTab | null {
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;
}

async function openMarkdownPath({
  path,
  index,
  readFile,
  startWatching,
  tabsRef,
  createTabId,
  openGeneration,
}: {
  path: string;
  index: number;
  readFile: ReadFile;
  startWatching: StartWatching;
  tabsRef: MutableRef<TabsState>;
  createTabId: () => string;
  openGeneration: number;
}): Promise<OpenPathResult> {
  const existingTab = findTabByPath({ tabs: tabsRef.current.tabs, path });
  if (existingTab !== null) {
    return { kind: "existing", id: existingTab.id, index };
  }
  try {
    const content = await readFile({ path });
    // 읽기 성공 후에만 watch 시작 — 실패 시 열람은 진행(자동 갱신만 비활성)
    const watchedPath = await startWatching({ path }).catch(() => path);
    return {
      kind: "opened",
      index,
      tab: {
        id: createTabId(),
        path: watchedPath,
        title: getFileTitle({ path: watchedPath }),
        content,
        notice: null,
        status: "ready",
        openGeneration,
        reloadSequence: 0,
      },
    };
  } catch (error) {
    return { kind: "failed", error, index };
  }
}

function getTabsStateAfterOpen({
  current,
  results,
  shouldActivate,
}: {
  current: TabsState;
  results: OpenPathResult[];
  shouldActivate: boolean;
}): OpenPathsUpdate {
  let tabs = current.tabs;
  let openedTabId: string | null = null;

  for (const result of [...results].sort((left, right) => left.index - right.index)) {
    if (result.kind === "existing") {
      const existingTab = tabs.find((tab) => tab.id === result.id);
      if (existingTab !== undefined) {
        openedTabId = existingTab.id;
      }
      continue;
    }
    if (result.kind !== "opened") {
      continue;
    }
    const duplicateTab = findTabByPath({ tabs, path: result.tab.path });
    if (duplicateTab !== null) {
      openedTabId = duplicateTab.id;
      continue;
    }
    tabs = [...tabs, result.tab];
    openedTabId = result.tab.id;
  }

  if (openedTabId === null) {
    return { nextState: current, openedTabId };
  }

  return {
    nextState: {
      tabs,
      activeTabId: shouldActivate ? openedTabId : current.activeTabId,
    },
    openedTabId,
  };
}
