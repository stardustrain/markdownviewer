/**
 * @fileoverview Tauri 웹뷰의 네이티브 파일 drag-drop 이벤트를 구독하는 hook입니다.
 * 'drop'이면 onDrop에 절대 경로 배열을 전달하고, 'enter'/'over'/'leave'로 isDragging 상태를 관리합니다.
 * subscribe를 주입(DI)할 수 있어 테스트에서 모킹 없이 가짜 구독자를 쓸 수 있고,
 * 기본값은 getCurrentWebview().onDragDropEvent입니다(권한은 기존 core:default로 충분).
 * 주의: onDrop/subscribe는 참조가 안정적이어야 한다(불안정하면 재구독 race) — App은 useCallback으로 전달한다.
 */
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useState } from "react";

export type DragDropPayload =
  | { type: "enter"; paths: string[] }
  | { type: "over" }
  | { type: "drop"; paths: string[] }
  | { type: "leave" };

export type DragDropSubscriber = (args: {
  onEvent: (payload: DragDropPayload) => void;
}) => Promise<() => void>;

type UseFileDropParams = {
  /** 'drop' 이벤트의 절대 경로 배열을 받는다 */
  onDrop: (args: { paths: string[] }) => void;
  /** drag-drop 이벤트 구독 함수
   * @default Tauri 웹뷰 구독(subscribeToWebviewDragDrop)
   */
  subscribe?: DragDropSubscriber;
};

export function useFileDrop({
  onDrop,
  subscribe = subscribeToWebviewDragDrop,
}: UseFileDropParams): boolean {
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const unlistenPromise = subscribe({
      onEvent: (payload) => {
        if (payload.type === "drop") {
          setIsDragging(false);
          onDrop({ paths: payload.paths });
          return;
        }
        if (payload.type === "enter" || payload.type === "over") {
          setIsDragging(true);
          return;
        }
        setIsDragging(false);
      },
    });
    return () => {
      unlistenPromise.then((unlisten) => {
        unlisten();
      });
    };
  }, [onDrop, subscribe]);

  return isDragging;
}

function subscribeToWebviewDragDrop({
  onEvent,
}: {
  onEvent: (payload: DragDropPayload) => void;
}): Promise<() => void> {
  return getCurrentWebview().onDragDropEvent((event) => {
    onEvent(event.payload);
  });
}
