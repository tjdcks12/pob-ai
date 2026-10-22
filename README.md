<div align="center">

<img src="ui/icon.svg" width="88" alt="PoB AI">

# PoB AI

**An AI agent and a command line for Path of Building (PoE2).**<br>
Ask in plain words. The agent reads your build, changes it, calculates, and points at the exact spot in PoB.

[![License: MIT](https://img.shields.io/badge/license-MIT-e9a948.svg)](LICENSE)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-2b2b2b.svg)
![Node 22+](https://img.shields.io/badge/node-22%2B-3c873a.svg)
![PoB PoE2 0.22–0.23](https://img.shields.io/badge/PoB%20PoE2-0.22%20%E2%80%93%200.23-8a5a2b.svg)

English · [한국어](README.ko.md)

</div>

<p align="center">
  <img src="docs/images/tree-highlight.jpg" width="72%" alt="PoB AI centres the passive tree on the best nearby notable and labels the calculated gain">
  <img src="docs/images/panel-en.jpg" width="24%" alt="The PoB AI agent panel">
</p>
<p align="center"><sub>Left: <code>pob calc node-power</code> found the best notable within 5 points, and <code>pob ui show-node</code> centred and labelled it in PoB. Right: the agent panel.</sub></p>

---

## Why

Path of Building is the most precise tool for Path of Exile 2 builds, and it takes years to learn
where everything lives. PoB AI lets an AI agent do the clicking for you — through a complete
command line, so every step is real PoB work you can see, undo and save.

- **Your PoB, untouched.** PoB AI starts the Path of Building you already installed through an
  external entry script. No PoB file is modified, so PoB keeps updating itself and you never
  download a patched copy.
- **The whole editor from the command line.** 90+ commands cover builds, character, passive tree,
  skills and gems, items, configuration, calculations and notes.
- **It shows you where.** Ask "where do I set the enemy type?" and the agent switches PoB to the
  Configuration tab and highlights the option. Nodes, item slots, gem groups and stats work the same way.
- **Real numbers only.** What-if calculations, passive node ranking and build comparison use PoB's
  own calculator.
- **Game text in your language.** Paste an item copied from the game in any of ten client
  languages; it is converted to the English text PoB reads, and lines that cannot be converted
  are reported instead of silently dropped.
- **Uses the agent you already have.** Claude Code (or Codex) runs with your existing sign-in.
  No API keys.

## Quick start

**Requirements:** Windows 10/11, [Node.js 22+](https://nodejs.org),
[Path of Building Community (PoE2)](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/releases),
and for chat, [Claude Code](https://docs.claude.com/en/docs/claude-code) signed in.

```bash
git clone https://github.com/<you>/pob-ai.git
cd pob-ai
npm install
```

Then double-click **`PoB AI.cmd`** — it opens your PoB and the agent panel.

PoB AI finds PoB in the usual install locations. For a portable copy, tell it once:

```bash
node bin/pob.mjs setup "D:\Games\Path of Building PoE2"
```

To use `pob` from any terminal, run `npm link` once.

## Talk to it

> Set up PoB to measure my damage properly against a pinnacle boss.

> Which passive within 6 points gives me the most damage? Show me where it is.

> Import https://pobb.in/… and compare it with my build.

> Add this item and tell me what it changes — *(paste the item copied in game)*

The agent answers in your language and uses the official in-game names.

## The `pob` command line

Every command prints JSON, so agents and scripts can use it directly.

```bash
pob build import https://pobb.in/abc123          # code or link: pobb.in, poe.ninja, Maxroll, poe2db, pastebin
pob tree allocate "Essence of the Storm" --attribute int
pob skills add Spark "Controlled Destruction" --level 20
pob config set enemyIsBoss Pinnacle
pob calc whatif --node "Clean Shot"              # numbers without keeping the change
pob calc node-power --limit 5                    # best nearby notables by Full DPS
pob items add --text "<item copied in game>" --equip "Ring 1"
pob ui show-config enemyIsBoss                   # highlight it in the PoB window
pob build save --name "Spark Ranger v2"
```

| Group | What it covers |
| --- | --- |
| `build` | new, open, list, import, export, save / save as, rename |
| `character` | level, class, ascendancy |
| `tree` | search, allocate (with weapon sets and attributes), deallocate, reset, tree sets, version conversion |
| `skills` · `gems` | groups, gems, levels, quality, main skill, skill parts, minions, skill sets |
| `items` | add from game text, uniques, custom crafts, equip, flasks & charms, weapon swap, item sets |
| `config` | every configuration option, configuration sets |
| `calc` | stats, per-skill DPS, warnings, what-if, node power, build comparison |
| `notes` | read and write build notes |
| `ui` | switch tabs and highlight nodes, slots, gems, options and stats in the PoB window; window themes |

Full reference: **[docs/COMMANDS.md](docs/COMMANDS.md)**. `pob help <group> <action>` shows the same in the terminal.

When the PoB window is open, commands change what you see there. Without it, they work on a
background copy of your build, so agents can explore ideas without touching your screen.

## How it works

```mermaid
flowchart LR
  you([You]) --> panel[Agent panel]
  panel --> agent[Claude Code / Codex]
  agent -->|pob …| service[PoB AI service]
  service -->|live| pob[Your PoB window]
  service -->|background| engine[Headless PoB]
```

The PoB launcher accepts an entry script as its first argument. PoB AI starts your PoB with
`adapter/shim.lua`, which loads PoB normally and adds a small bridge that runs commands between
frames and draws the highlights. The same Lua operations also run without a window, inside PoB's
own LuaJIT, for background work. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

It also speaks **MCP**: any MCP client can use the same commands as tools at the service's `/mcp` endpoint.

## Languages and themes

- The panel is available in English, 한국어, 日本語, 繁體中文, Русский, Deutsch, Français,
  Español, Português (Brasil) and ไทย.
- Item text copied from the game in those languages is converted for PoB.
- The panel has four themes; the PoB window can be recoloured with `pob ui theme ember|vaal|midnight`
  (remembered for next time; `default` restores PoB's colours).

PoB's own editor text stays in English: its bitmap fonts only contain ASCII characters.

## Privacy

Everything runs on your PC. PoB AI connects to the internet only to download a build you ask
it to import, and — for Korean item text — to fetch the official trade stat lists from Grinding
Gear Games / Kakao (cached for a day). Chats go to the agent you chose, under its own terms.

## Status

Early preview. The commands, the PoB window bridge and the background engine are verified with
PoB PoE2 0.22.0 and 0.23.1 on Windows 11. The agent chat is implemented for Claude Code and Codex
and tested end to end with a stand-in agent; a full run with a live Claude Code or Codex session
is still to be verified. Not yet automated: PoE account character
import (use PoB's Import tab — `pob ui tab import` takes you there), trade searches and timeless
jewel search.

```bash
npm test     # unit tests, plus engine tests against your PoB (set POB_PATH if it is not found)
```

## License

[MIT](LICENSE), like Path of Building. PoB AI does not include Path of Building or game data;
see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

PoB AI is an unofficial community project, not affiliated with Grinding Gear Games or the Path of
Building Community. Path of Exile is a trademark of Grinding Gear Games.
