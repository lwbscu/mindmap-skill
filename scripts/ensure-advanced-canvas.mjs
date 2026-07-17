#!/usr/bin/env node
import { createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import https from "node:https";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const PLUGIN_ID = "advanced-canvas";
const DEFAULT_VERSION = "6.5.0";
const REQUIRED_RELEASE_FILES = ["main.js", "manifest.json", "styles.css"];
const REQUIRED_PLUGIN_FILES = [...REQUIRED_RELEASE_FILES, "data.json"];
const RELEASE_OWNER = "Developer-Mike";
const RELEASE_REPO = "obsidian-advanced-canvas";
const PINNED_RELEASES = Object.freeze({
  "6.5.0": Object.freeze({
    "main.js": Object.freeze({
      bytes: 378536,
      sha256: "6583fcede1ea1ca8d0717ee7834c510f416adc416399d3991c4e4d8f0663ca5a",
    }),
    "manifest.json": Object.freeze({
      bytes: 363,
      sha256: "95c51db9e2dfa471bfc44089f7d77e9f4a2c268b50fa5b9f6e651a3c6edb0d87",
    }),
    "styles.css": Object.freeze({
      bytes: 22778,
      sha256: "ec923a3aec401aec9052842504420771bc1ec0bd86907d2046aef43226cdabde",
    }),
  }),
});
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

const MINDMAP_TEMPLATES = [
  ["MindMap \u00b7 Module", "package", "#4f46e5", "#eef2ff", "#c7d2fe"],
  ["MindMap \u00b7 Data", "database", "#0891b2", "#ecfeff", "#a5f3fc"],
  ["MindMap \u00b7 Model", "brain-circuit", "#7c3aed", "#f5f3ff", "#ddd6fe"],
  ["MindMap \u00b7 State", "activity", "#0f766e", "#f0fdfa", "#99f6e4"],
  ["MindMap \u00b7 Loss", "chart-no-axes-combined", "#dc2626", "#fef2f2", "#fecaca"],
  ["MindMap \u00b7 Optimizer", "settings-2", "#ca8a04", "#fefce8", "#fde68a"],
  ["MindMap \u00b7 Evaluation", "clipboard-check", "#16a34a", "#f0fdf4", "#bbf7d0"],
  ["MindMap \u00b7 Training Loop", "repeat-2", "#2563eb", "#eff6ff", "#bfdbfe"],
  ["MindMap \u00b7 External", "globe-2", "#475569", "#f8fafc", "#cbd5e1"],
].map(([label, icon, color, backgroundColor, borderColor]) => ({
  icon,
  label,
  type: "text",
  width: 300,
  height: 160,
  color,
  styleAttributes: {
    backgroundColor,
    borderColor,
    borderWidth: "2px",
    borderStyle: "solid",
    textAlign: "center",
  },
}));

class CliError extends Error {
  constructor(message) {
    super(message);
    this.name = "CliError";
    this.exitCode = 2;
  }
}

class DownloadError extends Error {
  constructor(message) {
    super(message);
    this.name = "DownloadError";
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
    this.exitCode = 1;
  }
}

function usage() {
  return "Usage: node ensure-advanced-canvas.mjs --vault <vault-path> [--version 6.5.0] [--check] [--source-dir <local-release-dir>]";
}

function parseArgs(argv) {
  const args = {
    vault: undefined,
    version: DEFAULT_VERSION,
    check: false,
    sourceDir: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--vault") {
      args.vault = requireValue(argv, ++i, "--vault");
    } else if (arg === "--version") {
      args.version = requireValue(argv, ++i, "--version");
    } else if (arg === "--check") {
      args.check = true;
    } else if (arg === "--source-dir") {
      args.sourceDir = requireValue(argv, ++i, "--source-dir");
    } else if (arg === "--help" || arg === "-h") {
      throw new CliError(usage());
    } else {
      throw new CliError(`Unknown argument: ${arg}. ${usage()}`);
    }
  }

  if (!args.vault) {
    throw new CliError(`Missing --vault. ${usage()}`);
  }
  if (!isSemver(args.version)) {
    throw new CliError(`Invalid --version "${args.version}". Expected x.y.z.`);
  }
  return args;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new CliError(`Missing value for ${flag}. ${usage()}`);
  }
  return value;
}

