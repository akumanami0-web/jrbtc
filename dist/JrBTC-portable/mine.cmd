@echo off
REM Mine JrBTC blocks to YOUR wallet on this node.
setlocal
set "KIT=%~dp0"
set "CLI=%KIT%bin\bitcoin-cli.exe"
"%CLI%" -datadir=%KIT%data createwallet wallet >nul 2>&1
"%CLI%" -datadir=%KIT%data loadwallet wallet >nul 2>&1
for /f "delims=" %%a in ('"%CLI%" -datadir=%KIT%data -rpcwallet=wallet getnewaddress mining') do set "ADDR=%%a"
echo Your mining address: %ADDR%
set /p N="How many blocks do you want to mine? "
echo Mining %N% block(s) — real SHA-256d proof-of-work, this can take a while...
"%CLI%" -datadir=%KIT%data -rpcwallet=wallet generatetoaddress %N% %ADDR% 1000000000
"%CLI%" -datadir=%KIT%data -rpcwallet=wallet getbalances
echo Rewards unlock after 100 more blocks are mined on top (coinbase maturity).
pause
