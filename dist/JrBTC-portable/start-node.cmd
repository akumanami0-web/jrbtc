@echo off
REM JrBTC portable node — runs from any folder or USB drive.
REM Usage:  start-node.cmd [seed-ip]
REM         seed-ip = IP/host of an existing JrBTC node (e.g. the founder's).
setlocal
set "KIT=%~dp0"
if not exist "%KIT%data" mkdir "%KIT%data"
set "SEED=%~1"
if "%SEED%"=="" (
  echo Starting JrBTC node WITHOUT a seed peer.
  echo To join the Junior Network run:  start-node.cmd ^<seed-ip^>
  "%KIT%bin\bitcoind.exe" -datadir=%KIT%data -listen=1
) else (
  echo Starting JrBTC node, connecting to %SEED%:9333 ...
  "%KIT%bin\bitcoind.exe" -datadir=%KIT%data -listen=1 -addnode=%SEED%:9333
)
