@echo off
rem Starts PoB AI: the local service, your Path of Building window and the agent panel.
setlocal
cd /d "%~dp0"
set "NODE=node"
if exist "%~dp0runtime\node\node.exe" set "NODE=%~dp0runtime\node\node.exe"
start "PoB AI" /min "%NODE%" "%~dp0src\service\main.mjs" --open
