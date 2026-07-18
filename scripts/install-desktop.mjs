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
const iconPath = path.join(root, "app", "assets", "mindmap.svg");
const openScript = path.join(root, "scripts", "open-app.mjs");

function q(value) {
  return `"${String(value).replace(/"/g, "\\\"")}"`;
}

const desktopEntry = `[Desktop Entry]
Type=Application
Name=MindMap
Comment=Interactive architecture map app
Exec=${q(process.execPath)} ${q(openScript)}
Icon=${iconPath}
Terminal=false
Categories=Development;
Keywords=diagram;architecture;mindmap;map;
StartupNotify=true
`;

await fs.mkdir(applicationsDir, { recursive: true });
await fs.writeFile(desktopPath, desktopEntry, "utf8");
await fs.chmod(desktopPath, 0o755);

await new Promise((resolve) => {
  execFile("update-desktop-database", [applicationsDir], () => resolve());
});

console.log(JSON.stringify({
  ok: true,
  desktop: desktopPath,
  icon: iconPath
}, null, 2));
