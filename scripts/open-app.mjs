#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const mainPath = path.join(root, "desktop", "main.mjs");
const logPath = process.env.MINDMAP_OPEN_LOG || path.join(os.homedir(), ".cache", "mindmap", "open-app.log");
const require = createRequire(import.meta.url);

function ensureLogPath() {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
}

function log(message) {
  ensureLogPath();
  fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, "utf8");
}

function logFd() {
  ensureLogPath();
  return fs.openSync(logPath, "a");
}

function electronBinary() {
  try {
    return require("electron");
  } catch (error) {
    throw new Error("Electron is not installed. Run `npm install` in /home/lwb/Projects/MindMap first.");
  }
}

function electronEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

const electron = electronBinary();
const stdout = logFd();
const stderr = logFd();
const args = ["--class=MindMap", mainPath, ...process.argv.slice(2)];
const child = spawn(electron, args, {
  cwd: root,
  detached: true,
  env: electronEnv(),
  stdio: ["ignore", stdout, stderr]
});

child.once("error", (error) => {
  log(`electron spawn failed: ${error.message}`);
});
child.unref();
log(`electron desktop open requested: ${electron} ${args.join(" ")} pid=${child.pid ?? "unknown"}`);
console.log("MindMap desktop window requested.");
