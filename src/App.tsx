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
  // 읽기 세대 — 늦게 resolve된 이전 읽기의 결과를 폐기 (연속 저장/문서 전환 race, 스펙 §2)
  const readGenerationRef = useRef(0);

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
