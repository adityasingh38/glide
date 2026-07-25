import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('glide', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:set', patch),
  closeWindow: () => ipcRenderer.send('window:close'),
  getAccentColor: () => ipcRenderer.invoke('system:accentColor'),
  testConnection: () => ipcRenderer.invoke('api:test') as Promise<{ ok: boolean; error?: string }>,
  getLocalStatus: () =>
    ipcRenderer.invoke('local:status') as Promise<{ status: string; detail: string }>,
  onSuggestionUpdate: (cb: (text: string) => void) =>
    ipcRenderer.on('suggestion:update', (_e, text) => cb(text)),
  onSuggestionAppend: (cb: (token: string) => void) =>
    ipcRenderer.on('suggestion:append', (_e, token) => cb(token)),
  // Lets the overlay confirm it actually painted, so a broken bridge can't look
  // like a working suggestion in the logs.
  reportRendered: (info: { chars: number; visible: boolean }) =>
    ipcRenderer.send('suggestion:rendered', info)
})

// Screen capture used to live here, but desktopCapturer is main-process-only
// since Electron 17 — it was `undefined` in this context, so every capture threw
// and screen context silently never worked. It now runs in src/main/screen-context.ts.
