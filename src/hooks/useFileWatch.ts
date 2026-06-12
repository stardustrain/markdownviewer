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
