import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertValidDiagram } from "../app/diagram-validator.mjs";

const PROJECT_SUFFIX = ".diagram.json";
const MAX_PROJECT_NAME_LENGTH = 80;

function serializeDiagram(diagram) {
  assertDiagramShape(diagram);
  return `${JSON.stringify(diagram, null, 2)}\n`;
}

function assertDiagramShape(diagram) {
  return assertValidDiagram(diagram);
}

function stripProjectSuffix(value) {
  return value.toLowerCase().endsWith(PROJECT_SUFFIX)
    ? value.slice(0, -PROJECT_SUFFIX.length)
    : value;
}

export function sanitizeProjectName(value) {
  const source = stripProjectSuffix(String(value ?? "").normalize("NFKC").trim());
  const safe = source
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/[\s-]+/g, "-")
    .replace(/^[.\s-]+|[.\s-]+$/g, "")
    .slice(0, MAX_PROJECT_NAME_LENGTH)
    .replace(/[.\s-]+$/g, "");
  return safe || "untitled";
}

function assertProjectFileName(fileName) {
  if (typeof fileName !== "string" || !fileName.endsWith(PROJECT_SUFFIX)) {
    throw new Error(`Project fileName must end with ${PROJECT_SUFFIX}.`);
  }
  if (
    fileName !== path.basename(fileName)
    || fileName.startsWith(".")
    || fileName.length > MAX_PROJECT_NAME_LENGTH + PROJECT_SUFFIX.length + 8
    || /[\u0000-\u001f\u007f<>:"/\\|?*]/.test(fileName)
  ) {
    throw new Error("Unsafe project fileName.");
  }
  const name = fileName.slice(0, -PROJECT_SUFFIX.length);
  if (!name || name === "." || name === "..") {
    throw new Error("Unsafe project fileName.");
  }
  return fileName;
}

function createBlankDiagram(title) {
  return {
    schemaVersion: "mindmap-app/v1",
    title,
    subtitle: "",
    language: "zh-CN",
    canvas: {
      width: 2400,
      height: 1480,
      background: "#ffffff"
    },
    style: {
      fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans CJK SC, Microsoft YaHei, sans-serif",
      text: "#111827",
      muted: "#475569",
      panelFill: "#ffffff",
      panelStroke: "#cbd5e1",
      nodeFill: "#ffffff",
      nodeStroke: "#2563eb",
      edge: "#94a3b8",
      labelStroke: "#cbd5e1"
    },
    layers: [],
    nodes: [],
    edges: [],
    assets: {},
    savedViews: []
  };
}

function assertInsideDirectory(directory, fileName) {
  const resolved = path.resolve(directory, assertProjectFileName(fileName));
  if (path.dirname(resolved) !== directory) {
    throw new Error("Project path escapes projects directory.");
  }
  return resolved;
}

async function assertRegularProjectFile(filePath) {
  const stat = await fs.lstat(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("Project path must be a regular file.");
  }
  return stat;
}

async function writeAtomically(filePath, content) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporaryPath, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

export function createProjectStore({ projectsDir }) {
  if (typeof projectsDir !== "string" || !path.isAbsolute(projectsDir)) {
    throw new Error("projectsDir must be an absolute path.");
  }
  const directory = path.resolve(projectsDir);

  async function ensureDirectory() {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("MindMap projects path must be a real directory.");
    }
  }

  async function list() {
    await ensureDirectory();
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const projects = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(PROJECT_SUFFIX)) continue;
      const filePath = assertInsideDirectory(directory, entry.name);
      try {
        const stat = await assertRegularProjectFile(filePath);
        const content = await fs.readFile(filePath, "utf8");
        const diagram = JSON.parse(content);
        assertDiagramShape(diagram);
        const name = entry.name.slice(0, -PROJECT_SUFFIX.length);
        projects.push({
          fileName: entry.name,
          name,
          title: typeof diagram?.title === "string" && diagram.title.trim() ? diagram.title : name,
          modifiedAt: stat.mtime.toISOString(),
          size: stat.size
        });
      } catch {
        // Invalid, unreadable, or non-regular files are not exposed as projects.
      }
    }
    projects.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt) || left.name.localeCompare(right.name));
    return projects;
  }

  async function create({ name, diagram } = {}) {
    await ensureDirectory();
    const title = typeof diagram?.title === "string" && diagram.title.trim()
      ? diagram.title.trim()
      : String(name ?? "").trim() || "未命名项目";
    const baseName = sanitizeProjectName(name || title);
    const storedDiagram = diagram === undefined
      ? createBlankDiagram(title)
      : JSON.parse(serializeDiagram(diagram));
    const content = serializeDiagram(storedDiagram);

    for (let index = 1; index < 10000; index += 1) {
      const numberedName = index === 1 ? baseName : `${baseName}-${index}`;
      const fileName = `${numberedName}${PROJECT_SUFFIX}`;
      const filePath = assertInsideDirectory(directory, fileName);
      try {
        await fs.writeFile(filePath, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
        return { filePath, fileName, diagram: storedDiagram };
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
    }
    throw new Error("Unable to allocate a unique project fileName.");
  }

  async function open({ fileName } = {}) {
    await ensureDirectory();
    const filePath = assertInsideDirectory(directory, fileName);
    await assertRegularProjectFile(filePath);
    const diagram = JSON.parse(await fs.readFile(filePath, "utf8"));
    assertDiagramShape(diagram);
    return { filePath, fileName, diagram };
  }

  async function save({ fileName, diagram } = {}) {
    await ensureDirectory();
    const filePath = assertInsideDirectory(directory, fileName);
    await assertRegularProjectFile(filePath);
    const content = serializeDiagram(diagram);
    await writeAtomically(filePath, content);
    return { filePath, fileName };
  }

  async function authorize({ filePath } = {}) {
    await ensureDirectory();
    if (typeof filePath !== "string" || !filePath) throw new Error("Project filePath is required.");
    const fileName = path.basename(filePath);
    const expectedPath = assertInsideDirectory(directory, fileName);
    if (path.resolve(filePath) !== expectedPath) throw new Error("Project filePath is outside the projects directory.");
    await open({ fileName });
    return { filePath: expectedPath, fileName };
  }

  return Object.freeze({
    projectsDir: directory,
    list,
    create,
    open,
    save,
    authorize
  });
}
