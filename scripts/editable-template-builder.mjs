import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { build } from "vite";
import { assertValidDiagram } from "../app/diagram-validator.mjs";
import {
  EDITABLE_DIAGRAM_PLACEHOLDER,
  EDITABLE_HTML_FORMAT,
  EMBEDDED_DIAGRAM_SCRIPT_ID,
  safeJsonForScript,
} from "../app/editable-html.mjs";
import { ensureViews } from "../app/views/view-model.mjs";

function stripSourceMapComment(source) {
  return source.replace(/\n?\/\/# sourceMappingURL=.*$/gm, "");
}

function jsString(value) {
  return JSON.stringify(String(value));
}

function safeInlineScript(source) {
  return String(source).replace(/<\/script/gi, "<\\/script");
}

function dataUrl(buffer, mimeType) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function replaceOnce(source, pattern, replacement, label) {
  const next = source.replace(pattern, () => replacement);
  if (next === source) throw new Error(`Editable template generation could not replace ${label}.`);
  return next;
}

function scriptHash(source) {
  return `'sha256-${createHash("sha256").update(source).digest("base64")}'`;
}

function cspContent(scriptSources) {
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    "manifest-src 'none'",
    "connect-src blob: data:",
    `script-src ${scriptSources.map(scriptHash).join(" ")}`,
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    "worker-src blob:",
    "child-src blob:",
    "media-src data: blob:"
  ].join("; ");
}

function captureSource() {
  return safeInlineScript(`(() => {
  const diagramScriptId = ${jsString(EMBEDDED_DIAGRAM_SCRIPT_ID)};
  const placeholder = "<!--__MINDMAP_" + "EDITABLE_DIAGRAM_PLACEHOLDER__-->";
  const doctype = "<!doctype html>\\n";
  const normalize = (source) => String(source || "").replace(
    new RegExp("<script\\\\b(?=[^>]*\\\\bid=[\\\"']" + diagramScriptId + "[\\\"'])[^>]*>[\\\\s\\\\S]*?<\\\\/script>", "i"),
    placeholder
  );
  const capture = () => {
    window.__MINDMAP_EDITABLE_HTML_SOURCE__ = normalize(doctype + document.documentElement.outerHTML);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", capture, { once: true });
  } else {
    capture();
  }
})();`);
}

function patchAppScript(source) {
  let patched = stripSourceMapComment(source);
  patched = patched.replaceAll(
    EDITABLE_DIAGRAM_PLACEHOLDER,
    "\\x3C!--__MINDMAP_EDITABLE_DIAGRAM_PLACEHOLDER__--\\x3E"
  );
  patched = replaceOnce(
    patched,
    /new URL\(``\+new URL\(`layout-worker-[^`]+\.js`,import\.meta\.url\)\.href,``\+import\.meta\.url\)/g,
    "window.__MINDMAP_TEMPLATE_WORKER_URL__",
    "Vite worker URL"
  );
  return patched;
}

async function findOne(dir, pattern, label) {
  const names = await fs.readdir(dir);
  const matches = names.filter((name) => pattern.test(name)).sort();
  if (matches.length !== 1) throw new Error(`Expected one ${label}, found ${matches.length}.`);
  return path.join(dir, matches[0]);
}

async function inlineTemplate({ templateOut, tempOut, examplePath, iconPath }) {
  const assetsDir = path.join(tempOut, "assets");
  const htmlPath = path.join(tempOut, "index.html");
  const cssPath = await findOne(assetsDir, /^style\.css$/, "template CSS asset");
  const appJsPath = await findOne(assetsDir, /^template-app\.js$/, "template app JS asset");
  const workerJsPath = await findOne(assetsDir, /^layout-worker-.+\.js$/, "template layout worker JS asset");

  let html = await fs.readFile(htmlPath, "utf8");
  const css = await fs.readFile(cssPath, "utf8");
  const appJs = patchAppScript(await fs.readFile(appJsPath, "utf8"));
  const workerJs = stripSourceMapComment(await fs.readFile(workerJsPath, "utf8"));
  const embeddedDiagram = ensureViews(assertValidDiagram(JSON.parse(await fs.readFile(examplePath, "utf8"))));
  embeddedDiagram.assets ||= {};
  const icon = dataUrl(await fs.readFile(iconPath), "image/png");

  html = html
    .replace(/<script type="module" crossorigin src="\.\/assets\/template-app\.js"><\/script>\n?/g, () => "")
    .replace(/<link rel="stylesheet" crossorigin href="\.\/assets\/style\.css">\n?/g, () => "")
    .replace(/<link rel="manifest" href="[^"]+">\n?/g, () => "")
    .replace(/<link rel="icon" href="[^"]+" type="image\/png">/g, () => `<link rel="icon" href="${icon}" type="image/png">`)
    .replace(/<link rel="apple-touch-icon" href="[^"]+">/g, () => `<link rel="apple-touch-icon" href="${icon}">`);

  const embeddedScript = `<script id="${EMBEDDED_DIAGRAM_SCRIPT_ID}" type="application/json">\n${safeJsonForScript(embeddedDiagram)}\n</script>`;
  html = replaceOnce(html, EDITABLE_DIAGRAM_PLACEHOLDER, embeddedScript, "embedded diagram placeholder");

  const moduleSource = safeInlineScript(`const workerSource = ${jsString(workerJs)};
window.__MINDMAP_TEMPLATE_WORKER_URL__ = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
${appJs}`);
  const capture = captureSource();
  const csp = cspContent([moduleSource, capture]);

  html = replaceOnce(
    html,
    /<meta name="color-scheme" content="light">/,
    `<meta name="color-scheme" content="light">\n  <meta name="mindmap-editable-format" content="${EDITABLE_HTML_FORMAT}">\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`,
    "editable format and CSP metadata"
  );
  html = replaceOnce(
    html,
    /<\/head>/,
    `  <style>${css.trim()}</style>\n</head>`,
    "inline stylesheet"
  );
  html = replaceOnce(
    html,
    /<\/body>/,
    `  <script type="module">${moduleSource}</script>\n  <script>${capture}</script>\n</body>`,
    "inline application runtime"
  );

  await fs.writeFile(templateOut, html, "utf8");
  const stat = await fs.stat(templateOut);
  return { path: templateOut, bytes: stat.size };
}

export async function buildEditableTemplate({ root, appRoot, appOut }) {
  const tempOut = path.join(appOut, ".editable-template-build");
  const templateOut = path.join(appOut, "editable-template.html");
  await fs.rm(tempOut, { recursive: true, force: true });
  await build({
    root: appRoot,
    base: "./",
    publicDir: false,
    logLevel: process.env.CI ? "info" : "warn",
    build: {
      outDir: tempOut,
      emptyOutDir: true,
      sourcemap: false,
      target: "es2022",
      cssCodeSplit: false,
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      chunkSizeWarningLimit: 5000,
      rollupOptions: {
        input: path.join(appRoot, "index.html"),
        output: {
          codeSplitting: false,
          entryFileNames: "assets/template-app.js",
          chunkFileNames: "assets/template-chunk.js",
          assetFileNames: "assets/[name][extname]"
        }
      }
    }
  });

  try {
    return await inlineTemplate({
      templateOut,
      tempOut,
      examplePath: path.join(root, "examples", "rpent-libero-behavior.diagram.json"),
      iconPath: path.join(appRoot, "assets", "mindmap.png")
    });
  } finally {
    await fs.rm(tempOut, { recursive: true, force: true });
  }
}
