import {
  findVersionMismatches,
  parseCargoLockPackageVersion,
  parseCargoPackageVersion,
} from "./check-release-versions.mjs";

describe("release version consistency helpers", () => {
  test("Cargo.toml package version is read from the package section", () => {
    const cargoToml = [
      "[workspace]",
      'members = ["src-tauri"]',
      "",
      "[package]",
      'name = "markdownviewer"',
      'version = "1.2.3"',
      "",
      "[dependencies]",
      'serde = "1"',
    ].join("\n");

    expect(parseCargoPackageVersion(cargoToml)).toBe("1.2.3");
  });

  test("Cargo.lock version is read from the markdownviewer package block", () => {
    const cargoLock = [
      "[[package]]",
      'name = "dependency"',
      'version = "9.9.9"',
      "",
      "[[package]]",
      'name = "markdownviewer"',
      'version = "2.0.0"',
      "dependencies = [",
      ' "serde",',
      "]",
    ].join("\n");

    expect(parseCargoLockPackageVersion(cargoLock, "markdownviewer")).toBe("2.0.0");
  });

  test("version mismatches report every file that differs from package.json", () => {
    const mismatches = findVersionMismatches({
      "package.json": "1.0.0",
      "src-tauri/tauri.conf.json": "1.0.1",
      "src-tauri/Cargo.toml": "1.0.0",
      "src-tauri/Cargo.lock": "0.9.0",
    });

    expect(mismatches).toEqual([
      ["src-tauri/tauri.conf.json", "1.0.1"],
      ["src-tauri/Cargo.lock", "0.9.0"],
    ]);
  });
});
