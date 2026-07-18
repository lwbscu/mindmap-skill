import { contextBridge, ipcRenderer } from "electron";

const channels = {
  openJson: "mindmap:open-json",
  saveJson: "mindmap:save-json",
  saveJsonAs: "mindmap:save-json-as"
};

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

contextBridge.exposeInMainWorld("mindmapDesktop", {
  platform: process.platform,
  isDesktop: true,
  openJson: () => ipcRenderer.invoke(channels.openJson),
  saveJson: ({ filePath, diagram } = {}) => ipcRenderer.invoke(channels.saveJson, {
    filePath: typeof filePath === "string" ? filePath : "",
    diagram: cloneJson(diagram)
  }),
  saveJsonAs: ({ filePath, diagram } = {}) => ipcRenderer.invoke(channels.saveJsonAs, {
    filePath: typeof filePath === "string" ? filePath : "",
    diagram: cloneJson(diagram)
  })
});
