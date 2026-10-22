@echo off
rem Starts PoB AI: the local service, your Path of Building window and the agent panel.
rem launcher.mjs runs the newest installed version (updates go to the PoB AI data folder).
setlocal
cd /d "%~dp0"
set "NODE=node"
if exist "%~dp0runtime\node\node.exe" set "NODE=%~dp0runtime\node\node.exe"
start "PoB AI" /min "%NODE%" "%~dp0launcher.mjs" --open
