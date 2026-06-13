import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TabBar, type TabBarTab } from "./TabBar";

const context = describe;

describe("TabBar", () => {
  context("탭이 있는 경우", () => {
    test("탭 목록과 활성 탭을 렌더합니다.", () => {
      render(
        <TabBar
          tabs={createTabs()}
          activeTabId="tab-a"
          onSelectTab={noopSelect}
          onCloseTab={noopClose}
          onOpenFile={noopOpen}
        />,
      );

      expect(screen.getByRole("tablist", { name: "열린 문서" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "a.md (/tmp/a.md)" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("tab", { name: "b.md (/tmp/b.md)" })).toHaveAttribute("aria-selected", "false");
    });

    test("탭 클릭 시 선택 콜백을 호출합니다.", async () => {
      const user = userEvent.setup();
      const selectedIds: string[] = [];
      render(
        <TabBar
          tabs={createTabs()}
          activeTabId="tab-a"
          onSelectTab={({ id }) => {
            selectedIds.push(id);
          }}
          onCloseTab={noopClose}
          onOpenFile={noopOpen}
        />,
      );

      await user.click(screen.getByRole("tab", { name: "b.md (/tmp/b.md)" }));

      expect(selectedIds).toEqual(["tab-b"]);
    });

    test("닫기 버튼 클릭 시 닫기 콜백만 호출합니다.", async () => {
      const user = userEvent.setup();
      const selectedIds: string[] = [];
      const closedIds: string[] = [];
      render(
        <TabBar
          tabs={createTabs()}
          activeTabId="tab-a"
          onSelectTab={({ id }) => {
            selectedIds.push(id);
          }}
          onCloseTab={({ id }) => {
            closedIds.push(id);
          }}
          onOpenFile={noopOpen}
        />,
      );

      await user.click(screen.getByRole("button", { name: "a.md 닫기 (/tmp/a.md)" }));

      expect(closedIds).toEqual(["tab-a"]);
      expect(selectedIds).toEqual([]);
    });

    test("열기 버튼 클릭 시 파일 열기 콜백을 호출합니다.", async () => {
      const user = userEvent.setup();
      let openCount = 0;
      render(
        <TabBar
          tabs={createTabs()}
          activeTabId="tab-a"
          onSelectTab={noopSelect}
          onCloseTab={noopClose}
          onOpenFile={() => {
            openCount += 1;
          }}
        />,
      );

      await user.click(screen.getByRole("button", { name: "파일 열기" }));

      expect(openCount).toBe(1);
    });

    test("삭제된 탭은 접근성 이름과 화면 텍스트에 상태를 표시합니다.", () => {
      render(
        <TabBar
          tabs={[{ ...createTabs()[0], status: "deleted" }]}
          activeTabId="tab-a"
          onSelectTab={noopSelect}
          onCloseTab={noopClose}
          onOpenFile={noopOpen}
        />,
      );

      expect(screen.getByRole("tab", { name: "a.md 삭제됨 (/tmp/a.md)" })).toBeInTheDocument();
      expect(screen.getByText("삭제됨")).toBeInTheDocument();
    });

    test("children을 tabpanel로 렌더합니다.", () => {
      render(
        <TabBar
          tabs={createTabs()}
          activeTabId="tab-a"
          onSelectTab={noopSelect}
          onCloseTab={noopClose}
          onOpenFile={noopOpen}
        >
          <p>문서 본문</p>
        </TabBar>,
      );

      expect(screen.getByRole("tabpanel")).toHaveTextContent("문서 본문");
    });

    test("tabpanel은 sticky 탭 헤더 밖에 렌더합니다.", () => {
      render(
        <TabBar
          tabs={createTabs()}
          activeTabId="tab-a"
          onSelectTab={noopSelect}
          onCloseTab={noopClose}
          onOpenFile={noopOpen}
        >
          <p>문서 본문</p>
        </TabBar>,
      );

      expect(screen.getByRole("tabpanel").closest(".tabbar")).toBeNull();
    });

    test("닫기 버튼과 열기 버튼은 tablist 밖에 렌더합니다.", () => {
      render(
        <TabBar
          tabs={createTabs()}
          activeTabId="tab-a"
          onSelectTab={noopSelect}
          onCloseTab={noopClose}
          onOpenFile={noopOpen}
        />,
      );

      const tabList = screen.getByRole("tablist", { name: "열린 문서" });
      expect(tabList).not.toContainElement(screen.getByRole("button", { name: "a.md 닫기 (/tmp/a.md)" }));
      expect(tabList).not.toContainElement(screen.getByRole("button", { name: "파일 열기" }));
    });
  });
});

function createTabs(): TabBarTab[] {
  return [
    { id: "tab-a", title: "a.md", path: "/tmp/a.md", status: "ready" },
    { id: "tab-b", title: "b.md", path: "/tmp/b.md", status: "ready" },
  ];
}

function noopSelect() {
  // 선택 동작을 검증하지 않는 테스트용 no-op
}

function noopClose() {
  // 닫기 동작을 검증하지 않는 테스트용 no-op
}

function noopOpen() {
  // 열기 동작을 검증하지 않는 테스트용 no-op
}
