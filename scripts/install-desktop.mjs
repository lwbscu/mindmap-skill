#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const applicationsDir = path.join(os.homedir(), ".local", "share", "applications");
const desktopPath = path.join(applicationsDir, "mindmap.desktop");
const iconSourcePath = path.join(root, "app", "assets", "mindmap.png");
const iconName = "mindmap-app";
const iconThemeDir = path.join(os.homedir(), ".local", "share", "icons", "hicolor");
const iconInstallDir = path.join(iconThemeDir, "512x512", "apps");
const iconInstallPath = path.join(iconInstallDir, `${iconName}.png`);
const openScript = path.join(root, "scripts", "open-app.mjs");

function q(value) {
  return `"${String(value).replace(/"/g, "\\\"")}"`;
}

function runOptional(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, () => resolve());
  });
}

const desktopEntry = `[Desktop Entry]
Type=Application
Name=MindMap
Comment=Interactive architecture map app
Exec=${q(process.execPath)} ${q(openScript)}
Icon=${iconName}
Path=${root}
Terminal=false
Categories=Development;
Keywords=diagram;architecture;mindmap;map;
StartupNotify=true
`;

await fs.mkdir(applicationsDir, { recursive: true });
await fs.mkdir(iconInstallDir, { recursive: true });
await fs.copyFile(iconSourcePath, iconInstallPath);
await fs.chmod(iconInstallPath, 0o644);
await fs.writeFile(desktopPath, desktopEntry, "utf8");
await fs.chmod(desktopPath, 0o755);

await runOptional("gtk-update-icon-cache", ["-f", "-t", "-i", iconThemeDir]);
await runOptional("update-desktop-database", [applicationsDir]);
await runOptional("xdg-desktop-menu", ["forceupdate"]);

console.log(JSON.stringify({
  ok: true,
  desktop: desktopPath,
  icon: iconName,
  iconSource: iconSourcePath,
  installedIcon: iconInstallPath
}, null, 2));
