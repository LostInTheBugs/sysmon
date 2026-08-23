'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sysmon', {
  onSnapshot: cb => ipcRenderer.on('snapshot', (_e, snap) => cb(snap)),
  onSlaves: cb => ipcRenderer.on('slaves', (_e, list) => cb(list)),
  onConfig: cb => ipcRenderer.on('config', (_e, cfg) => cb(cfg)),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: patch => ipcRenderer.invoke('config:set', patch),
  listSlaves: () => ipcRenderer.invoke('slaves:list'),
  setSlave: (id, action) => ipcRenderer.invoke('slaves:set', id, action),
  openDashboard: () => ipcRenderer.invoke('open:dashboard'),
  openSettings: () => ipcRenderer.invoke('open:settings'),
  refresh: () => ipcRenderer.invoke('sysinfo:refresh'),
  getHistory: () => ipcRenderer.invoke('history:get'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  getUpdate: () => ipcRenderer.invoke('update:last'),
  openUpdate: url => ipcRenderer.invoke('update:open', url)
});
