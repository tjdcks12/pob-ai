return function(modulePath, scenario)
	local json = require('dkjson')
	local ops, network, imports, writes, rollbacks = {}, 0, 0, 0, 0
	local disk = 'ORIGINAL FILE'
	local build = {dbFileName='C:/Builds/Character.xml', buildName='Character', viewMode='TREE', mainSocketGroup=1,
		unsaved=false, modFlag=false, spec={allocNodes={}}, configTab={input={enemyIsBoss='Pinnacle', resistancePenalty=-20}},
		itemsTab={items={}, activeItemSet={useSecondWeaponSet=true}}, skillsTab={socketGroupList={}}}
	local function group(id)
		return {mainActiveSkill=1, gemList={{gemData={grantedEffectId=id}}}, displaySkillList={{activeEffect={grantedEffect={id=id}, srcInstance={}}}}}
	end
	build.skillsTab.socketGroupList = {group('MAIN')}
	function build:SaveDB() return self.imported and 'UPDATED BUILD' or 'ORIGINAL BUILD' end
	function build:Shutdown() rollbacks = rollbacks + 1 end
	function build:Init(_, _, xml) self.imported=false; self.unsaved=false; self.modFlag=xml ~= nil; self.mainSocketGroup=1; self.skillsTab.socketGroupList={group('MAIN')}; self.configTab.input.enemyIsBoss='Pinnacle' end
	function build:ResetModFlags() self.modFlag=false end
	function build.configTab:BuildModList() end
	function build.itemsTab:PopulateSlots() end
	local util = {}
	function util.check(ok, code, message) if not ok then error({code=code,message=message}, 0) end; return ok end
	function util.build() return build end
	function util.onMain(fn, ...) return fn(...) end
	function util.waitFrame() error('Unexpected wait') end
	function util.recalc(value) value.calcsTab.mainEnv.player.mainSkill = value.skillsTab.socketGroupList[value.mainSocketGroup].displaySkillList[1] end
	build.calcsTab = {mainEnv={player={mainSkill=build.skillsTab.socketGroupList[1].displaySkillList[1]}}}
	local char = {name='My Character', id='character-id', class='Witch', level=40, passives={hashes={42}}, equipment={{id='item-id'}}, jewels={}, skills={{}}}
	local tab = {lastCharacterHash='hash:My Character', lastCharList={char}, controls={charSelect={list={{char=char}}}}}
	for _, key in ipairs({'charImportTreeClearJewels','charImportItemsClearItems','charImportItemsClearSkills','charImportItemsIgnoreWeaponSwap'}) do tab.controls[key]={state=false} end
	build.importTab=tab
	function tab:BuildCharacterList() end
	function tab:DownloadCharacter(callback)
		network=network+1; self.charImportMode='IMPORTING'
		if scenario == 'edited' then build.unsaved=true end
		if scenario == 'file-edited' then disk='USER SAVE' end
		callback(char); self.charImportMode='SELECTCHAR'
	end
	function tab:ImportPassiveTreeAndJewels() imports=imports+1; build.imported=true; build.spec.allocNodes[42]=true; build.configTab.input.enemyIsBoss='Changed'; build.configTab.input.questNew=true; build.configTab.input.resistancePenalty=-40 end
	function tab:ImportItemsAndSkills()
		build.itemsTab.items={{uniqueID='item-id',base=true}}
		build.skillsTab.socketGroupList={group('OTHER'),group(scenario == 'missing-main' and 'REMOVED' or 'MAIN')}
	end
	ops['account.characters']=function() network=network+1; return {characters={char}} end
	ops.summary=function(value) return {mainGroup=value.mainSocketGroup} end
	ops['build.save']=function()
		writes=writes+1; disk='UPDATED FILE'
		if scenario == 'save-failed' then error({code='SAVE_FAILED'},0) end
		return {file=build.dbFileName}
	end
	_G.POBAI_MODE='live'; _G.POBAI_MAIN={api={authToken=true}}; _G.common={sha1=function(text) return 'hash:'..text end}
	_G.GetTime=function() return 1 end
	_G.pobai_read_file=function() return disk end
	_G.pobai_write_file=function(_, value) disk=value end
	dofile(modulePath)(ops,util)
	if scenario == 'context' then local result=ops['account.sync_context']({}); return {available=result.available,suggested=result.suggestedCharacter,network=network,writes=writes} end
	local args={file=build.dbFileName,character=char.name,characterId=char.id}
	local ok, result=pcall(ops['account.refresh'],args)
	if ok and scenario == 'unchanged' then
		build.imported=false; args.previousHash=result.snapshotHash; args.previousFileHash=result.fileHash
		ok,result=pcall(ops['account.refresh'],args)
	end
	return {ok=ok,code=not ok and type(result)=='table' and result.code or nil,unchanged=ok and result.unchanged or false,
		imports=imports,writes=writes,network=network,disk=disk,main=build.mainSocketGroup,
		boss=build.configTab.input.enemyIsBoss,quest=build.configTab.input.questNew,resistance=build.configTab.input.resistancePenalty,
		weapon=build.itemsTab.activeItemSet.useSecondWeaponSet,rollbacks=rollbacks,unsaved=build.unsaved,dirty=ops['account.sync_context']({}).unsaved}
end
