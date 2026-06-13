import {
  findTabByPath,
  getFileTitle,
  getMarkdownPaths,
  getNextActiveTabIdAfterClose,
  type TabIdentity,
} from "./documentTabs";

const context = describe;

describe("documentTabs", () => {
  context("getFileTitle", () => {
    test("마지막 경로 조각을 제목으로 사용합니다.", () => {
      expect(getFileTitle({ path: "/tmp/docs/index.md" })).toBe("index.md");
    });

    test("파일명이 비어 있으면 전체 경로를 제목으로 사용합니다.", () => {
      expect(getFileTitle({ path: "/tmp/docs/" })).toBe("/tmp/docs/");
    });
  });

  context("findTabByPath", () => {
    test("같은 경로의 기존 탭을 찾습니다.", () => {
      const tabs: TabIdentity[] = [
        { id: "tab-a", path: "/tmp/a.md" },
        { id: "tab-b", path: "/tmp/b.md" },
      ];

      expect(findTabByPath({ tabs, path: "/tmp/b.md" })).toEqual({
        id: "tab-b",
        path: "/tmp/b.md",
      });
    });

    test("같은 경로의 탭이 없으면 null을 반환합니다.", () => {
      const tabs: TabIdentity[] = [{ id: "tab-a", path: "/tmp/a.md" }];

      expect(findTabByPath({ tabs, path: "/tmp/missing.md" })).toBeNull();
    });
  });

  context("getMarkdownPaths", () => {
    test("마크다운 경로만 원래 순서대로 반환합니다.", () => {
      expect(
        getMarkdownPaths({
          paths: ["/tmp/a.png", "/tmp/b.md", "/tmp/c.markdown", "/tmp/d.mdx"],
        }),
      ).toEqual(["/tmp/b.md", "/tmp/c.markdown", "/tmp/d.mdx"]);
    });
  });

  context("getNextActiveTabIdAfterClose", () => {
    test("비활성 탭을 닫으면 기존 활성 탭을 유지합니다.", () => {
      const tabs: TabIdentity[] = [
        { id: "tab-a", path: "/tmp/a.md" },
        { id: "tab-b", path: "/tmp/b.md" },
        { id: "tab-c", path: "/tmp/c.md" },
      ];

      expect(
        getNextActiveTabIdAfterClose({
          tabs,
          closedTabId: "tab-a",
          activeTabId: "tab-b",
        }),
      ).toBe("tab-b");
    });

    test("활성 탭을 닫으면 오른쪽 탭을 활성화합니다.", () => {
      const tabs: TabIdentity[] = [
        { id: "tab-a", path: "/tmp/a.md" },
        { id: "tab-b", path: "/tmp/b.md" },
        { id: "tab-c", path: "/tmp/c.md" },
      ];

      expect(
        getNextActiveTabIdAfterClose({
          tabs,
          closedTabId: "tab-b",
          activeTabId: "tab-b",
        }),
      ).toBe("tab-c");
    });

    test("마지막 활성 탭을 닫으면 왼쪽 탭을 활성화합니다.", () => {
      const tabs: TabIdentity[] = [
        { id: "tab-a", path: "/tmp/a.md" },
        { id: "tab-b", path: "/tmp/b.md" },
      ];

      expect(
        getNextActiveTabIdAfterClose({
          tabs,
          closedTabId: "tab-b",
          activeTabId: "tab-b",
        }),
      ).toBe("tab-a");
    });

    test("마지막 남은 탭을 닫으면 null을 반환합니다.", () => {
      const tabs: TabIdentity[] = [{ id: "tab-a", path: "/tmp/a.md" }];

      expect(
        getNextActiveTabIdAfterClose({
          tabs,
          closedTabId: "tab-a",
          activeTabId: "tab-a",
        }),
      ).toBeNull();
    });
  });
});
