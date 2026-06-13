/**
 * @fileoverview 문서 탭 목록에서 제목, 중복 탭, 마크다운 경로, 닫기 후 활성 탭을 계산합니다.
 */

import { isMarkdownPath } from "./isMarkdownPath";

export type TabIdentity = {
  id: string;
  path: string;
};

export function getFileTitle({ path }: { path: string }): string {
  const slashIndex = path.lastIndexOf("/");
  const title = slashIndex === -1 ? path : path.slice(slashIndex + 1);
  return title === "" ? path : title;
}

export function findTabByPath({ tabs, path }: { tabs: TabIdentity[]; path: string }): TabIdentity | null {
  return tabs.find((tab) => tab.path === path) ?? null;
}

export function getMarkdownPaths({ paths }: { paths: string[] }): string[] {
  return paths.filter((path) => isMarkdownPath({ path }));
}

export function getNextActiveTabIdAfterClose({
  tabs,
  closedTabId,
  activeTabId,
}: {
  tabs: TabIdentity[];
  closedTabId: string;
  activeTabId: string | null;
}): string | null {
  if (activeTabId !== closedTabId) {
    return activeTabId;
  }
  const closedIndex = tabs.findIndex((tab) => tab.id === closedTabId);
  if (closedIndex === -1) {
    return activeTabId;
  }
  const remainingTabs = tabs.filter((tab) => tab.id !== closedTabId);
  if (remainingTabs.length === 0) {
    return null;
  }
  const nextTab = remainingTabs[Math.min(closedIndex, remainingTabs.length - 1)];
  return nextTab.id;
}
