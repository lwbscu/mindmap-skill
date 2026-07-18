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
const desktopId = "mindmap-app.desktop";
const oldDesktopId = "mindmap.desktop";
const desktopPath = path.join(applicationsDir, desktopId);
const oldDesktopPath = path.join(applicationsDir, oldDesktopId);
const iconSourcePath = path.join(root, "app", "assets", "mindmap.png");
const iconThemeDir = path.join(dataHome, "icons", "hicolor");
const iconInstallDir = path.join(iconThemeDir, "512x512", "apps");
const openScript = path.join(root, "scripts", "open-app.mjs");
const iconBuffer = await fs.readFile(iconSourcePath);
const iconHash = crypto.createHash("sha256").update(iconBuffer).digest("hex");
const iconName = `mindmap-app-${iconHash.slice(0, 12)}`;
const iconInstallPath = path.join(iconInstallDir, `${iconName}.png`);
const oldIconPaths = [
  path.join(iconInstallDir, "mindmap-app.png"),
  path.join(iconInstallDir, "mindmap.png"),
  path.join(iconInstallDir, "mindmap-app.svg"),
  path.join(iconInstallDir, "mindmap.svg")
];

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
StartupWMClass=MindMap
X-GNOME-WMClass=MindMap
`;

await fs.mkdir(applicationsDir, { recursive: true });
await fs.mkdir(iconInstallDir, { recursive: true });
await fs.rm(oldDesktopPath, { force: true });
await Promise.all(oldIconPaths.map((item) => fs.rm(item, { force: true })));
for (const name of await fs.readdir(iconInstallDir)) {
  if (/^mindmap-app-[0-9a-f]{12}\.png$/i.test(name) && name !== `${iconName}.png`) {
    await fs.rm(path.join(iconInstallDir, name), { force: true });
  }
}
await fs.writeFile(iconInstallPath, iconBuffer);
await fs.chmod(iconInstallPath, 0o644);
await fs.writeFile(desktopPath, desktopEntry, "utf8");
await fs.chmod(desktopPath, 0o755);

await runOptional("gtk-update-icon-cache", ["-f", "-t", "-i", iconThemeDir]);
await runOptional("update-desktop-database", [applicationsDir]);
await runOptional("xdg-desktop-menu", ["forceupdate"]);

console.log(JSON.stringify({
  ok: true,
  desktopId,
  desktop: desktopPath,
  icon: iconName,
  iconHash,
  iconSource: iconSourcePath,
  installedIcon: iconInstallPath
}, null, 2));
