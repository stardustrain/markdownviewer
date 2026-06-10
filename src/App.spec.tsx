import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import {
  type DragDropPayload,
  type DragDropSubscriber,
} from "./hooks/useFileDrop";

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

  context("Cmd+O를 누르는 경우", () => {
    test("빈 상태에서도 파일 열기를 트리거합니다.", async () => {
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/note.md"],
        files: { "/tmp/note.md": "# 단축키로 열기" },
      });
      render(<App {...fakeDeps.props} />);

      act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "o", metaKey: true }),
        );
      });

      expect(
        await screen.findByRole("heading", { name: "단축키로 열기" }),
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
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "o", metaKey: true }),
        );
      });

      expect(await screen.findByRole("alert")).toHaveTextContent(/읽기 실패/);
      expect(
        screen.getByRole("heading", { name: "기존 문서" }),
      ).toBeInTheDocument();
    });
  });
});

type CreateFakeDepsParams = {
  /** pickFile이 순서대로 반환할 값 (null = 다이얼로그 취소) */
  pickedPaths?: Array<string | null>;
  /** readFile이 성공할 경로 → 내용. 없는 경로는 읽기 실패로 reject */
  files?: Record<string, string>;
};

function createFakeDeps({ pickedPaths = [], files = {} }: CreateFakeDepsParams) {
  const remainingPicks = [...pickedPaths];
  const readPaths: string[] = [];
  const fakeSubscriber = createFakeDragDropSubscriber();
  const props = {
    pickFile: () => Promise.resolve(remainingPicks.shift() ?? null),
    readFile: ({ path }: { path: string }) => {
      readPaths.push(path);
      const content = files[path];
      if (content === undefined) {
        return Promise.reject(new Error(`읽기 실패: ${path}`));
      }
      return Promise.resolve(content);
    },
    subscribeDragDrop: fakeSubscriber.subscribe,
  };
  return { props, readPaths, emitDragDrop: fakeSubscriber.emit };
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
