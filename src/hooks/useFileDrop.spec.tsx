import { act, renderHook } from "@testing-library/react";
import {
  type DragDropPayload,
  type DragDropSubscriber,
  useFileDrop,
} from "./useFileDrop";

const context = describe;

describe("useFileDrop", () => {
  context("drop 이벤트가 온 경우", () => {
    test("onDrop에 paths를 전달하고 isDragging은 false입니다.", () => {
      const fakeSubscriber = createFakeDragDropSubscriber();
      const droppedPaths: string[][] = [];
      const { result } = renderHook(() =>
        useFileDrop({
          onDrop: ({ paths }) => {
            droppedPaths.push(paths);
          },
          subscribe: fakeSubscriber.subscribe,
        }),
      );

      act(() => {
        fakeSubscriber.emit({ type: "drop", paths: ["/tmp/note.md"] });
      });

      expect(droppedPaths).toEqual([["/tmp/note.md"]]);
      expect(result.current).toBe(false);
    });
  });

  context("드래그가 진행 중인 경우", () => {
    const dragInProgressCases: Array<[string, DragDropPayload]> = [
      ["enter", { type: "enter", paths: ["/tmp/note.md"] }],
      ["over", { type: "over" }],
    ];

    test.each(dragInProgressCases)(
      "%s 이벤트가 오면 isDragging이 true가 됩니다.",
      (_eventType, payload) => {
        const fakeSubscriber = createFakeDragDropSubscriber();
        const { result } = renderHook(() =>
          useFileDrop({ onDrop: noopDrop, subscribe: fakeSubscriber.subscribe }),
        );

        act(() => {
          fakeSubscriber.emit(payload);
        });

        expect(result.current).toBe(true);
      },
    );
  });

  context("드래그가 취소된 경우", () => {
    test("leave 이벤트가 오면 isDragging이 false로 돌아갑니다.", () => {
      const fakeSubscriber = createFakeDragDropSubscriber();
      const { result } = renderHook(() =>
        useFileDrop({ onDrop: noopDrop, subscribe: fakeSubscriber.subscribe }),
      );

      act(() => {
        fakeSubscriber.emit({ type: "enter", paths: [] });
      });
      act(() => {
        fakeSubscriber.emit({ type: "leave" });
      });

      expect(result.current).toBe(false);
    });
  });

  context("hook이 unmount되는 경우", () => {
    test("구독 해제 함수(unlisten)를 호출합니다.", async () => {
      const fakeSubscriber = createFakeDragDropSubscriber();
      const { unmount } = renderHook(() =>
        useFileDrop({ onDrop: noopDrop, subscribe: fakeSubscriber.subscribe }),
      );

      unmount();
      // unlisten은 subscribe가 반환한 Promise의 then에서 호출되므로 microtask를 비운다
      await act(async () => {});

      expect(fakeSubscriber.getUnlistenCount()).toBe(1);
    });
  });
});

function noopDrop() {
  // 드롭을 검증하지 않는 테스트용 no-op
}

function createFakeDragDropSubscriber() {
  let registeredHandler: ((payload: DragDropPayload) => void) | null = null;
  let unlistenCount = 0;
  const subscribe: DragDropSubscriber = ({ onEvent }) => {
    registeredHandler = onEvent;
    return Promise.resolve(() => {
      unlistenCount += 1;
    });
  };
  return {
    subscribe,
    emit: (payload: DragDropPayload) => {
      registeredHandler?.(payload);
    },
    getUnlistenCount: () => unlistenCount,
  };
}
