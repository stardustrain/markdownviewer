import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_PACKAGE_NAME = "markdownviewer";

export function parseCargoPackageVersion(content) {
  const packageSection = content.match(/(?:^|\n)\[package\]\n(?<body>[\s\S]*?)(?=\n\[|$)/)?.groups?.body;
  const version = packageSection?.match(/^version\s*=\s*"([^"]+)"$/m)?.[1];

  if (!version) {
    throw new Error("Unable to read package.version from src-tauri/Cargo.toml");
  }

  return version;
}

export function parseCargoLockPackageVersion(content, packageName) {
  const packageBlocks = content.split(/\n(?=\[\[package\]\]\n)/);
  const packageBlock = packageBlocks.find((block) =>
    new RegExp(`^name\\s*=\\s*"${escapeRegExp(packageName)}"$`, "m").test(block),
  );
  const version = packageBlock?.match(/^version\s*=\s*"([^"]+)"$/m)?.[1];

  if (!version) {
    throw new Error(`Unable to read ${packageName} version from src-tauri/Cargo.lock`);
  }

  return version;
}

export function collectReleaseVersions(rootDir = process.cwd()) {
  const packageJson = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8"));
  const tauriConfig = JSON.parse(readFileSync(resolve(rootDir, "src-tauri/tauri.conf.json"), "utf8"));
  const cargoToml = readFileSync(resolve(rootDir, "src-tauri/Cargo.toml"), "utf8");
  const cargoLock = readFileSync(resolve(rootDir, "src-tauri/Cargo.lock"), "utf8");

  return {
    "package.json": packageJson.version,
    "src-tauri/tauri.conf.json": tauriConfig.version,
    "src-tauri/Cargo.toml": parseCargoPackageVersion(cargoToml),
    "src-tauri/Cargo.lock": parseCargoLockPackageVersion(cargoLock, APP_PACKAGE_NAME),
  };
}

export function findVersionMismatches(versions) {
  const expectedVersion = versions["package.json"];

  return Object.entries(versions).filter(([path, version]) => path !== "package.json" && version !== expectedVersion);
}

export function formatVersionReport(versions) {
  return Object.entries(versions)
    .map(([path, version]) => `${path}: ${version}`)
    .join("\n");
}

export function main(rootDir = process.cwd()) {
  const versions = collectReleaseVersions(rootDir);
  const mismatches = findVersionMismatches(versions);

  if (mismatches.length > 0) {
    console.error("Release version files are out of sync:");
    console.error(formatVersionReport(versions));
    return 1;
  }

  console.log(`Release versions are consistent: ${versions["package.json"]}`);
  return 0;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
