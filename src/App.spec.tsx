import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { type DragDropPayload, type DragDropSubscriber } from "./hooks/useFileDrop";
import { type FileWatchPayload } from "./hooks/useFileWatch";

const context = describe;

describe("App", () => {
  context("파일을 열기 전", () => {
    test("빈 상태 안내와 열기 버튼을 렌더합니다.", () => {
      const fakeDeps = createFakeDeps({});

      render(<App {...fakeDeps.props} />);

      expect(screen.getByRole("button", { name: /파일 열기/ })).toBeInTheDocument();
    });
  });

  context("파일을 드롭하는 경우", () => {
    test("드롭된 여러 마크다운 파일을 모두 열고 마지막 파일을 활성화합니다.", async () => {
      const fakeDeps = createFakeDeps({
        files: {
          "/tmp/a.md": "# 첫 번째 드롭",
          "/tmp/b.md": "# 마지막 드롭",
        },
      });
      render(<App {...fakeDeps.props} />);

      act(() => {
        fakeDeps.emitDragDrop({
          type: "drop",
          paths: ["/tmp/image.png", "/tmp/a.md", "/tmp/b.md"],
        });
      });

      expect(await screen.findByRole("heading", { name: "마지막 드롭" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "a.md (/tmp/a.md)" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "b.md (/tmp/b.md)" })).toBeInTheDocument();
      expect(fakeDeps.readPaths).toEqual(["/tmp/a.md", "/tmp/b.md"]);
    });

    test("마크다운 파일이 없으면 무시합니다.", async () => {
      const fakeDeps = createFakeDeps({});
      render(<App {...fakeDeps.props} />);

      act(() => {
        fakeDeps.emitDragDrop({ type: "drop", paths: ["/tmp/image.png"] });
      });

      expect(fakeDeps.readPaths).toHaveLength(0);
      expect(screen.getByRole("button", { name: /파일 열기/ })).toBeInTheDocument();
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

      expect(await screen.findByRole("heading", { name: "메뉴로 열기" })).toBeInTheDocument();
    });
  });

  context("열기 버튼으로 파일을 여는 경우", () => {
    test("선택한 파일 내용을 탭으로 렌더합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/note.md"],
        files: { "/tmp/note.md": "# 제목" },
      });
      render(<App {...fakeDeps.props} />);

      await user.click(screen.getByRole("button", { name: /파일 열기/ }));

      expect(await screen.findByRole("heading", { name: "제목" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "note.md (/tmp/note.md)" })).toBeInTheDocument();
    });

    test("같은 파일을 다시 열면 기존 탭을 활성화하고 중복 탭을 만들지 않습니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/a.md", "/tmp/b.md", "/tmp/a.md"],
        files: {
          "/tmp/a.md": "# 문서A",
          "/tmp/b.md": "# 문서B",
        },
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("heading", { name: "문서A" });
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("heading", { name: "문서B" });

      await user.click(screen.getByRole("button", { name: /파일 열기/ }));

      expect(await screen.findByRole("heading", { name: "문서A" })).toBeInTheDocument();
      expect(screen.getAllByRole("tab", { name: "a.md (/tmp/a.md)" })).toHaveLength(1);
      expect(screen.getAllByRole("tab")).toHaveLength(2);
    });

    test("다이얼로그를 취소하면 아무것도 읽지 않고 빈 상태를 유지합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({ pickedPaths: [null] });
      render(<App {...fakeDeps.props} />);

      await user.click(screen.getByRole("button", { name: /파일 열기/ }));

      expect(fakeDeps.readPaths).toHaveLength(0);
      expect(screen.getByRole("button", { name: /파일 열기/ })).toBeInTheDocument();
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
      act(() => {
        fakeDeps.triggerMenuOpen();
      });

      expect(await screen.findByRole("alert")).toHaveTextContent(/읽기 실패/);
      expect(screen.getByRole("heading", { name: "기존 문서" })).toBeInTheDocument();
      expect(screen.getAllByRole("tab")).toHaveLength(1);
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

      expect(await screen.findByRole("heading", { name: "복구된 문서" })).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    test("읽기가 완료되기 전에 다른 열기가 시작되어도 늦게 완료된 파일을 탭으로 추가합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/a.md", "/tmp/b.md"],
        files: { "/tmp/a.md": "# 문서A", "/tmp/b.md": "# 문서B" },
        deferReads: true,
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      // pendingReads[0] = 문서A 읽기 (대기 중)

      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      // pendingReads[1] = 문서B 읽기 (대기 중)

      act(() => {
        fakeDeps.settlePendingRead(1); // 문서B 먼저 도착
      });
      await screen.findByRole("heading", { name: "문서B" });

      act(() => {
        fakeDeps.settlePendingRead(0); // 문서A 늦게 도착 — 탭으로 추가되어야 함
      });
      await act(async () => {});

      expect(screen.getByRole("heading", { name: "문서B" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "a.md (/tmp/a.md)" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "b.md (/tmp/b.md)" })).toBeInTheDocument();

      await user.click(screen.getByRole("tab", { name: "a.md (/tmp/a.md)" }));

      expect(await screen.findByRole("heading", { name: "문서A" })).toBeInTheDocument();
    });

    test("늦게 실패한 이전 열기가 새 문서를 덮지 않습니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/broken.md", "/tmp/good.md"],
        files: { "/tmp/good.md": "# 정상 문서" },
        deferReads: true,
      });
      render(<App {...fakeDeps.props} />);

      // 첫 번째 열기: /tmp/broken.md — 읽기 대기 중 (pending[0], 나중에 실패)
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));

      // 두 번째 열기: /tmp/good.md — 읽기 대기 중 (pending[1])
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));

      // good.md 먼저 resolve → 정상 문서 렌더
      act(() => {
        fakeDeps.settlePendingRead(1);
      });
      await screen.findByRole("heading", { name: "정상 문서" });

      // broken.md 늦게 reject — 이전 열기 실패가 최신 탭에 alert를 만들면 안 된다
      act(() => {
        fakeDeps.settlePendingRead(0);
      });
      await act(async () => {});

      expect(screen.getByRole("heading", { name: "정상 문서" })).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    test("startWatching 완료 전에 다른 열기가 시작되어도 늦게 완료된 파일을 탭으로 추가합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/a.md", "/tmp/b.md"],
        files: { "/tmp/a.md": "# 문서A", "/tmp/b.md": "# 문서B" },
        deferWatching: true,
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      // pendingWatchings[0] = /tmp/a.md watch 대기 중 (읽기는 즉시 완료)

      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      // pendingWatchings[1] = /tmp/b.md watch 대기 중

      act(() => {
        fakeDeps.settlePendingWatching({ index: 1, canonicalPath: "/tmp/b.md" }); // b 먼저 완료
      });
      await screen.findByRole("heading", { name: "문서B" });

      act(() => {
        fakeDeps.settlePendingWatching({ index: 0, canonicalPath: "/tmp/a.md" }); // a 늦게 도착 — 탭으로 추가되어야 함
      });
      await act(async () => {});

      expect(screen.getByRole("heading", { name: "문서B" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "a.md (/tmp/a.md)" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "b.md (/tmp/b.md)" })).toBeInTheDocument();

      await user.click(screen.getByRole("tab", { name: "a.md (/tmp/a.md)" }));

      expect(await screen.findByRole("heading", { name: "문서A" })).toBeInTheDocument();
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

      fakeDeps.setFileContent({ path: "/tmp/note.md", content: "# 버전2" });
      act(() => {
        fakeDeps.emitFileWatch({ path: "/tmp/note.md", kind: "changed" });
      });

      expect(await screen.findByRole("heading", { name: "버전2" })).toBeInTheDocument();
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

    test("비활성 탭이 변경되면 해당 탭 내용을 갱신하고 선택 시 최신 내용을 보여줍니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        osOpenedPaths: ["/tmp/a.md", "/tmp/b.md"],
        files: {
          "/tmp/a.md": "# 문서A v1",
          "/tmp/b.md": "# 문서B",
        },
      });
      render(<App {...fakeDeps.props} />);
      await screen.findByRole("heading", { name: "문서B" });

      fakeDeps.setFileContent({ path: "/tmp/a.md", content: "# 문서A v2" });
      act(() => {
        fakeDeps.emitFileWatch({ path: "/tmp/a.md", kind: "changed" });
      });
      await act(async () => {});
      await user.click(screen.getByRole("tab", { name: "a.md (/tmp/a.md)" }));

      expect(screen.getByRole("heading", { name: "문서A v2" })).toBeInTheDocument();
    });

    test("비활성 탭도 연속 변경 시 늦게 도착한 이전 읽기가 새 내용을 덮지 않습니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        osOpenedPaths: ["/tmp/a.md", "/tmp/b.md"],
        files: {
          "/tmp/a.md": "# 문서A v1",
          "/tmp/b.md": "# 문서B",
        },
        deferReads: true,
      });
      render(<App {...fakeDeps.props} />);
      await act(async () => {});
      act(() => {
        fakeDeps.settlePendingRead(0); // A 최초 읽기
        fakeDeps.settlePendingRead(1); // B 최초 읽기
      });
      await screen.findByRole("heading", { name: "문서B" });

      fakeDeps.setFileContent({ path: "/tmp/a.md", content: "# 문서A v2" });
      act(() => {
        fakeDeps.emitFileWatch({ path: "/tmp/a.md", kind: "changed" });
      }); // pendingReads[2] = A v2 스냅샷
      fakeDeps.setFileContent({ path: "/tmp/a.md", content: "# 문서A v3" });
      act(() => {
        fakeDeps.emitFileWatch({ path: "/tmp/a.md", kind: "changed" });
      }); // pendingReads[3] = A v3 스냅샷

      act(() => {
        fakeDeps.settlePendingRead(3);
      });
      await act(async () => {});
      act(() => {
        fakeDeps.settlePendingRead(2);
      });
      await act(async () => {});
      await user.click(screen.getByRole("tab", { name: "a.md (/tmp/a.md)" }));

      expect(screen.getByRole("heading", { name: "문서A v3" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "문서A v2" })).not.toBeInTheDocument();
    });

    test("닫힌 탭 path의 changed/removed 이벤트를 무시합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        osOpenedPaths: ["/tmp/a.md", "/tmp/b.md"],
        files: {
          "/tmp/a.md": "# 문서A",
          "/tmp/b.md": "# 문서B",
        },
      });
      render(<App {...fakeDeps.props} />);
      await screen.findByRole("heading", { name: "문서B" });
      await user.click(screen.getByRole("button", { name: "a.md 닫기 (/tmp/a.md)" }));
      const readsBefore = fakeDeps.readPaths.length;

      act(() => {
        fakeDeps.emitFileWatch({ path: "/tmp/a.md", kind: "changed" });
        fakeDeps.emitFileWatch({ path: "/tmp/a.md", kind: "removed" });
      });
      await act(async () => {});

      expect(fakeDeps.readPaths).toHaveLength(readsBefore);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByRole("tab", { name: "a.md (/tmp/a.md)" })).not.toBeInTheDocument();
    });

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

      fakeDeps.setFileContent({ path: "/tmp/note.md", content: "# 버전2" });
      act(() => {
        fakeDeps.emitFileWatch({ path: "/tmp/note.md", kind: "changed" });
      }); // pendingReads[1] = 버전2 스냅샷 (느린 읽기)
      fakeDeps.setFileContent({ path: "/tmp/note.md", content: "# 버전3" });
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

      expect(screen.getByRole("heading", { name: "버전3" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "버전2" })).not.toBeInTheDocument();
    });

    test("늦게 실패한 이전 재읽기가 최신 문서를 덮지 않습니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/note.md"],
        files: { "/tmp/note.md": "# 버전1" },
        deferReads: true,
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      // pending[0] = 최초 열기 읽기
      act(() => {
        fakeDeps.settlePendingRead(0);
      });
      await screen.findByRole("heading", { name: "버전1" });

      // 첫 번째 changed: note.md를 삭제 → pending[1] 은 나중에 reject
      fakeDeps.removeFile("/tmp/note.md");
      act(() => {
        fakeDeps.emitFileWatch({ path: "/tmp/note.md", kind: "changed" });
      });

      // 두 번째 changed: 새 내용으로 복구 → pending[2] 은 나중에 resolve
      fakeDeps.setFileContent({ path: "/tmp/note.md", content: "# 버전2" });
      act(() => {
        fakeDeps.emitFileWatch({ path: "/tmp/note.md", kind: "changed" });
      });

      // 최신 재읽기(pending[2]) 먼저 resolve
      act(() => {
        fakeDeps.settlePendingRead(2);
      });
      await screen.findByRole("heading", { name: "버전2" });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      // 이전 재읽기(pending[1]) 늦게 reject — stale guard가 notice를 억제해야 한다
      act(() => {
        fakeDeps.settlePendingRead(1);
      });
      await act(async () => {});

      expect(screen.getByRole("heading", { name: "버전2" })).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    test("새 문서를 여는 동안 이전 문서의 변경 이벤트가 와도 열기가 완료됩니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/a.md", "/tmp/b.md"],
        files: { "/tmp/a.md": "# 문서A", "/tmp/b.md": "# 문서B" },
        deferWatching: true,
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      act(() => {
        fakeDeps.settlePendingWatching({ index: 0, canonicalPath: "/tmp/a.md" });
      });
      await screen.findByRole("heading", { name: "문서A" });

      // B 열기 시작 — startWatching이 pending인 동안 A의 변경 이벤트 도착
      act(() => {
        fakeDeps.triggerMenuOpen();
      });
      await act(async () => {});
      fakeDeps.setFileContent({ path: "/tmp/a.md", content: "# 문서A 변경" });
      act(() => {
        fakeDeps.emitFileWatch({ path: "/tmp/a.md", kind: "changed" });
      });
      act(() => {
        fakeDeps.settlePendingWatching({ index: 1, canonicalPath: "/tmp/b.md" });
      });

      expect(await screen.findByRole("heading", { name: "문서B" })).toBeInTheDocument();
      await user.click(screen.getByRole("tab", { name: "a.md (/tmp/a.md)" }));

      expect(await screen.findByRole("heading", { name: "문서A 변경" })).toBeInTheDocument();
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
      expect(screen.getByRole("heading", { name: "버전1" })).toBeInTheDocument();
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
      expect(screen.getByRole("heading", { name: "버전1" })).toBeInTheDocument();
    });

    test("비활성 탭이 삭제되면 선택 시 삭제 배너를 보여주고 내용을 유지합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        osOpenedPaths: ["/tmp/a.md", "/tmp/b.md"],
        files: {
          "/tmp/a.md": "# 문서A",
          "/tmp/b.md": "# 문서B",
        },
      });
      render(<App {...fakeDeps.props} />);
      await screen.findByRole("heading", { name: "문서B" });

      act(() => {
        fakeDeps.emitFileWatch({ path: "/tmp/a.md", kind: "removed" });
      });

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      await user.click(screen.getByRole("tab", { name: "a.md 삭제됨 (/tmp/a.md)" }));

      expect(screen.getByRole("alert")).toHaveTextContent(/삭제/);
      expect(screen.getByRole("heading", { name: "문서A" })).toBeInTheDocument();
    });

    test("global notice가 active tab notice보다 우선 렌더됩니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        osOpenedPaths: ["/tmp/a.md", "/tmp/b.md"],
        files: {
          "/tmp/a.md": "# 문서A",
          "/tmp/b.md": "# 문서B\n\n[보고서](report.pdf)",
        },
        failOpenWithOS: true,
      });
      render(<App {...fakeDeps.props} />);
      await screen.findByRole("link", { name: "보고서" });

      act(() => {
        fakeDeps.emitFileWatch({ path: "/tmp/a.md", kind: "removed" });
      });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      await user.click(screen.getByRole("link", { name: "보고서" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(/열기 실패/);

      await user.click(screen.getByRole("tab", { name: "a.md 삭제됨 (/tmp/a.md)" }));

      expect(screen.getByRole("alert")).toHaveTextContent(/열기 실패/);
      expect(screen.getByRole("alert")).not.toHaveTextContent(/삭제/);
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

      fakeDeps.setFileContent({ path: "/tmp/note.md", content: "# 버전2" });
      act(() => {
        fakeDeps.emitFileWatch({ path: "/tmp/note.md", kind: "changed" });
      });

      expect(await screen.findByRole("heading", { name: "버전2" })).toBeInTheDocument();
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
      expect(screen.getByRole("heading", { name: "버전1" })).toBeInTheDocument();
    });

    test("삭제 배너는 진행 중이던 stale 재읽기가 지우지 못합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/note.md"],
        files: { "/tmp/note.md": "# 버전1" },
        deferReads: true,
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      act(() => {
        fakeDeps.settlePendingRead(0);
      });
      await screen.findByRole("heading", { name: "버전1" });

      // 재읽기가 in-flight인 상태에서 removed 도착
      act(() => {
        fakeDeps.emitFileWatch({ path: "/tmp/note.md", kind: "changed" });
      }); // pendingReads[1]
      act(() => {
        fakeDeps.emitFileWatch({ path: "/tmp/note.md", kind: "removed" });
      });
      await screen.findByRole("alert");

      act(() => {
        fakeDeps.settlePendingRead(1); // stale 읽기가 늦게 resolve
      });
      await act(async () => {});

      expect(screen.getByRole("alert")).toHaveTextContent(/삭제/);
    });
  });

  context("OS가 파일 열기를 전달한 경우", () => {
    test("콜드 스타트 버퍼의 여러 마크다운 파일을 모두 열고 마지막 파일을 활성화합니다.", async () => {
      const fakeDeps = createFakeDeps({
        files: {
          "/tmp/a.md": "# 첫 번째 파일",
          "/tmp/b.md": "# 마지막 파일",
        },
        osOpenedPaths: ["/tmp/a.md", "/tmp/b.md"],
      });
      render(<App {...fakeDeps.props} />);

      expect(await screen.findByRole("heading", { name: "마지막 파일" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "a.md (/tmp/a.md)" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "b.md (/tmp/b.md)" })).toBeInTheDocument();
      expect(fakeDeps.readPaths).toEqual(["/tmp/a.md", "/tmp/b.md"]);
    });

    test("콜드 스타트 버퍼가 비어 있으면 아무것도 하지 않습니다.", async () => {
      const fakeDeps = createFakeDeps({});
      render(<App {...fakeDeps.props} />);
      await act(async () => {});

      expect(fakeDeps.readPaths).toHaveLength(0);
      expect(screen.getByRole("button", { name: /파일 열기/ })).toBeInTheDocument();
    });

    test("실행 중 전달되면 새 탭을 만들고 활성화합니다.", async () => {
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

      expect(await screen.findByRole("heading", { name: "새 문서" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "old.md (/tmp/old.md)" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "new.md (/tmp/new.md)" })).toBeInTheDocument();
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

      expect(screen.getByRole("heading", { name: "같은 문서" })).toBeInTheDocument();
      expect(screen.getAllByRole("tab", { name: "a.md (/tmp/a.md)" })).toHaveLength(1);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  context("탭을 닫는 경우", () => {
    test("active 탭을 닫으면 다음 탭을 활성화하고 watch를 중지합니다.", async () => {
      const fakeDeps = createFakeDeps({
        files: {
          "/tmp/a.md": "# 문서A",
          "/tmp/b.md": "# 문서B",
          "/tmp/c.md": "# 문서C",
        },
        osOpenedPaths: ["/tmp/a.md", "/tmp/b.md", "/tmp/c.md"],
      });
      render(<App {...fakeDeps.props} />);
      await screen.findByRole("heading", { name: "문서C" });

      await userEvent.click(screen.getByRole("tab", { name: "b.md (/tmp/b.md)" }));
      await screen.findByRole("heading", { name: "문서B" });
      await userEvent.click(screen.getByRole("button", { name: "b.md 닫기 (/tmp/b.md)" }));

      expect(await screen.findByRole("heading", { name: "문서C" })).toBeInTheDocument();
      expect(screen.queryByRole("tab", { name: "b.md (/tmp/b.md)" })).not.toBeInTheDocument();
      expect(fakeDeps.stoppedWatchPaths).toEqual(["/tmp/b.md"]);
    });

    test("마지막 탭을 닫으면 빈 상태로 돌아갑니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/a.md"],
        files: { "/tmp/a.md": "# 문서A" },
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("heading", { name: "문서A" });

      await user.click(screen.getByRole("button", { name: "a.md 닫기 (/tmp/a.md)" }));

      expect(screen.getByRole("button", { name: /파일 열기/ })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "문서A" })).not.toBeInTheDocument();
      expect(fakeDeps.stoppedWatchPaths).toEqual(["/tmp/a.md"]);
    });
  });

  context("파일 watch 시작 조건", () => {
    test("watch가 실패해도 열람은 진행되고, 원래 경로로 오는 이벤트를 인식합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/note.md"],
        files: { "/tmp/note.md": "# 제목" },
        failWatching: true,
      });
      render(<App {...fakeDeps.props} />);

      await user.click(screen.getByRole("button", { name: /파일 열기/ }));

      // watch 실패에도 불구하고 문서가 열려야 한다
      expect(await screen.findByRole("heading", { name: "제목" })).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      // fallback으로 원래 경로가 식별자 — changed 이벤트가 반영되어야 한다
      fakeDeps.setFileContent({ path: "/tmp/note.md", content: "# 수정됨" });
      act(() => {
        fakeDeps.emitFileWatch({ path: "/tmp/note.md", kind: "changed" });
      });

      expect(await screen.findByRole("heading", { name: "수정됨" })).toBeInTheDocument();
    });

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

      fakeDeps.setFileContent({
        path: "/private/tmp/note.md",
        content: "# 버전2",
      });
      act(() => {
        fakeDeps.emitFileWatch({ path: "/private/tmp/note.md", kind: "changed" });
      });

      expect(await screen.findByRole("heading", { name: "버전2" })).toBeInTheDocument();
    });
  });

  context("본문 링크를 클릭하는 경우", () => {
    test("외부 링크는 openExternal로 엽니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/docs/index.md"],
        files: { "/tmp/docs/index.md": "[공식 문서](https://tauri.app/)" },
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("link", { name: "공식 문서" });

      await user.click(screen.getByRole("link", { name: "공식 문서" }));

      expect(fakeDeps.externalUrls).toEqual(["https://tauri.app/"]);
      expect(fakeDeps.osOpenedFilePaths).toHaveLength(0);
    });

    test("상대 경로 마크다운 링크는 현재 문서 디렉터리 기준으로 새 탭을 엽니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/docs/index.md"],
        files: {
          "/tmp/docs/index.md": "[다음 문서](other.md)",
          "/tmp/docs/other.md": "# 다음 문서 내용",
        },
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("link", { name: "다음 문서" });

      await user.click(screen.getByRole("link", { name: "다음 문서" }));

      expect(await screen.findByRole("heading", { name: "다음 문서 내용" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "index.md (/tmp/docs/index.md)" })).toHaveAttribute(
        "aria-selected",
        "false",
      );
      expect(screen.getByRole("tab", { name: "other.md (/tmp/docs/other.md)" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(fakeDeps.readPaths).toEqual(["/tmp/docs/index.md", "/tmp/docs/other.md"]);
      expect(fakeDeps.watchedPaths).toEqual(["/tmp/docs/index.md", "/tmp/docs/other.md"]);
    });

    test("이미 열린 마크다운 링크를 클릭하면 기존 탭을 활성화합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/docs/index.md", "/tmp/docs/other.md"],
        files: {
          "/tmp/docs/index.md": "[다음 문서](other.md)",
          "/tmp/docs/other.md": "# 다음 문서 내용",
        },
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("link", { name: "다음 문서" });
      await user.click(screen.getByRole("button", { name: "파일 열기" }));
      await screen.findByRole("heading", { name: "다음 문서 내용" });
      await user.click(screen.getByRole("tab", { name: "index.md (/tmp/docs/index.md)" }));

      await user.click(screen.getByRole("link", { name: "다음 문서" }));

      expect(screen.getByRole("heading", { name: "다음 문서 내용" })).toBeInTheDocument();
      expect(screen.getAllByRole("tab", { name: "other.md (/tmp/docs/other.md)" })).toHaveLength(1);
      expect(screen.getByRole("tab", { name: "other.md (/tmp/docs/other.md)" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });

    test("./ 접두사 경로는 정규화 없이 그대로 조합합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/docs/index.md"],
        files: {
          "/tmp/docs/index.md": "[다음 문서](./other.md)",
          "/tmp/docs/./other.md": "# 점 경로 내용",
        },
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("link", { name: "다음 문서" });

      await user.click(screen.getByRole("link", { name: "다음 문서" }));

      expect(await screen.findByRole("heading", { name: "점 경로 내용" })).toBeInTheDocument();
      expect(fakeDeps.readPaths.at(-1)).toBe("/tmp/docs/./other.md");
    });

    test("../ 상위 경로도 정규화 없이 그대로 조합합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/docs/index.md"],
        files: {
          "/tmp/docs/index.md": "[상위 문서](../sibling.md)",
          "/tmp/docs/../sibling.md": "# 상위 경로 내용",
        },
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("link", { name: "상위 문서" });

      await user.click(screen.getByRole("link", { name: "상위 문서" }));

      // ".."를 정규화하지 않는다 — OS가 해석하고 canonicalize가 식별자를 정리한다 (스펙 §2)
      expect(await screen.findByRole("heading", { name: "상위 경로 내용" })).toBeInTheDocument();
      expect(fakeDeps.readPaths.at(-1)).toBe("/tmp/docs/../sibling.md");
    });

    test("percent-encoded 한글 링크를 디코딩해 엽니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/docs/index.md"],
        files: {
          "/tmp/docs/index.md": "[한글 노트](한글%20노트.md)",
          "/tmp/docs/한글 노트.md": "# 한글 내용",
        },
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("link", { name: "한글 노트" });

      await user.click(screen.getByRole("link", { name: "한글 노트" }));

      expect(await screen.findByRole("heading", { name: "한글 내용" })).toBeInTheDocument();
      expect(fakeDeps.readPaths.at(-1)).toBe("/tmp/docs/한글 노트.md");
    });

    test("비마크다운 링크는 OS 기본 앱으로 열고 문서는 유지합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/docs/index.md"],
        files: { "/tmp/docs/index.md": "# 현재 문서\n\n[보고서](report.pdf)" },
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("link", { name: "보고서" });

      await user.click(screen.getByRole("link", { name: "보고서" }));
      await act(async () => {});

      expect(fakeDeps.osOpenedFilePaths).toEqual(["/tmp/docs/report.pdf"]);
      expect(fakeDeps.readPaths).toEqual(["/tmp/docs/index.md"]);
      expect(screen.getByRole("heading", { name: "현재 문서" })).toBeInTheDocument();
    });

    test("비마크다운 열기에 실패하면 read-error 배너를 띄우고 문서를 유지합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/docs/index.md"],
        files: { "/tmp/docs/index.md": "# 현재 문서\n\n[보고서](report.pdf)" },
        failOpenWithOS: true,
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("link", { name: "보고서" });

      await user.click(screen.getByRole("link", { name: "보고서" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(/열기 실패/);
      expect(screen.getByRole("heading", { name: "현재 문서" })).toBeInTheDocument();
    });

    test("절대 경로 링크는 무시합니다.", async () => {
      const user = userEvent.setup();
      const fakeDeps = createFakeDeps({
        pickedPaths: ["/tmp/docs/index.md"],
        files: { "/tmp/docs/index.md": "[절대](/abs/file.md)" },
      });
      render(<App {...fakeDeps.props} />);
      await user.click(screen.getByRole("button", { name: /파일 열기/ }));
      await screen.findByRole("link", { name: "절대" });

      await user.click(screen.getByRole("link", { name: "절대" }));
      await act(async () => {});

      expect(fakeDeps.externalUrls).toHaveLength(0);
      expect(fakeDeps.osOpenedFilePaths).toHaveLength(0);
      expect(fakeDeps.readPaths).toEqual(["/tmp/docs/index.md"]);
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
  /** true면 startWatching이 즉시 resolve하지 않고 pendingWatchings에 쌓인다 */
  deferWatching?: boolean;
  /** true면 startWatching이 항상 reject한다 (watch 실패 시 열람 진행 검증용) */
  failWatching?: boolean;
  /** fake startWatching이 반환할 canonical 경로의 접두사 (기본 "" = 경로 그대로) */
  canonicalPrefix?: string;
  /** 콜드 스타트 버퍼 — fake fetchOpenedFiles가 한 번 읽고 비운다(drain 의미론) */
  osOpenedPaths?: string[];
  /** true면 openWithOS가 reject한다 (깨진 비마크다운 링크 배너 검증용) */
  failOpenWithOS?: boolean;
};

function createFakeDeps({
  pickedPaths = [],
  files = {},
  deferReads = false,
  deferWatching = false,
  failWatching = false,
  canonicalPrefix = "",
  osOpenedPaths = [],
  failOpenWithOS = false,
}: CreateFakeDepsParams) {
  const remainingPicks = [...pickedPaths];
  const readPaths: string[] = [];
  const watchedPaths: string[] = [];
  const stoppedWatchPaths: string[] = [];
  const externalUrls: string[] = [];
  const osOpenedFilePaths: string[] = [];
  const pendingReads: Array<{ settle: () => void }> = [];
  const pendingWatchings: Array<{ settle: (path: string) => void }> = [];
  const fakeSubscriber = createFakeDragDropSubscriber();
  let menuOpenHandler: (() => void) | null = null;
  let fileWatchHandler: ((payload: FileWatchPayload) => void) | null = null;
  const remainingOsOpened = [...osOpenedPaths];
  let openedHandler: ((args: { paths: string[] }) => void) | null = null;
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
      if (failWatching) {
        return Promise.reject(new Error("watch 실패"));
      }
      if (!deferWatching) {
        return Promise.resolve(`${canonicalPrefix}${path}`);
      }
      return new Promise<string>((resolve) => {
        pendingWatchings.push({
          settle: (canonicalPath: string) => {
            resolve(canonicalPath);
          },
        });
      });
    },
    stopWatching: ({ path }: { path: string }) => {
      stoppedWatchPaths.push(path);
      return Promise.resolve();
    },
    subscribeFileWatch: ({ onEvent }: { onEvent: (payload: FileWatchPayload) => void }) => {
      fileWatchHandler = onEvent;
      return Promise.resolve(() => {
        fileWatchHandler = null;
      });
    },
    fetchOpenedFiles: () => {
      const drained = [...remainingOsOpened];
      remainingOsOpened.length = 0;
      return Promise.resolve(drained);
    },
    subscribeOpened: ({ onOpen }: { onOpen: (args: { paths: string[] }) => void }) => {
      openedHandler = onOpen;
      return Promise.resolve(() => {
        openedHandler = null;
      });
    },
    openExternal: ({ url }: { url: string }) => {
      externalUrls.push(url);
      return Promise.resolve();
    },
    openWithOS: ({ path }: { path: string }) => {
      osOpenedFilePaths.push(path);
      if (failOpenWithOS) {
        return Promise.reject(new Error(`열기 실패: ${path}`));
      }
      return Promise.resolve();
    },
  };
  return {
    props,
    readPaths,
    watchedPaths,
    stoppedWatchPaths,
    externalUrls,
    osOpenedFilePaths,
    emitDragDrop: fakeSubscriber.emit,
    triggerMenuOpen: () => {
      menuOpenHandler?.();
    },
    emitFileWatch: (payload: FileWatchPayload) => {
      fileWatchHandler?.(payload);
    },
    emitOpened: (paths: string[]) => {
      openedHandler?.({ paths });
    },
    setFileContent: ({ path, content }: { path: string; content: string }) => {
      files[path] = content;
    },
    removeFile: (path: string) => {
      delete files[path];
    },
    settlePendingRead: (index: number) => {
      const pending = pendingReads[index];
      if (pending === undefined) {
        throw new Error(`대기 중인 읽기가 없습니다: index ${index}`);
      }
      pending.settle();
    },
    settlePendingWatching: ({ index, canonicalPath }: { index: number; canonicalPath: string }) => {
      const pending = pendingWatchings[index];
      if (pending === undefined) {
        throw new Error(`대기 중인 watch가 없습니다: index ${index}`);
      }
      pending.settle(canonicalPath);
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
