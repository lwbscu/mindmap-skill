const { contextBridge, ipcRenderer } = require("electron");

const channels = Object.freeze({
  openJson: "mindmap:open-json",
  saveJson: "mindmap:save-json",
  saveJsonAs: "mindmap:save-json-as",
  listProjects: "mindmap:projects:list",
  createProject: "mindmap:projects:create",
  openProject: "mindmap:projects:open",
  authorizeProject: "mindmap:projects:authorize",
});

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

contextBridge.exposeInMainWorld("mindmapDesktop", {
  platform: process.platform,
  isDesktop: true,
  openJson: () => ipcRenderer.invoke(channels.openJson),
  saveJson: ({ diagram } = {}) => ipcRenderer.invoke(channels.saveJson, {
    diagram: cloneJson(diagram),
  }),
  saveJsonAs: ({ suggestedName, diagram } = {}) => ipcRenderer.invoke(channels.saveJsonAs, {
    suggestedName: typeof suggestedName === "string" ? suggestedName : "mindmap.diagram.json",
    diagram: cloneJson(diagram),
  }),
  projects: {
    list: () => ipcRenderer.invoke(channels.listProjects),
    create: ({ name, diagram } = {}) => ipcRenderer.invoke(channels.createProject, {
      name: typeof name === "string" ? name : "",
      diagram: cloneJson(diagram),
    }),
    open: ({ fileName } = {}) => ipcRenderer.invoke(channels.openProject, {
      fileName: typeof fileName === "string" ? fileName : "",
    }),
    authorize: ({ filePath } = {}) => ipcRenderer.invoke(channels.authorizeProject, {
      filePath: typeof filePath === "string" ? filePath : "",
    }),
  },
});
