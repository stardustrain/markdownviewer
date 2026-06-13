import * as Tabs from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

export type TabBarTab = {
  id: string;
  title: string;
  path: string;
  status: "ready" | "deleted";
};

type TabBarProps = {
  tabs: TabBarTab[];
  activeTabId: string | null;
  onSelectTab: (args: { id: string }) => void;
  onCloseTab: (args: { id: string }) => void;
  onOpenFile: () => void;
  children?: ReactNode;
};

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onOpenFile, children }: TabBarProps) {
  if (tabs.length === 0 || activeTabId === null) {
    return null;
  }

  return (
    <Tabs.Root activationMode="manual" value={activeTabId} onValueChange={(id) => onSelectTab({ id })}>
      <div className="tabbar">
        <div className="tabbar-strip">
          <div className="tabbar-tabs">
            <Tabs.List className="tabbar-list" aria-label="열린 문서">
              {tabs.map((tab) => (
                <Tabs.Trigger
                  aria-label={
                    tab.status === "deleted" ? `${tab.title} 삭제됨 (${tab.path})` : `${tab.title} (${tab.path})`
                  }
                  className="tabbar-item tabbar-trigger"
                  key={tab.id}
                  value={tab.id}
                  title={tab.path}
                >
                  <span className="tabbar-title">{tab.title}</span>
                  {tab.status === "deleted" && <span className="tabbar-status">삭제됨</span>}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            <div className="tabbar-close-list">
              {tabs.map((tab) => (
                <div
                  className="tabbar-close-slot"
                  data-state={tab.id === activeTabId ? "active" : "inactive"}
                  key={tab.id}
                >
                  <button
                    aria-label={`${tab.title} 닫기 (${tab.path})`}
                    className="tabbar-close"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCloseTab({ id: tab.id });
                    }}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
          <button aria-label="파일 열기" className="tabbar-open" onClick={onOpenFile} type="button">
            +
          </button>
        </div>
      </div>
      {children !== undefined && (
        <Tabs.Content className="tabbar-panel" value={activeTabId}>
          {children}
        </Tabs.Content>
      )}
    </Tabs.Root>
  );
}
