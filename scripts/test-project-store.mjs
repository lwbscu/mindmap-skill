#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createProjectStore } from "../desktop/project-store.mjs";

function blankDiagram(title = "未命名项目") {
  return {
    schemaVersion: "mindmap-app/v1",
    title,
    subtitle: "",
    canvas: { width: 2400, height: 1480, background: "#ffffff" },
    style: {},
    layers: [],
    nodes: [],
    edges: [],
    assets: {},
  };
}

const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mindmap-project-store-"));
const projectsDir = path.join(sandboxRoot, "projects");

try {
  const store = createProjectStore({ projectsDir });
  assert.equal(path.resolve(store.projectsDir), path.resolve(projectsDir));

  const firstDiagram = blankDiagram("空白架构");
  const first = await store.create({ name: "空白架构", diagram: firstDiagram });
  assert.ok(first.fileName.endsWith(".diagram.json"));
  assert.equal(path.dirname(path.resolve(first.filePath)), path.resolve(projectsDir));
  assert.deepEqual(JSON.parse(await fs.readFile(first.filePath, "utf8")), firstDiagram);

  const duplicate = await store.create({ name: "空白架构", diagram: firstDiagram });
  assert.notEqual(duplicate.fileName, first.fileName, "duplicate project names must not overwrite existing files");
  await fs.access(duplicate.filePath);

  const entries = await store.list();
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.fileName).sort(), [first.fileName, duplicate.fileName].sort());
  assert.ok(entries.every((entry) => entry.fileName.endsWith(".diagram.json")));

  const opened = await store.open({ fileName: first.fileName });
  assert.equal(opened.filePath, first.filePath);
  assert.deepEqual(opened.diagram, firstDiagram);
  const authorized = await store.authorize({ filePath: first.filePath });
  assert.equal(authorized.fileName, first.fileName);

  const updatedDiagram = { ...firstDiagram, title: "已保存空白架构" };
  const saved = await store.save({ fileName: first.fileName, diagram: updatedDiagram });
  assert.equal(saved.filePath, first.filePath);
  assert.deepEqual(JSON.parse(await fs.readFile(first.filePath, "utf8")), updatedDiagram);

  const outsidePath = path.join(sandboxRoot, "outside.diagram.json");
  await fs.writeFile(outsidePath, JSON.stringify(blankDiagram("outside")), "utf8");
  await assert.rejects(store.authorize({ filePath: outsidePath }), /outside|project|path/i);
  await assert.rejects(store.open({ fileName: "../outside.diagram.json" }), /project|path|outside|escape|invalid/i);
  await assert.rejects(store.save({ fileName: "../outside.diagram.json", diagram: firstDiagram }), /project|path|outside|escape|invalid/i);
  assert.equal(JSON.parse(await fs.readFile(outsidePath, "utf8")).title, "outside");

  await assert.rejects(
    store.create({ name: "invalid", diagram: { title: "invalid" } }),
    /schemaVersion|diagram/i,
  );
  await fs.writeFile(path.join(projectsDir, "broken.diagram.json"), JSON.stringify({ title: "broken" }), "utf8");
  await assert.rejects(store.open({ fileName: "broken.diagram.json" }), /schemaVersion|diagram/i);

  const linkedProjectPath = path.join(projectsDir, "linked.diagram.json");
  await fs.symlink(outsidePath, linkedProjectPath);
  await assert.rejects(store.open({ fileName: "linked.diagram.json" }), /regular|symbolic|project|path/i);
  assert.equal((await store.list()).some((entry) => entry.fileName === "linked.diagram.json"), false);

  const traversal = await store.create({ name: "../../escape", diagram: firstDiagram });
  assert.equal(path.dirname(path.resolve(traversal.filePath)), path.resolve(projectsDir));
  assert.equal(path.relative(projectsDir, traversal.filePath).startsWith(".."), false);

  const generatedBlank = await store.create({ name: "真正空白" });
  assert.equal(generatedBlank.diagram.schemaVersion, "mindmap-app/v1");
  assert.equal(generatedBlank.diagram.title, "真正空白");
  assert.deepEqual(generatedBlank.diagram.nodes, []);
  assert.deepEqual(generatedBlank.diagram.edges, []);
  assert.equal((await fs.readdir(projectsDir)).some((fileName) => fileName.endsWith(".tmp")), false);

  console.log(JSON.stringify({
    ok: true,
    projectsDir: path.relative(sandboxRoot, projectsDir),
    created: [first.fileName, duplicate.fileName, traversal.fileName, generatedBlank.fileName],
  }, null, 2));
} finally {
  await fs.rm(sandboxRoot, { recursive: true, force: true });
}
