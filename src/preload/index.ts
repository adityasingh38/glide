import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('cotypist', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:set', patch),
  closeWindow: () => ipcRenderer.send('window:close'),
  onSuggestionUpdate: (cb: (text: string) => void) =>
    ipcRenderer.on('suggestion:update', (_e, text) => cb(text)),
  onSuggestionAppend: (cb: (token: string) => void) =>
    ipcRenderer.on('suggestion:append', (_e, token) => cb(token))
})
