import { contextBridge, ipcRenderer, desktopCapturer } from 'electron'

contextBridge.exposeInMainWorld('glide', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:set', patch),
  closeWindow: () => ipcRenderer.send('window:close'),
  getAccentColor: () => ipcRenderer.invoke('system:accentColor'),
  testConnection: () => ipcRenderer.invoke('api:test') as Promise<{ ok: boolean; error?: string }>,
  onSuggestionUpdate: (cb: (text: string) => void) =>
    ipcRenderer.on('suggestion:update', (_e, text) => cb(text)),
  onSuggestionAppend: (cb: (token: string) => void) =>
    ipcRenderer.on('suggestion:append', (_e, token) => cb(token))
})

// Screen capture: main asks this renderer to capture via desktopCapturer
ipcRenderer.on('screen:capture-request', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 720 }
    })
    const b64 = sources[0]?.thumbnail?.toPNG().toString('base64') ?? null
    ipcRenderer.send('screen:capture-result', b64)
  } catch {
    ipcRenderer.send('screen:capture-result', null)
  }
})