function isSemver(version) {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version);
}

function compareVersions(left, right) {
  const leftParts = left.split(/[+-]/, 1)[0].split(".").map(Number);
  const rightParts = right.split(/[+-]/, 1)[0].split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (leftParts[i] > rightParts[i]) return 1;
    if (leftParts[i] < rightParts[i]) return -1;
  }
  return 0;
}

function chooseInstallVersion(requestedVersion, currentVersion) {
  if (currentVersion && isSemver(currentVersion) && compareVersions(currentVersion, requestedVersion) > 0) {
    return currentVersion;
  }
  return requestedVersion;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(dirPath) {
  try {
    return (await fs.stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJsonAtomic(filePath, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  await writeFileAtomic(filePath, body, "utf8");
}

async function writeFileAtomic(filePath, content, encoding = undefined) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmpPath = path.join(dir, `.${base}.tmp-${process.pid}-${Date.now()}`);

  try {
    await fs.writeFile(tmpPath, content, encoding);
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function validateVault(vaultArg) {
  const vaultPath = path.resolve(vaultArg);
  if (!(await isDirectory(vaultPath))) {
    throw new CliError(`Target vault does not exist or is not a directory: ${vaultPath}`);
  }
  const obsidianDir = path.join(vaultPath, ".obsidian");
  if (!(await isDirectory(obsidianDir))) {
    throw new CliError(`Target vault must contain a .obsidian directory: ${vaultPath}`);
  }
  return { vaultPath, obsidianDir };
}

async function inspectPlugin(pluginDir, requestedVersion) {
  const missing = [];
  for (const fileName of REQUIRED_PLUGIN_FILES) {
    if (!(await exists(path.join(pluginDir, fileName)))) {
      missing.push(fileName);
    }
  }

  let manifest;
  let manifestVersion;
  const manifestPath = path.join(pluginDir, "manifest.json");
  if (await exists(manifestPath)) {
    try {
      manifest = await readJson(manifestPath);
      manifestVersion = typeof manifest.version === "string" ? manifest.version : undefined;
    } catch (error) {
      return {
        healthy: false,
        version: undefined,
        missing,
        warnings: [`Invalid manifest.json: ${error.message}`],
      };
    }
  }

  const warnings = [];
  if (!manifest) {
    warnings.push("manifest.json is missing");
  } else {
    if (manifest.id !== PLUGIN_ID) {
      warnings.push(`manifest.id is "${manifest.id}", expected "${PLUGIN_ID}"`);
    }
    if (!manifestVersion || !isSemver(manifestVersion)) {
      warnings.push("manifest.version is missing or invalid");
    } else if (compareVersions(manifestVersion, requestedVersion) < 0) {
      warnings.push(`manifest.version ${manifestVersion} is lower than requested ${requestedVersion}`);
    }
  }

  return {
    healthy:
      missing.length === 0 &&
      manifest?.id === PLUGIN_ID &&
      Boolean(manifestVersion) &&
      isSemver(manifestVersion) &&
      compareVersions(manifestVersion, requestedVersion) >= 0,
    version: manifestVersion,
    missing,
    warnings,
  };
}

async function inspectEnabled(obsidianDir) {
  const pluginsPath = path.join(obsidianDir, "community-plugins.json");
  if (!(await exists(pluginsPath))) {
    return { enabled: false, plugins: [] };
  }
  const plugins = await readJson(pluginsPath);
  if (!Array.isArray(plugins)) {
    throw new ValidationError("community-plugins.json must be a JSON array");
  }
  return { enabled: plugins.includes(PLUGIN_ID), plugins };
}

async function enablePlugin(obsidianDir) {
  const pluginsPath = path.join(obsidianDir, "community-plugins.json");
  const { plugins } = await inspectEnabled(obsidianDir);
  if (plugins.includes(PLUGIN_ID)) {
    return true;
  }
  await writeJsonAtomic(pluginsPath, [...plugins, PLUGIN_ID]);
  return true;
}

async function countMissingTemplates(dataPath) {
  if (!(await exists(dataPath))) {
    return MINDMAP_TEMPLATES.length;
  }
  const data = await readJson(dataPath);
  if (!isPlainObject(data)) {
    throw new ValidationError("data.json must be a JSON object");
  }
  if (data.nodeTemplates === undefined) {
    return MINDMAP_TEMPLATES.length;
  }
  if (!Array.isArray(data.nodeTemplates)) {
    throw new ValidationError("data.json nodeTemplates field exists but is not an array");
  }
  const labels = templateLabels(data.nodeTemplates);
  return MINDMAP_TEMPLATES.filter((template) => !labels.has(template.label)).length;
}

async function mergeMindMapTemplates(dataPath) {
  let data = {};
  if (await exists(dataPath)) {
    data = await readJson(dataPath);
  }
  if (!isPlainObject(data)) {
    throw new ValidationError("data.json must be a JSON object");
  }
  if (data.nodeTemplates !== undefined && !Array.isArray(data.nodeTemplates)) {
    throw new ValidationError("data.json nodeTemplates field exists but is not an array");
  }
  if (data.templates !== undefined && !Array.isArray(data.templates)) {
    throw new ValidationError("data.json templates field exists but is not an array");
  }

  let changed = false;
  if (data.nodeTemplates === undefined) {
    data.nodeTemplates = [];
    changed = true;
  }

  const labels = templateLabels(data.nodeTemplates);
  for (const template of data.templates ?? []) {
    const label = template?.label;
    if (typeof label !== "string" || !labels.has(label)) {
      data.nodeTemplates.push(template);
      if (typeof label === "string") {
        labels.add(label);
      }
      changed = true;
    }
  }

  let added = 0;
  for (const template of MINDMAP_TEMPLATES) {
    if (!labels.has(template.label)) {
      data.nodeTemplates.push(template);
      labels.add(template.label);
      added += 1;
      changed = true;
    }
  }

  if (changed) {
    await writeJsonAtomic(dataPath, data);
  }
  return added;
}

function templateLabels(templates) {
  return new Set(
    templates
      .map((template) => template?.label)
      .filter((label) => typeof label === "string"),
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function acquireReleaseFiles({ obsidianDir, version, sourceDir }) {
  const tempDir = await fs.mkdtemp(path.join(obsidianDir, ".advanced-canvas-install-"));
  try {
    if (sourceDir) {
      const releaseDir = path.resolve(sourceDir);
      if (!(await isDirectory(releaseDir))) {
        throw new DownloadError(`--source-dir is not a directory: ${releaseDir}`);
      }
      for (const fileName of REQUIRED_RELEASE_FILES) {
        await fs.copyFile(path.join(releaseDir, fileName), path.join(tempDir, fileName));
      }
    } else {
      if (!PINNED_RELEASES[version]) {
        throw new DownloadError(
          `Automatic download is not allowed for unpinned Advanced Canvas version ${version}`,
        );
      }
      for (const fileName of REQUIRED_RELEASE_FILES) {
        const url = releaseAssetUrl(version, fileName);
        await downloadFile(url, path.join(tempDir, fileName), PINNED_RELEASES[version][fileName]);
      }
    }
    await validateReleaseDir(tempDir, version, { verifyPinned: !sourceDir });
    return tempDir;
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    if (error instanceof ValidationError || error instanceof DownloadError) {
      throw error;
    }
    throw new DownloadError(error.message);
  }
}

function releaseAssetUrl(version, fileName) {
  return `https://github.com/${RELEASE_OWNER}/${RELEASE_REPO}/releases/download/${version}/${fileName}`;
}

function isAllowedDownloadUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" &&
    (ALLOWED_DOWNLOAD_HOSTS.has(parsed.hostname) || parsed.hostname.endsWith(".githubusercontent.com"));
}

async function downloadFile(url, destination, integrity, redirects = 0) {
  if (redirects > 5) {
    throw new DownloadError(`Too many redirects while downloading ${url}`);
  }
  if (!isAllowedDownloadUrl(url)) {
    throw new DownloadError(`Refusing download from non-official URL: ${url}`);
  }

  await new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        rejectUnauthorized: true,
        headers: {
          "User-Agent": "ensure-advanced-canvas",
          Accept: "application/octet-stream",
        },
      },
      async (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;

        if (status >= 300 && status < 400 && location) {
          response.resume();
          try {
            await downloadFile(
              new URL(location, url).toString(),
              destination,
              integrity,
              redirects + 1,
            );
            resolve();
          } catch (error) {
            reject(error);
          }
          return;
        }

        if (status < 200 || status >= 300) {
          response.resume();
          reject(new DownloadError(`HTTP ${status} while downloading ${url}`));
          return;
        }

        const contentLength = Number(response.headers["content-length"]);
        if (Number.isFinite(contentLength) && contentLength > integrity.bytes) {
          response.resume();
          reject(
            new DownloadError(
              `Asset exceeds pinned size while downloading ${url}: ${contentLength} > ${integrity.bytes}`,
            ),
          );
          return;
        }

        let bytes = 0;
        const limiter = new Transform({
          transform(chunk, _encoding, callback) {
            bytes += chunk.length;
            if (bytes > integrity.bytes) {
              callback(
                new DownloadError(
                  `Asset exceeds pinned size while downloading ${url}: more than ${integrity.bytes} bytes`,
                ),
              );
              return;
            }
            callback(null, chunk);
          },
        });
        try {
          await pipeline(response, limiter, createWriteStream(destination, { flags: "wx" }));
          resolve();
        } catch (error) {
          reject(error);
        }
      },
    );
    request.on("error", reject);
    request.setTimeout(30000, () => {
      request.destroy(new DownloadError(`Timed out while downloading ${url}`));
    });
  });
}

async function validateReleaseDir(releaseDir, requestedVersion, { verifyPinned = false } = {}) {
  const pinned = PINNED_RELEASES[requestedVersion];
  if (verifyPinned && !pinned) {
    throw new ValidationError(`No pinned integrity metadata for Advanced Canvas ${requestedVersion}`);
  }
  for (const fileName of REQUIRED_RELEASE_FILES) {
    const filePath = path.join(releaseDir, fileName);
    if (!(await exists(filePath))) {
      throw new ValidationError(`Release file is missing: ${fileName}`);
    }
    const stats = await fs.stat(filePath);
    if (!stats.isFile() || stats.size === 0) {
      throw new ValidationError(`Release file is empty or not a file: ${fileName}`);
    }
    if (verifyPinned) {
      const expected = pinned[fileName];
      if (stats.size !== expected.bytes) {
        throw new ValidationError(
          `Integrity check failed for ${fileName}: expected ${expected.bytes} bytes, got ${stats.size}`,
        );
      }
      const digest = createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
      if (digest !== expected.sha256) {
        throw new ValidationError(`Integrity check failed for ${fileName}: SHA-256 mismatch`);
      }
    }
  }

  const manifest = await readJson(path.join(releaseDir, "manifest.json"));
  if (manifest.id !== PLUGIN_ID) {
    throw new ValidationError(`Downloaded manifest.id is "${manifest.id}", expected "${PLUGIN_ID}"`);
  }
  if (typeof manifest.version !== "string" || !isSemver(manifest.version)) {
    throw new ValidationError("Downloaded manifest.version is missing or invalid");
  }
  if (compareVersions(manifest.version, requestedVersion) < 0) {
    throw new ValidationError(
      `Downloaded manifest.version ${manifest.version} is lower than requested ${requestedVersion}`,
    );
  }
}

async function listInstallBackups(pluginDir) {
  const parent = path.dirname(pluginDir);
  const prefix = `${path.basename(pluginDir)}.backup-`;
  let entries;
  try {
    entries = await fs.readdir(parent, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => path.join(parent, entry.name))
    .sort();
}

async function recoverInterruptedInstall(pluginDir) {
  const backups = await listInstallBackups(pluginDir);
  if (backups.length === 0) return [];
  if (!(await exists(pluginDir))) {
    const newest = backups.pop();
    await fs.rename(newest, pluginDir);
  }
  for (const staleBackup of backups) {
    await fs.rm(staleBackup, { recursive: true, force: true });
  }
  return listInstallBackups(pluginDir);
}

async function installPluginFromTemp({ tempDir, pluginDir, pluginsDir }) {
  const dataPath = path.join(pluginDir, "data.json");
  const tempDataPath = path.join(tempDir, "data.json");
  if (await exists(dataPath)) {
    await fs.copyFile(dataPath, tempDataPath);
  } else {
    await fs.writeFile(tempDataPath, `${JSON.stringify({ nodeTemplates: [] }, null, 2)}\n`, "utf8");
  }

  const backupDir = `${pluginDir}.backup-${Date.now()}`;
  let movedExisting = false;
  try {
    await fs.mkdir(pluginsDir, { recursive: true });
    if (await exists(pluginDir)) {
      await fs.rename(pluginDir, backupDir);
      movedExisting = true;
    }
    await fs.rename(tempDir, pluginDir);
    if (movedExisting) {
      await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {});
    }
  } catch (error) {
    if (await exists(tempDir)) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
    if (movedExisting && !(await exists(pluginDir))) {
      await fs.rename(backupDir, pluginDir).catch(() => {});
    }
    throw error;
  }
}

function baseResult(version) {
  return {
    status: "unknown",
    version,
    installed: false,
    enabled: false,
    templatesAdded: 0,
    downloaded: false,
    degraded: false,
    warnings: [],
  };
}

function printResult(result, exitCode) {
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = exitCode;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    const result = baseResult(DEFAULT_VERSION);
    result.status = "error";
    result.warnings.push(error.message);
    printResult(result, error.exitCode ?? 2);
    return;
  }

  const result = baseResult(args.version);

  try {
    const { obsidianDir } = await validateVault(args.vault);
    const pluginsDir = path.join(obsidianDir, "plugins");
    const pluginDir = path.join(pluginsDir, PLUGIN_ID);
    const dataPath = path.join(pluginDir, "data.json");

    const interruptedBackups = await listInstallBackups(pluginDir);
    if (args.check && interruptedBackups.length > 0) {
      result.warnings.push(`${interruptedBackups.length} interrupted plugin install backup(s) require recovery`);
    } else if (!args.check) {
      const remainingBackups = await recoverInterruptedInstall(pluginDir);
      if (remainingBackups.length > 0) {
        result.warnings.push(`${remainingBackups.length} stale plugin install backup(s) remain`);
      }
    }

    let pluginState = await inspectPlugin(pluginDir, args.version);
    result.version = pluginState.version ?? args.version;
    result.installed = pluginState.healthy;
    result.warnings.push(...pluginState.warnings);
    for (const missingFile of pluginState.missing) {
      result.warnings.push(`Missing plugin file: ${missingFile}`);
    }

    try {
      result.enabled = (await inspectEnabled(obsidianDir)).enabled;
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      if (args.check) {
        result.warnings.push(error.message);
      } else {
        throw error;
      }
    }

    if (args.check) {
      if (pluginState.healthy) {
        const missingTemplates = await countMissingTemplates(dataPath);
        if (missingTemplates > 0) {
          result.warnings.push(`${missingTemplates} MindMap templates are missing`);
        }
      }
      result.status = pluginState.healthy && result.enabled && result.warnings.length === 0 ? "ok" : "needs_action";
      printResult(result, 0);
      return;
    }

    if (!pluginState.healthy) {
      let tempDir;
      const installVersion = chooseInstallVersion(args.version, pluginState.version);
      try {
        tempDir = await acquireReleaseFiles({
          obsidianDir,
          version: installVersion,
          sourceDir: args.sourceDir,
        });
      } catch (error) {
        if (error instanceof DownloadError) {
          result.status = "degraded";
          result.degraded = true;
          result.downloaded = false;
          result.warnings.push(`Advanced Canvas install skipped: ${error.message}`);
          printResult(result, 0);
          return;
        }
        throw error;
      }

      await installPluginFromTemp({ tempDir, pluginDir, pluginsDir });
      result.downloaded = !args.sourceDir;
      pluginState = await inspectPlugin(pluginDir, args.version);
      result.version = pluginState.version ?? args.version;
      result.installed = pluginState.healthy;
      result.warnings = pluginState.warnings;
      for (const missingFile of pluginState.missing) {
        result.warnings.push(`Missing plugin file after install: ${missingFile}`);
      }
      if (!pluginState.healthy) {
        throw new ValidationError("Installed Advanced Canvas plugin failed integrity validation");
      }
    }

    result.enabled = await enablePlugin(obsidianDir);
    result.templatesAdded = await mergeMindMapTemplates(dataPath);
    result.status = "ok";
    result.degraded = false;
    printResult(result, 0);
  } catch (error) {
    result.status = "error";
    result.warnings.push(error.message);
    printResult(result, error.exitCode ?? 1);
  }
}

main();
