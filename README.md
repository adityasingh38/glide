# Glide

System-wide AI inline autocomplete for Windows — ghost text suggestions as you type in any app, powered by Claude.

## How it works

Glide runs as a system tray app and watches what you type globally (via `uiohook-napi`). After a short pause it requests a completion from the Claude API. The suggestion appears as ghost text near your cursor. Press `Ctrl+Space` to accept it — the text is injected via clipboard swap, so it works in any application.

## Hotkeys

| Shortcut | Action |
|---|---|
| `Ctrl+Space` | Accept suggestion |
| `Ctrl+Shift+Space` | Trigger prediction manually |
| `Esc` | Dismiss suggestion |

## Setup

1. Get a Claude API key from [console.anthropic.com](https://console.anthropic.com)
2. Download and install the latest `.exe` from [Releases](../../releases)
3. Click the tray icon → **Settings…** → paste your API key
4. Start typing anywhere — suggestions appear after you pause

## Development

```bash
npm install
npm run dev        # dev mode with HMR
npm run build      # production build (dist/)
npm run build:win  # production + Windows installer
npm run typecheck  # type check only
```

**Stack:** Electron + React + TypeScript + Tailwind v4  
**AI:** `@anthropic-ai/sdk` (Claude Haiku 4.5 by default — fast and cheap)  
**Win32 FFI:** `koffi` (no node-gyp)  
**Global hooks:** `uiohook-napi`  

## Tech notes

- Text injection uses a clipboard swap + `SendInput(Ctrl+V)` — works universally without per-app integration
- Caret position is read via `GetGUIThreadInfo` + `ClientToScreen`; overlay window flips above the caret if near the screen bottom
- No data leaves your machine except the last ~600 characters of your typing buffer sent to the Claude API
- API key is stored locally in Electron's `userData` directory

## License

MIT
