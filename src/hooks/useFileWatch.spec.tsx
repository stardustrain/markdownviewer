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
