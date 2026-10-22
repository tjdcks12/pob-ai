# Architecture

PoB AI drives the Path of Building (PoE2) that the user installed, without changing any of its
files. Three pieces work together:

```mermaid
flowchart LR
  subgraph Agent[AI agent: Claude Code / Codex]
    A[pob CLI]
  end
  Panel[Agent panel<br/>ui/] -->|HTTP + SSE| Service
  A -->|HTTP| Service[PoB AI service<br/>src/service]
  MCP[Any MCP client] -->|/mcp| Service
  Service -->|TCP, one JSON line per request| Bridge[adapter/live/bridge.lua<br/>inside the PoB window]
  Service -->|stdin/stdout| Engine[Headless engine<br/>src/engine/worker.mjs + adapter/headless.lua]
  Bridge --> Ops[adapter/ops/*.lua]
  Engine --> Ops
  Ops --> PoB[(User's PoB Lua code)]
```

## The PoB window: shim, not a patch

The PoB launcher (`Path of Building-PoE2.exe`) is a small program that loads the DLL named on
the first line of a Lua script (`#@ SimpleGraphic`) and runs that script. It accepts the script
as its first argument. PoB AI starts

```
"Path of Building-PoE2.exe" "<pob-ai>/adapter/shim.lua"
```

`adapter/shim.lua` points module loading back at the PoB folder (`GetScriptPath`, `LoadModule`,
`PLoadModule`), runs PoB's own `Launch.lua`, and after PoB has initialised loads
`adapter/live/bridge.lua`, which wraps `main.OnFrame`:

1. Before PoB's frame: read at most one request from the service, run it, reply.
2. PoB's own frame (input, recalculation, drawing).
3. After the frame: draw the agent's highlight overlay (`adapter/live/overlay.lua`).

Operations that need PoB to lay out or recalculate (switching tabs, opening a build) wait for a
frame with `util.waitFrame()`; requests run as coroutines so the window never blocks. Calls that
start PoB sub-scripts (trade, account import) must not run inside a coroutine; `util.onMain()`
hands them back to the frame loop.

Because nothing in the PoB folder is modified, PoB's own update check keeps working and its
updates are never overwritten. PoB applies most updates by restarting its Lua state in place
(`Restart()`); the shim makes that restart run the shim again, so the bridge reconnects by itself.
A "basic" update exits and PoB's updater starts plain PoB; the shim reports the update first, and
the service closes that window and opens PoB again with the shim (`src/pob/processes.mjs`).
The window writes its own log to `logs/pob-window.log` in the data folder.

## The headless engine

When the PoB window is not open, commands run in a background process. `src/engine/worker.mjs`
loads PoB's own `lua51.dll` (LuaJIT) through [koffi](https://koffi.dev) and runs
`adapter/headless.lua`, which provides the window functions PoB expects (the same set as PoB's
`HeadlessWrapper.lua`) and blocks file writes except explicit saves. The current headless build
is kept in the data folder (`session/current.xml`) so consecutive CLI calls build on each other.

LuaJIT opens files through the ANSI code page, so a PoB folder with non-ASCII characters
(for example `한글 POB`) is reached through a directory junction in the data folder.

## Operations

`adapter/ops/*.lua` implement every command by calling the same PoB objects the GUI uses,
including undo states and unsaved flags (see [POB_INTERNALS.md](POB_INTERNALS.md)). They run in
both modes. `src/commands/registry.mjs` defines names, arguments and help once; the CLI, the HTTP
API, the MCP server and [COMMANDS.md](COMMANDS.md) are generated from it. A few commands run in
Node first (`local` in the registry): downloads, build files, item text conversion.

## The PoB window in other languages and colours

PoB draws all text with `DrawString` and bitmap fonts that only hold ASCII glyphs (SimpleGraphic
keeps 128 glyphs per font size). `adapter/live/translate.lua` wraps `DrawString` and
`DrawStringWidth`: a phrase found in the language's dictionary is drawn as an image instead.
The service builds the dictionary (`src/live/window-language.mjs`) from official names in the
game client data (`data/terms`, `data/items`) and PoB's interface text translated in
`data/ui/<language>.json` (extracted with `scripts/extract-ui-strings.mjs`), and renders each
phrase to a PNG with a Windows font for the script (`src/live/text-renderer.ps1`, GDI+). Images
are cached on disk; text with no translation is drawn by PoB as before.

`adapter/live/theme.lua` recolours the window by mapping the colours passed to `SetDrawColor`,
the colour codes inside text and the clear colour.

## Item text in other languages

PoB reads English item text only. `src/items/` converts game copy text (Ctrl+C) from ten client
languages into the English PoB expects: Korean through the official trade stat lists (cached for a
day), the others through the bundled language packs in `data/items/`. Lines that cannot be
converted are reported back instead of being silently dropped.

## The agent

`src/agent/hub.mjs` runs the agent CLI the user is already signed in to, in non-interactive mode,
once per chat turn, and resumes the same conversation on the next turn. The agent works in a
folder whose `CLAUDE.md` / `AGENTS.md` explain the `pob` command line. PoB AI pre-approves only
`pob …` commands for Claude Code and disables its file editing tools; the user's own Claude Code
permission settings still apply.

## Distribution and updates

The release is one zip with Node.js included (`scripts/package.mjs`). `PoB AI.cmd` runs
`launcher.mjs`, which starts the newest PoB AI on the computer: its own copy or a newer one that
`pob update apply` unpacked into the data folder (`app/<version>`, recorded in `app/current.json`).
The updater (`src/update/updater.mjs`) reads `latest.json` (`{ version, url, sha256, size }`),
downloads and verifies the zip and never touches the folder the user unzipped.

The service keeps its HTTP address and the bridge address (`service.json`, `bridge.json`) across
restarts, so after an update the open PoB window and agent panel reconnect to the new service.
`pob doctor` checks the install, runs a headless self-test of the adapter against the installed
PoB, and reports the window connection, updates and agents. `pob setup --install-pob` installs
the portable PoB from its GitHub releases into the data folder.

## Data folder

`%LOCALAPPDATA%\pob-ai` (override with `POB_AI_HOME`): settings, the service and bridge
addresses, the headless session build, agent chats, window language dictionaries and images,
caches, installed updates, an optional PoB install and logs. Nothing is written to the PoB folder except
what the user asks for: saved, moved or deleted builds and PoB options (Settings.xml).

## Version support

Verified with PoB PoE2 0.22.0 and 0.23.1. `util.new()` hides the constructor style change between
them (`new("X", …)` vs `new("X"):X(…)`). `npm test` runs the engine suite against whatever PoB it
finds (`POB_PATH`), including a check that every registry command has an adapter operation.
