#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";

const applicationsDir = path.join(os.homedir(), ".local", "share", "applications");
const desktopPath = path.join(applicationsDir, "mindmap.desktop");

await fs.rm(desktopPath, { force: true });
await new Promise((resolve) => {
  execFile("update-desktop-database", [applicationsDir], () => resolve());
});

console.log(JSON.stringify({
  ok: true,
  removed: desktopPath
}, null, 2));
