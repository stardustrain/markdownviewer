import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useState } from "react";
import { MarkdownView } from "./components/MarkdownView";
import { type DragDropSubscriber, useFileDrop } from "./hooks/useFileDrop";
import { isMarkdownPath, MARKDOWN_EXTENSIONS } from "./lib/isMarkdownPath";
import "./App.css";

type OpenedDocument = {
  path: string;
  content: string;
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
};

function App({
  pickFile = pickMarkdownFile,
  readFile = readMarkdownFile,
  subscribeDragDrop,
}: AppProps) {
  const [openedDocument, setOpenedDocument] = useState<OpenedDocument | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const openPath = useCallback(
    async ({ path }: { path: string }) => {
      try {
        const content = await readFile({ path });
        setOpenedDocument({ path, content });
        setErrorMessage(null);
      } catch (error) {
        setErrorMessage(String(error));
      }
    },
    [readFile],
  );

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
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || event.key !== "o") {
        return;
      }
      event.preventDefault();
      void openViaDialog();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openViaDialog]);

  return (
    <main className={isDragging ? "app dragging" : "app"}>
      {errorMessage !== null && (
        <div role="alert" className="error-banner">
          {errorMessage}
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

function handleLinkClick({ url }: { url: string }) {
  void openUrl(url);
}
