#!/usr/bin/env node
import fs from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
const applicationsDir = path.join(dataHome, "applications");
const desktopPath = path.join(applicationsDir, "mindmap-app.desktop");
const oldDesktopPath = path.join(applicationsDir, "mindmap.desktop");
const iconThemeDir = path.join(dataHome, "icons", "hicolor");
const iconInstallDir = path.join(iconThemeDir, "512x512", "apps");
const iconSourcePath = path.join(root, "app", "assets", "mindmap.png");

async function currentIconName() {
  try {
    const buffer = await fs.readFile(iconSourcePath);
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    return `mindmap-app-${hash.slice(0, 12)}.png`;
  } catch {
    return "";
  }
}

async function iconPathsToRemove() {
  const paths = [
    path.join(iconInstallDir, "mindmap-app.png"),
    path.join(iconInstallDir, "mindmap.png"),
    path.join(iconInstallDir, "mindmap-app.svg"),
    path.join(iconInstallDir, "mindmap.svg")
  ];
  const hashedIcon = await currentIconName();
  if (hashedIcon) paths.push(path.join(iconInstallDir, hashedIcon));
  try {
    const names = await fs.readdir(iconInstallDir);
    for (const name of names) {
      if (/^mindmap-app-[0-9a-f]{12}\.png$/i.test(name)) {
        paths.push(path.join(iconInstallDir, name));
      }
    }
  } catch {
    // Missing icon directories are fine during uninstall.
  }
  return [...new Set(paths)];
}

await fs.rm(desktopPath, { force: true });
await fs.rm(oldDesktopPath, { force: true });
const removedIcons = await iconPathsToRemove();
await Promise.all(removedIcons.map((item) => fs.rm(item, { force: true })));
await new Promise((resolve) => {
  execFile("gtk-update-icon-cache", ["-f", "-t", "-i", iconThemeDir], () => resolve());
});
await new Promise((resolve) => {
  execFile("update-desktop-database", [applicationsDir], () => resolve());
});
await new Promise((resolve) => {
  execFile("xdg-desktop-menu", ["forceupdate"], () => resolve());
});

console.log(JSON.stringify({
  ok: true,
  removed: [desktopPath, oldDesktopPath, ...removedIcons]
}, null, 2));
