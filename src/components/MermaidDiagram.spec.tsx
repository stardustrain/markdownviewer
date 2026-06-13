import { act, render, screen } from "@testing-library/react";
import type { RenderMermaidDiagramParams } from "../lib/renderMermaidDiagram";
import { type ColorSchemeSubscriber, MermaidDiagram } from "./MermaidDiagram";

const context = describe;

describe("MermaidDiagram", () => {
  context("렌더가 완료되기 전인 경우", () => {
    test("원본 코드를 코드블록으로 표시합니다.", () => {
      const renderer = createManualRenderer();
      const colorScheme = createFakeColorScheme({ isDark: false });
      const { container } = render(
        <MermaidDiagram
          code={"graph TD\n  A --> B"}
          renderDiagram={renderer.renderDiagram}
          subscribeColorScheme={colorScheme.subscribe}
        />,
      );

      expect(container.querySelector("pre code")).toHaveTextContent("A --> B");
      expect(container.querySelector("svg")).toBeNull();
    });
  });

  context("렌더에 성공한 경우", () => {
    test("SVG를 표시하고 원본 코드블록을 제거합니다.", async () => {
      const renderer = createManualRenderer();
      const colorScheme = createFakeColorScheme({ isDark: false });
      const { container } = render(
        <MermaidDiagram
          code={"graph TD"}
          renderDiagram={renderer.renderDiagram}
          subscribeColorScheme={colorScheme.subscribe}
        />,
      );

      const [firstCall] = renderer.calls;
      await act(async () => {
        firstCall.resolve({
          svg: '<svg role="img" aria-label="다이어그램"></svg>',
        });
      });

      expect(screen.getByRole("img", { name: "다이어그램" })).toBeInTheDocument();
      expect(container.querySelector("pre code")).toBeNull();
    });

    test("renderDiagram에 코드 원문·라이트 테마·고유 id를 전달합니다.", () => {
      const renderer = createManualRenderer();
      const colorScheme = createFakeColorScheme({ isDark: false });
      render(
        <MermaidDiagram
          code={"graph TD"}
          renderDiagram={renderer.renderDiagram}
          subscribeColorScheme={colorScheme.subscribe}
        />,
      );

      expect(renderer.calls).toHaveLength(1);
      const [firstCall] = renderer.calls;
      expect(firstCall.code).toBe("graph TD");
      expect(firstCall.theme).toBe("default");
      expect(firstCall.id).not.toBe("");
    });
  });

  context("렌더에 실패한 경우", () => {
    test("에러 메시지와 원본 코드를 함께 표시합니다.", async () => {
      const renderer = createManualRenderer();
      const colorScheme = createFakeColorScheme({ isDark: false });
      const { container } = render(
        <MermaidDiagram
          code={"graph TD"}
          renderDiagram={renderer.renderDiagram}
          subscribeColorScheme={colorScheme.subscribe}
        />,
      );

      const [firstCall] = renderer.calls;
      await act(async () => {
        firstCall.reject(new Error("Parse error on line 1"));
      });

      expect(screen.getByRole("alert")).toHaveTextContent("Parse error on line 1");
      expect(container.querySelector("pre code")).toHaveTextContent("graph TD");
    });

    test("이후 렌더가 성공하면 에러 표시를 해제합니다.", async () => {
      const renderer = createManualRenderer();
      const colorScheme = createFakeColorScheme({ isDark: false });
      render(
        <MermaidDiagram
          code={"graph TD"}
          renderDiagram={renderer.renderDiagram}
          subscribeColorScheme={colorScheme.subscribe}
        />,
      );

      const [firstCall] = renderer.calls;
      await act(async () => {
        firstCall.reject(new Error("Parse error"));
      });
      expect(screen.getByRole("alert")).toBeInTheDocument();

      // 컬러 스킴 변경으로 재렌더를 트리거한다
      act(() => {
        colorScheme.emit({ isDark: true });
      });
      const [, secondCall] = renderer.calls;
      await act(async () => {
        secondCall.resolve({
          svg: '<svg role="img" aria-label="복구된 다이어그램"></svg>',
        });
      });

      expect(screen.getByRole("img", { name: "복구된 다이어그램" })).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  context("code가 변경된 경우", () => {
    test("새 code 인자로 다시 호출하고, 새 렌더가 끝날 때까지 이전 SVG를 유지하다가 교체합니다.", async () => {
      const renderer = createManualRenderer();
      const colorScheme = createFakeColorScheme({ isDark: false });
      const { rerender } = render(
        <MermaidDiagram
          code={"graph TD"}
          renderDiagram={renderer.renderDiagram}
          subscribeColorScheme={colorScheme.subscribe}
        />,
      );
      const [firstCall] = renderer.calls;
      await act(async () => {
        firstCall.resolve({
          svg: '<svg role="img" aria-label="이전 다이어그램"></svg>',
        });
      });

      rerender(
        <MermaidDiagram
          code={"graph LR"}
          renderDiagram={renderer.renderDiagram}
          subscribeColorScheme={colorScheme.subscribe}
        />,
      );

      // 새 렌더가 아직 완료되지 않음 — 이전 SVG가 유지된다 (깜빡임 방지, 스펙 §2)
      expect(screen.getByRole("img", { name: "이전 다이어그램" })).toBeInTheDocument();

      const [, secondCall] = renderer.calls;
      expect(secondCall.code).toBe("graph LR");
      expect(secondCall.id).not.toBe(firstCall.id);
      await act(async () => {
        secondCall.resolve({
          svg: '<svg role="img" aria-label="새 다이어그램"></svg>',
        });
      });

      expect(screen.getByRole("img", { name: "새 다이어그램" })).toBeInTheDocument();
      expect(screen.queryByRole("img", { name: "이전 다이어그램" })).not.toBeInTheDocument();
    });

    test("취소된 이전 렌더가 늦게 완료되어도 결과를 무시합니다.", async () => {
      const renderer = createManualRenderer();
      const colorScheme = createFakeColorScheme({ isDark: false });
      const { rerender } = render(
        <MermaidDiagram
          code={"graph TD"}
          renderDiagram={renderer.renderDiagram}
          subscribeColorScheme={colorScheme.subscribe}
        />,
      );

      // 첫 렌더가 끝나기 전에 code가 바뀐다
      rerender(
        <MermaidDiagram
          code={"graph LR"}
          renderDiagram={renderer.renderDiagram}
          subscribeColorScheme={colorScheme.subscribe}
        />,
      );
      const [firstCall, secondCall] = renderer.calls;
      await act(async () => {
        secondCall.resolve({
          svg: '<svg role="img" aria-label="새 다이어그램"></svg>',
        });
      });

      // 취소됐어야 할 첫 렌더가 늦게 완료된다
      await act(async () => {
        firstCall.resolve({
          svg: '<svg role="img" aria-label="늦은 다이어그램"></svg>',
        });
      });

      expect(screen.getByRole("img", { name: "새 다이어그램" })).toBeInTheDocument();
      expect(screen.queryByRole("img", { name: "늦은 다이어그램" })).not.toBeInTheDocument();
    });

    test("취소된 이전 렌더가 늦게 실패해도 결과를 무시합니다.", async () => {
      const renderer = createManualRenderer();
      const colorScheme = createFakeColorScheme({ isDark: false });
      const { rerender } = render(
        <MermaidDiagram
          code={"graph TD"}
          renderDiagram={renderer.renderDiagram}
          subscribeColorScheme={colorScheme.subscribe}
        />,
      );

      // 첫 렌더가 끝나기 전에 code가 바뀐다
      rerender(
        <MermaidDiagram
          code={"graph LR"}
          renderDiagram={renderer.renderDiagram}
          subscribeColorScheme={colorScheme.subscribe}
        />,
      );
      const [firstCall, secondCall] = renderer.calls;
      await act(async () => {
        secondCall.resolve({
          svg: '<svg role="img" aria-label="새 다이어그램"></svg>',
        });
      });

      // 취소됐어야 할 첫 렌더가 늦게 실패한다
      await act(async () => {
        firstCall.reject(new Error("stale failure"));
      });

      expect(screen.getByRole("img", { name: "새 다이어그램" })).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  context("OS 컬러 스킴이 변경된 경우", () => {
    test("다크로 바뀌면 dark 테마로 다시 렌더합니다.", async () => {
      const renderer = createManualRenderer();
      const colorScheme = createFakeColorScheme({ isDark: false });
      render(
        <MermaidDiagram
          code={"graph TD"}
          renderDiagram={renderer.renderDiagram}
          subscribeColorScheme={colorScheme.subscribe}
        />,
      );

      act(() => {
        colorScheme.emit({ isDark: true });
      });

      expect(renderer.calls).toHaveLength(2);
      const [, secondCall] = renderer.calls;
      expect(secondCall.theme).toBe("dark");
    });
  });

  context("unmount된 경우", () => {
    test("컬러 스킴 구독을 해제합니다.", () => {
      const renderer = createManualRenderer();
      const colorScheme = createFakeColorScheme({ isDark: false });
      const { unmount } = render(
        <MermaidDiagram
          code={"graph TD"}
          renderDiagram={renderer.renderDiagram}
          subscribeColorScheme={colorScheme.subscribe}
        />,
      );
      expect(colorScheme.getListenerCount()).toBe(1);

      unmount();

      expect(colorScheme.getListenerCount()).toBe(0);
    });
  });
});

type ManualRenderCall = RenderMermaidDiagramParams & {
  resolve: (args: { svg: string }) => void;
  reject: (reason: unknown) => void;
};

/** 테스트가 완료 시점을 직접 제어하는 renderDiagram fake */
function createManualRenderer() {
  const calls: ManualRenderCall[] = [];
  function renderDiagram({ id, code, theme }: RenderMermaidDiagramParams): Promise<{ svg: string }> {
    return new Promise((resolve, reject) => {
      calls.push({ id, code, theme, resolve, reject });
    });
  }
  return { calls, renderDiagram };
}

/** 구독 즉시 현재 값을 동기 1회 전달하는 컬러 스킴 fake (스펙 §3.2 계약) */
function createFakeColorScheme({ isDark }: { isDark: boolean }) {
  let current = isDark;
  const listeners = new Set<(args: { isDark: boolean }) => void>();
  const subscribe: ColorSchemeSubscriber = ({ onChange }) => {
    listeners.add(onChange);
    onChange({ isDark: current });
    return () => {
      listeners.delete(onChange);
    };
  };
  return {
    subscribe,
    getListenerCount: () => listeners.size,
    emit: ({ isDark: nextIsDark }: { isDark: boolean }) => {
      current = nextIsDark;
      for (const listener of listeners) {
        listener({ isDark: nextIsDark });
      }
    },
  };
}
