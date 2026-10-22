# PoB internals used by the adapter

Notes on Path of Building PoE2's Lua objects that `adapter/` relies on, read from PoB 0.23.1
(`0.23.1-bb52d6b36`) and checked against 0.22.0. Line numbers refer to 0.23.1 and drift between
versions; search by function name. When PoB changes one of these, update the matching op.

## Objects and versions

- Construct objects with `util.new("Item", raw)`. 0.23+ uses `new("Item"):Item(raw)` and rejects
  extra arguments to `new` (Modules/Common.lua `new`); 0.22 used `new("Item", raw)`.
- There is no global `build` in the GUI. The open build is `main.modes.BUILD`, valid while
  `main.mode == "BUILD"`. The same table is re-initialised for every loaded build.

## Recalculation, unsaved state and undo

- `build.buildFlag = true` makes `Build:OnFrame` run `wipeGlobalCache()`, bump `outputRevision`,
  `calcsTab:BuildOutput()`, `RefreshStatList()` and refresh `configTab.calcFunc/calcBase`
  (Build.lua ~1387). `util.recalc` does the same synchronously.
- `build.unsaved` is recomputed every frame from `modFlag` on the build and its tabs.
- `X:AddUndoState()` (UndoHandler) both records undo and sets `modFlag`. Call it on the object the
  GUI would: `build.spec` (tree, class, ascendancy), `skillsTab`, `itemsTab`, `configTab`.

## Build files

- `main:SetMode("BUILD", dbFileName, buildName, xml)` switches on the next frame; it does not ask
  about unsaved changes. `Build:Init(dbFileName, buildName, xml, convert, importLink)`.
- While a build is open, PoB's import replaces it synchronously:
  `build:Shutdown(); build:Init(...); build.viewMode = "TREE"` (ImportTab.lua ~279).
- `build:SaveDB(name)` returns XML (`PathOfBuilding2` root). Save As sets `dbFileName`,
  `buildName`, `dbFileSubPath` then saves; `build:ResetModFlags()` clears unsaved.
- `main.buildPath` is the build folder (`main.userPath .. "Builds/"`). A portable PoB keeps
  `userPath` in its own folder; an installed one under Documents.
- Build codes: URL-safe base64 of zlib-deflated XML. Site rules: Modules/BuildSiteTools.lua.
- If `targetVersion` differs from `liveTargetVersion`, Init opens a conversion prompt and leaves
  `targetVersion` nil.

## Character

- Level: `characterLevel`, `characterLevelAutoMode = false`, `configTab:BuildModList()`,
  `controls.characterLevel:SetText(n)`, label of `controls.levelScalingButton` (Build.lua ~209).
- Class: `spec:SelectClass(id)`; when the tree is not connected to the new start the GUI offers
  `spec:ConnectToClass(id)` (Build.lua ~246). Ascendancy: `spec:SelectAscendClass(id)`, 0 = none.

## Passive tree (`build.spec`)

- `spec.nodes[id]`: `dn`, `sd`, `type` (`Normal`, `Notable`, `Keystone`, `Socket`, `ClassStart`,
  `AscendClassStart`, `OnlyImage`), `isAttribute`, `ascendancyName`, `alloc`, `path` (to the
  node, nil if unreachable), `depends`, `x`, `y`.
- `spec:AllocNode(node)` allocates the whole path; attribute nodes on it take
  `spec.attributeIndex` (1 str, 2 dex, 3 int). Weapon set passives: set `spec.allocMode` (1/2)
  around the call; keystones and sockets cannot be weapon set passives.
- `spec:DeallocNode(node)` removes dependents. Reset: `wipeTable(spec.hashOverrides);
  spec:ResetNodes(); spec:BuildAllDependsAndPaths()` (TreeTab.lua ~145).
- `spec:CountAllocNodes()` → used, ascendancy, secondary, sockets, weapon set 1, weapon set 2.
- Sets: `treeTab.specList`, `activeSpec`, `SetActiveSpec(i)`, `CopyTree(i, name)`,
  `ConvertToVersion(version, remove, showMessage)`.
- Centering the view: `viewer.zoomLevel`, `viewer.zoom = 1.2^zoomLevel`,
  `scale = min(vp.width, vp.height) / tree.size * zoom`, `zoomX = -x*scale`, `zoomY = -y*scale`
  (PassiveTreeView `Focus`). Screen position: `x*scale + zoomX + vp.x + vp.width/2`.

## Skills (`build.skillsTab`)

