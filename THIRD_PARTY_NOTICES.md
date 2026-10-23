# Third-party notices

PoB AI does not include Path of Building: it runs the copy of Path of Building (PoE2) you install
yourself, unmodified. It does bundle game text (see Game content below). It runs the copy of
Path of Building (PoE2) that you install yourself, unmodified.

## Path of Building Community (PoE2)

`adapter/headless.lua` provides the same host functions as PoB's
`src/HeadlessWrapper.lua` and follows its structure. PoB is released under the
MIT License:

```
Copyright (c) 2016 David Gowor

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Source: https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2

## Microsoft Edge WebView2

The separate Windows panel uses the Evergreen WebView2 Runtime installed on Windows.
The small host bundles the unmodified .NET SDK assemblies and x64 loader from
Microsoft.Web.WebView2 1.0.4314.35 (NuGet). Its redistribution license and notices ship
in desktop/bin/WebView2-LICENSE.txt and WebView2-NOTICE.txt.
https://www.nuget.org/packages/Microsoft.Web.WebView2/

## koffi

Node.js foreign function interface used to load PoB's `lua51.dll`.
MIT License, Copyright (c) Niels Martignène. https://koffi.dev
The release zip contains only its Windows x64 binary (`node_modules/koffi`, with its LICENSE.txt).

## Node.js

The Windows release bundles the Node.js runtime in `runtime/node/` so nothing has to be installed.
Node.js is MIT licensed and includes third-party components under their own licenses; the full
text ships next to it as `runtime/node/LICENSE`. https://nodejs.org

## Pretendard

`data/fonts/Pretendard-Regular.ttf` and `data/fonts/Pretendard-Bold.ttf` (Pretendard 1.3.9) draw
the text of the PoB window, and `ui/fonts/PretendardVariable.woff2` the agent panel. They are distributed unmodified under the SIL Open Font License 1.1,
whose full text ships next to them as `data/fonts/Pretendard-LICENSE.txt` and `ui/fonts/Pretendard-LICENSE.txt`:
Copyright (c) 2021, Kil Hyung-jin, with Reserved Font Name Pretendard.
https://github.com/orioncactus/pretendard

## JetBrains Mono

`ui/fonts/jetbrains-mono-latin-400-normal.woff2` and `-600-normal.woff2` (via Fontsource 5.3.0) show
numbers in the agent panel. SIL Open Font License 1.1, Copyright 2020 The JetBrains Mono Project
Authors; the full text ships as `ui/fonts/JetBrainsMono-LICENSE.txt`. https://github.com/JetBrains/JetBrainsMono

## Lucide icons

`ui/icons.svg` and the title bar icons in `adapter/live/assets/` (minus, square, copy, x, sparkles,
drawn as PNG) come from Lucide 0.486.0. ISC License, Copyright (c) Lucide Contributors 2022; portions
Copyright (c) Cole Bemis 2013-2022 as part of Feather (MIT). https://lucide.dev

## Agent provider marks

`ui/agents/claude.svg` and `ui/agents/codex.svg` come from @lobehub/icons-static-svg 1.95.1 (MIT),
unmodified (`ui/agents/source.json`). The marks are trademarks of their owners and only identify the
supported command line agents.

## Game content

Path of Exile and Path of Exile 2 are trademarks of Grinding Gear Games.

`data/items/` and `data/terms/` hold item, base, skill, passive and stat text in the ten game
client languages, extracted from the game client to convert copied item text for PoB and to show
official names. That text is © Grinding Gear Games and is not covered by this project's license.
Game text shown at run time otherwise comes from your PoB installation and the official trade data.

Screenshots in `docs/images/` show Path of Building (MIT, Path of Building Community) with Path of
Exile 2 art, and `test/fixtures/` contain game item and stat text; that game content is
© Grinding Gear Games and is not covered by this project's license either.

`data/ui/<language>.json` are PoB AI's translations of Path of Building's interface text (MIT,
like the rest of this project); `data/ui/source.json` lists the English originals from PoB.
