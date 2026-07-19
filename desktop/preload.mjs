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
  saveJson: ({ diagram } = {}) => ipcRenderer.invoke(channels.saveJson, {
    diagram: cloneJson(diagram)
  }),
  saveJsonAs: ({ suggestedName, diagram } = {}) => ipcRenderer.invoke(channels.saveJsonAs, {
    suggestedName: typeof suggestedName === "string" ? suggestedName : "mindmap.diagram.json",
    diagram: cloneJson(diagram)
  })
});
