#!/usr/bin/env node
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const requestedPort = Number(process.env.PORT || process.env.MINDMAP_PORT || 5177);

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".png", "image/png"],
  [".ico", "image/x-icon"]
]);

function resolveUrl(url) {
  const clean = decodeURIComponent(new URL(url, "http://localhost").pathname);
  if (clean === "/") return { redirect: "/app/" };
  const candidate = path.normalize(path.join(root, clean));
  if (!candidate.startsWith(root)) return undefined;
  return { filePath: candidate };
}

function createServer() {
  return http.createServer(async (req, res) => {
  try {
    const resolved = resolveUrl(req.url || "/");
    if (!resolved) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    if (resolved.redirect) {
      res.writeHead(302, { location: resolved.redirect });
      res.end();
      return;
    }
    let filePath = resolved.filePath;
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      "content-type": types.get(path.extname(filePath)) ?? "application/octet-stream"
    });
    res.end(data);
  } catch (error) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end(`Not found: ${error.message}`);
  }
  });
}

function listen(port) {
  const server = createServer();
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && port < requestedPort + 20) {
      listen(port + 1);
      return;
    }
    console.error(error.message);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`MindMap listening on http://127.0.0.1:${port}/app/`);
  });
}

listen(requestedPort);
