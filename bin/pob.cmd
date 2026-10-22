@echo off
setlocal
if exist "%~dp0..\runtime\node\node.exe" (
  "%~dp0..\runtime\node\node.exe" "%~dp0pob.mjs" %*
) else (
  node "%~dp0pob.mjs" %*
)
