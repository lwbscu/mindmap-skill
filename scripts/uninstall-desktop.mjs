#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";

const applicationsDir = path.join(os.homedir(), ".local", "share", "applications");
const desktopPath = path.join(applicationsDir, "mindmap.desktop");
const iconThemeDir = path.join(os.homedir(), ".local", "share", "icons", "hicolor");
const iconPath = path.join(iconThemeDir, "512x512", "apps", "mindmap-app.png");

await fs.rm(desktopPath, { force: true });
await fs.rm(iconPath, { force: true });
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
  removed: [desktopPath, iconPath]
}, null, 2));