- `socketGroupList` (alias of the active skill set's list). Group: `label`, `enabled`,
  `includeInFullDPS`, `groupCount`, `mainActiveSkill`, `gemList`, `source` (item-granted, not
  removable), `displaySkillList`.
- New gem like the GUI: `{nameSpec, gemId, level, quality, enabled=true, enableGlobal1=true,
  enableGlobal2=true, count=1, corrupted=false, corruptLevel=0}`, then `ProcessSocketGroup(g)`
  and `gem.level = ProcessGemLevel(gem.gemData)`. `FindSkillGem(name)` returns `err` or
  `nil, gemData`.
- Main skill: `build.mainSocketGroup`, `group.mainActiveSkill`; part/minion live on
  `displaySkillList[i].activeEffect.srcInstance` (`skillPart`, `skillMinion`).
- Sets: `skillSets`, `skillSetOrderList`, `activeSkillSetId`, `NewSkillSet`, `CopySkillSet`,
  `DeleteSkillSet(id, orderIndex)`, `SetActiveSkillSet(id)`. Item and config sets have the same
  shape (`adapter/ops/sets.lua`).

## Items (`build.itemsTab`)

- `items[id]`, `itemOrderList`, `slots[name]` (`selItemId`, `SetSelItemId`), `orderedSlots`,
  `activeItemSet` (`useSecondWeaponSet`). Tree jewels: slots `"Jewel <nodeId>"`.
- Add like the GUI: `AddItem(item, true)`, `slot:SetSelItemId(item.id)`, `PopulateSlots()`,
  `AddUndoState()`. Validity: `IsItemValidForSlot(item, slotName)`.
- Uniques: `main.uniqueDB.list[name]` loads in a coroutine; wait until `main.uniqueDB.loading`
  is nil. Bases: `data.itemBases[name]`.
- Flask/charm toggles: `slot.active`, `activeItemSet[slot].active`, `slot.controls.activate`.
- Unparsed modifier lines have `modLine.extra`.

## Configuration (`build.configTab`)

- `input` / `placeholder` alias the active config set. Options come from Modules/ConfigOptions
  (`var`, `type`, `label`, `list`, `defaultIndex`, `defaultState`, visibility gates).
- Edit like the GUI: `input[var] = v; AddUndoState(); BuildModList()`; refresh controls with
  `UpdateControls()`.
- 0.23 keeps custom modifiers in `configSets[id].customModsList` blocks (0.22: `input.customMods`).
- Controls: `varControls[var]`; sections `sectionList[i].collapsed`; scroll
  `controls.scrollBar:SetOffset()`.

## Calculations

- `calcsTab.mainOutput` (player output; minion output under `.Minion`). Full DPS: `FullDPS`,
  `SkillDPS` list.
- What-if: `local calcFunc = calcsTab:GetMiscCalculator(); calcFunc(override, useFullDPS)` with
  `override.addNodes` / `removeNodes` (sets keyed by node objects), `repSlotName` + `repItem`.
- Another build's numbers: `new("CompareEntry"):CompareEntry(xml, label)` then `:GetOutput()`.
- Warnings: `build.controls.warnings.lines`.

## Drawing and tabs

- `build.viewMode`: `TREE`, `SKILLS`, `ITEMS`, `CALCS`, `CONFIG`, `NOTES`, `IMPORT`, `PARTY`,
  `COMPARE`; tab buttons `build.controls.mode<Tab>`.
- `control:GetPos()` / `GetSize()` are absolute after the tab drew this frame; `IsShown()`.
- Popups (`main.popups`) take all input; the adapter refuses to navigate while one is open.
- Colours are set through the globals `SetDrawColor` and colour codes in `DrawString` text; PoB
  keeps no local copies of them. The window background is the renderer clear colour
  (`SetClearColor`).

## Host (SimpleGraphic.dll)

Read from the shipped DLL with a disassembler; there is no Lua source for these.

- `Restart()` only sets a flag. After the current frame the host calls `OnExit`, closes the Lua
  state, restores the *script working directory* and loads the entry script again with the
  original arguments. `SetWorkDir()` changes that directory, so the shim moves it back to the
  adapter folder in `OnExit`.
- `launch:ApplyUpdate(mode)` (Launch.lua): `"normal"` applies the files and calls `Restart()`;
  `"basic"` spawns `Update.exe` and exits, and the updater starts the exe without arguments.
- Fonts: one bitmap atlas per size with glyphs below 128 only; other characters are not drawn.
- `LaunchSubScript` (HTTP downloads, OAuth) crashes the process when called from inside a Lua
  coroutine; call it from the frame callback.
- `TakeScreenshot()` writes the next frame to `<user path>/Screenshots` (`set r_screenshotFormat png`);
  the adapter's `ui.screenshot` diagnostic uses it so tests never capture the user's screen.
