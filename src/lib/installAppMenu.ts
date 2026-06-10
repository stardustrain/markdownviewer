/**
 * @fileoverview macOS 기본 메뉴 사본의 File 서브메뉴에 "Open…"(⌘O) 항목을 삽입해 앱 메뉴로 설치합니다.
 * Menu.default()는 현재 설치된 메뉴가 아니라 기본 메뉴의 새 사본을 만들므로, 수정 후 setAsAppMenu()로 교체한다.
 * 메뉴 액션은 JS Channel이라 웹뷰 리로드 시 죽는다 — 페이지 로드마다 재설치해야 하며,
 * installed 플래그는 같은 페이지 내 중복 설치(React StrictMode 이중 effect)만 막는다.
 * 전부 Tauri 메뉴 API 글루라 단위 테스트 없음(스펙 §8 TDD 예외) — 수동 체크리스트로 검증.
 */
import { Menu, MenuItem, Submenu } from "@tauri-apps/api/menu";

let installed = false;

export async function installAppMenu({
  onOpen,
}: {
  onOpen: () => void;
}): Promise<void> {
  if (installed) {
    return;
  }
  installed = true;

  // 기본 메뉴 사본: [App, File, Edit, View, Window, Help] — Edit의 네이티브 복사/붙여넣기 보존
  const menu = await Menu.default();

  let fileSubmenu: Submenu | null = null;
  for (const item of await menu.items()) {
    if (item instanceof Submenu && (await item.text()) === "File") {
      fileSubmenu = item;
      break;
    }
  }
  if (fileSubmenu === null) {
    return;
  }

  const openItem = await MenuItem.new({
    id: "open-file",
    text: "Open…",
    accelerator: "CmdOrCtrl+O",
    action: () => {
      onOpen();
    },
  });
  // 기본 File 메뉴에는 Close Window(⌘W)뿐 — 그 위에 삽입
  await fileSubmenu.insert(openItem, 0);

  const previousMenu = await menu.setAsAppMenu();
  await previousMenu?.close();
}
