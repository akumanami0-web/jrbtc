@echo off
REM Show your JrBTC address and balances.
setlocal
set "KIT=%~dp0"
set "CLI=%KIT%bin\bitcoin-cli.exe"
"%CLI%" -datadir=%KIT%data createwallet wallet >nul 2>&1
"%CLI%" -datadir=%KIT%data loadwallet wallet >nul 2>&1
echo Your receive address:
"%CLI%" -datadir=%KIT%data -rpcwallet=wallet getnewaddress
echo.
echo Balances:
"%CLI%" -datadir=%KIT%data -rpcwallet=wallet getbalances
echo.
echo Chain status:
"%CLI%" -datadir=%KIT%data getblockcount
pause
