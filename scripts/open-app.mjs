#!/usr/bin/env node
import { spawn } from "node:child_process";
import net from "node:net";

const HOST = "127.0.0.1";
const FIRST_PORT = Number(process.env.MINDMAP_PORT || 5177);
const LAST_PORT = FIRST_PORT + 20;

function appUrl(port) {
  return `http://${HOST}:${port}/app/`;
}

function fetchJson(port) {
  return new Promise((resolve) => {
    const request = fetch(`http://${HOST}:${port}/examples/rpent-libero-behavior.diagram.json`);
    request
      .then((response) => response.ok ? response.json() : undefined)
      .then((json) => resolve(json?.schemaVersion === "mindmap-app/v1"))
      .catch(() => resolve(false));
  });
}

function isFree(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: HOST, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(true));
  });
}

async function findRunningApp() {
  for (let port = FIRST_PORT; port <= LAST_PORT; port += 1) {
    if (await fetchJson(port)) return port;
  }
  return undefined;
}

async function findFreePort() {
  for (let port = FIRST_PORT; port <= LAST_PORT; port += 1) {
    if (await isFree(port)) return port;
  }
  throw new Error(`No free port found between ${FIRST_PORT} and ${LAST_PORT}`);
}

async function waitForApp(port) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await fetchJson(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`MindMap did not start on ${appUrl(port)}`);
}

function openBrowser(url) {
  const command = process.env.BROWSER || "xdg-open";
  const child = spawn(command, [url], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

let port = await findRunningApp();
if (!port) {
  port = await findFreePort();
  const server = spawn(process.execPath, [new URL("./serve-app.mjs", import.meta.url).pathname], {
    detached: true,
    env: { ...process.env, MINDMAP_PORT: String(port) },
    stdio: "ignore"
  });
  server.unref();
  await waitForApp(port);
}

openBrowser(appUrl(port));
