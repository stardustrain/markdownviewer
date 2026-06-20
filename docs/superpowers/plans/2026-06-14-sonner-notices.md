# Sonner Notices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sticky in-page notice banner with Sonner toast notifications so tab navigation no longer covers notices during scroll.

**Architecture:** Keep the existing `AppNotice` state as the source of truth. Render one Sonner `<Toaster />` at the app root, and trigger/dismiss a single app-level toast from `visibleNotice` changes instead of rendering `.error-banner` in document flow. Keep the tab `삭제됨` badge as the persistent indicator for deleted files.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, Sonner.

**Execution order:** Run Task 1 first, then Task 3 before Task 2 so the notice behavior changes follow TDD. Task 4 remains last.

---

### Task 1: Add Sonner Dependency

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [x] **Step 1: Install Sonner**

Run:

```bash
pnpm add sonner
```

Expected: `package.json` gains a `sonner` dependency and `pnpm-lock.yaml` records the resolved package.

- [x] **Step 2: Verify dependency metadata**

Run:

```bash
rg -n '"sonner"|sonner@' package.json pnpm-lock.yaml
```

Expected: both files contain Sonner entries.

### Task 2: Convert App Notice Rendering To Sonner Toasts

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.css`

- [x] **Step 1: Add imports**

In `src/App.tsx`, update imports:

```tsx
import { Toaster, toast } from "sonner";
import { useCallback, useEffect, useRef, useState } from "react";
```

Expected: Sonner APIs are imported. The existing React import remains otherwise unchanged.

- [x] **Step 2: Add a stable toast effect**

After `visibleNotice` is computed in `App`, add:

```tsx
  const visibleNoticeSource = notice !== null ? "global" : getTabNoticeSource({ tab: activeTab });
  const visibleNoticeToastId = visibleNoticeSource === null ? null : `app-notice:${visibleNoticeSource}`;
  const visibleNoticeKind = visibleNotice?.kind ?? null;
  const visibleNoticeMessage = visibleNotice?.message ?? null;

  useEffect(() => {
    const currentToastId = visibleNoticeToastIdRef.current;
    if (visibleNoticeKind === null || visibleNoticeMessage === null || visibleNoticeToastId === null) {
      if (currentToastId !== null) {
        toast.dismiss(currentToastId);
        visibleNoticeToastIdRef.current = null;
      }
      return;
    }

    if (currentToastId !== null && currentToastId !== visibleNoticeToastId) {
      toast.dismiss(currentToastId);
    }
    visibleNoticeToastIdRef.current = visibleNoticeToastId;

    toast.error(<span role="alert">{visibleNoticeMessage}</span>, {
      id: visibleNoticeToastId,
      duration: Infinity,
      onDismiss: () => {
        if (!shouldClearNoticeOnDismissRef.current) {
          return;
        }
        shouldClearNoticeOnDismissRef.current = false;
        clearVisibleNotice({ kind: visibleNoticeKind, message: visibleNoticeMessage });
      },
    });
  }, [clearVisibleNotice, visibleNoticeKind, visibleNoticeMessage, visibleNoticeToastId]);
```

Expected: one toast slot represents the currently visible notice. The toast id includes the notice source so a same-message global notice and active-tab notice can hand off cleanly. Notices remain visible until app state clears them or the user closes the toast. Closing the toast by clicking it must also clear the matching `AppNotice` source so the same error can be shown again later. Programmatic dismissals must not clear inactive tab notices. Sonner 2.0.7 renders a polite live region but does not assign `role="alert"` to each toast by default, so the message keeps the previous alert semantics explicitly.

- [x] **Step 3: Render the Toaster once**

Inside `<main className={isDragging ? "app dragging" : "app"}>`, remove the current banner block:

```tsx
      {visibleNotice !== null && (
        <div role="alert" className="error-banner">
          {visibleNotice.message}
        </div>
      )}
```

Add:

```tsx
      <Toaster
        closeButton
        containerAriaLabel="알림"
        richColors
        position="top-right"
        swipeDirections={appToastSwipeDirections}
        toastOptions={appToastOptions}
      />
```

Expected: Sonner owns notification layout and the tabbar is no longer offset by notice UI. Swipe dismiss is disabled so user dismissals pass through the click path that marks the matching `AppNotice` for clearing.

- [x] **Step 4: Remove unused banner CSS**

Delete `.error-banner` from `src/App.css`:

```css
.error-banner {
  position: sticky;
  top: 0;
  padding: 8px 16px;
  background-color: #b62324;
  color: #ffffff;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
}
```

Expected: no sticky notice CSS remains.

- [x] **Step 5: Typecheck the app change**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

### Task 3: Update App Notice Tests

**Files:**
- Modify: `src/App.spec.tsx`

- [x] **Step 1: Rename banner-focused test descriptions**

Change descriptions that say `배너` to `토스트` where the expected UI is the app notice.

Examples:

```tsx
test("읽기에 실패하면 에러 토스트를 띄우고 기존 문서를 유지합니다.", async () => {
```

```tsx
test("내용을 유지하고 삭제 토스트를 띄웁니다.", async () => {
```

Expected: test names describe the new UI without changing behavior under test.

- [x] **Step 2: Keep alert queries for Sonner output**

Continue using Testing Library alert queries for visible toast content:

```tsx
expect(await screen.findByRole("alert")).toHaveTextContent(/읽기 실패/);
```

Expected: tests remain user-facing and do not depend on Sonner internals or CSS class names.

- [x] **Step 3: Add a regression assertion for the removed banner**

In one notice test after a toast appears, assert the old banner class is gone:

```tsx
expect(document.querySelector(".error-banner")).not.toBeInTheDocument();
```

Expected: the test guards against accidentally reintroducing the sticky banner.

- [x] **Step 4: Update disappearance tests**

For tests that currently expect the banner to disappear after state clears, keep the semantic assertion:

```tsx
await waitFor(() => {
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
```

Expected: notice clearing still dismisses the toast through `toast.dismiss("app-notice")`.

- [x] **Step 5: Run focused tests**

Run:

```bash
pnpm vitest run src/App.spec.tsx
```

Expected: PASS.

### Task 4: Verify Full Change Set

**Files:**
- Read: `src/App.tsx`
- Read: `src/App.css`
- Read: `src/App.spec.tsx`
- Read: `package.json`
- Read: `pnpm-lock.yaml`

- [x] **Step 1: Check for old banner references**

Run:

```bash
rg -n "error-banner|배너" src/App.tsx src/App.css src/App.spec.tsx
```

Expected: no `error-banner` references in `src/App.tsx` or `src/App.css`. `src/App.spec.tsx` should contain only the intentional `.error-banner` regression assertion. `배너` should not remain in app notice test descriptions.

- [x] **Step 2: Run full verification**

Run:

```bash
pnpm test
pnpm lint
pnpm build
```

Expected: all commands PASS.

- [x] **Step 3: Review git diff**

Run:

```bash
git diff -- package.json pnpm-lock.yaml src/App.tsx src/App.css src/App.spec.tsx
```

Expected: diff is limited to Sonner dependency, toast rendering, stale banner CSS removal, and notice test wording/assertions.

- [ ] **Step 4: Commit**

Run:

```bash
git add package.json pnpm-lock.yaml src/App.tsx src/App.css src/App.spec.tsx docs/superpowers/plans/2026-06-14-sonner-notices.md
git commit -m "fix: show app notices with sonner toasts"
```

Expected: commit contains only the planned files.
