import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import {
  type DragDropPayload,
  type DragDropSubscriber,
} from "./hooks/useFileDrop";
import { type FileWatchPayload } from "./hooks/useFileWatch";

const context = describe;

describe("App", () => {
  context("파일을 열기 전", () => {
    test("빈 상태 안내와 열기 버튼을 렌더합니다.", () => {
      const fakeDeps = createFakeDeps({});

      render(<App {...fakeDeps.props} />);

      expect(
        screen.getByRole("button", { name: /파일 열기/ }),
      ).toBeInTheDocument();
    });
  });

  context("파일을 드롭하는 경우", () => {
    test("드롭된 경로 중 첫 마크다운 파일을 엽니다.", async () => {
      const fakeDeps = createFakeDeps({
        files: { "/tmp/note.md": "# 드롭으로 열기" },
      });
      render(<App {...fakeDeps.props} />);

      act(() => {
        fakeDeps.emitDragDrop({
          type: "drop",
          paths: ["/tmp/image.png", "/tmp/note.md"],
        });
      });

      expect(
        await screen.findByRole("heading", { name: "드롭으로 열기" }),
      ).toBeInTheDocument();
      expect(fakeDeps.readPaths).toEqual(["/tmp/note.md"]);
    });

    test("마크다운 파일이 없으면 무시합니다.", async () => {
      const fakeDeps = createFakeDeps({});
      render(<App {...fakeDeps.props} />);

      act(() => {
        fakeDeps.emitDragDrop({ type: "drop", paths: ["/tmp/image.png"] });
      });

      expect(fakeDeps.readPaths).toHaveLength(0);
      expect(
        screen.getByRole("button", { name: /파일 열기/ }),
      ).toBeInTheDocument();
    });

    test("드래그 중에는 dragging 클래스로 하이라이트합니다.", () => {
      const fakeDeps = createFakeDeps({});
      const { container } = render(<App {...fakeDeps.props} />);

      act(() => {
        fakeDeps.emitDragDrop({ type: "enter", paths: ["/tmp/note.md"] });
      });

      expect(container.querySelector("main.dragging")).not.toBeNull();
    });
  });

  context("메뉴의 Open을 실행하는 경우", () => {
    test("빈 상태에서도 파일 열기를 트리거합니다.", async () => {
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/note.md"],
        files: { "/tmp/note.md": "# 메뉴로 열기" },
      });
      render(<App {...fakeDeps.props} />);

      act(() => {
        fakeDeps.triggerMenuOpen();
      });

      expect(
        await screen.findByRole("heading", { name: "메뉴로 열기" }),
      ).toBeInTheDocument();
    });
  });

  context("열기 버튼으로 파일을 여는 경우", () => {
    test("선택한 파일 내용을 렌더합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/note.md"],
        files: { "/tmp/note.md": "# 제목" },
      });
      render(<App {...fakeDeps.props} />);

      await user.click(screen.getByRole("button", { name: /파일 열기/ }));

      expect(
        await screen.findByRole("heading", { name: "제목" }),
      ).toBeInTheDocument();
    });

    test("다이얼로그를 취소하면 아무것도 읽지 않고 빈 상태를 유지합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({ pickedPaths: [null] });
      render(<App {...fakeDeps.props} />);

      await user.click(screen.getByRole("button", { name: /파일 열기/ }));

      expect(fakeDeps.readPaths).toHaveLength(0);
      expect(
        screen.getByRole("button", { name: /파일 열기/ }),
      ).toBeInTheDocument();
    });

    test("읽기에 실패하면 에러 배너를 띄우고 기존 문서를 유지합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/good.md", "/tmp/broken.md"],
        files: { "/tmp/good.md": "# 기존 문서" },
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("heading", { name: "기존 문서" });

      // 두 번째 열기: /tmp/broken.md는 files에 없어 읽기 실패
      const openButtons = screen.queryAllByRole("button", {
        name: /파일 열기/,
      });
      expect(openButtons).toHaveLength(0); // 문서가 열리면 빈 상태 버튼은 사라진다
      act(() => {
        fakeDeps.triggerMenuOpen();
      });

      expect(await screen.findByRole("alert")).toHaveTextContent(/읽기 실패/);
      expect(
        screen.getByRole("heading", { name: "기존 문서" }),
      ).toBeInTheDocument();
    });

    test("실패 후 다시 성공하면 에러 배너가 사라집니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/broken.md", "/tmp/good.md"],
        files: { "/tmp/good.md": "# 복구된 문서" },
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("alert");

      await user.click(screen.getByRole("button", { name: /파일 열기/ }));

      expect(
        await screen.findByRole("heading", { name: "복구된 문서" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

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
});

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

function createFakeDragDropSubscriber() {
  let registeredHandler: ((payload: DragDropPayload) => void) | null = null;
  const subscribe: DragDropSubscriber = ({ onEvent }) => {
    registeredHandler = onEvent;
    return Promise.resolve(() => {
      registeredHandler = null;
    });
  };
  return {
    subscribe,
    emit: (payload: DragDropPayload) => {
      registeredHandler?.(payload);
    },
  };
}
