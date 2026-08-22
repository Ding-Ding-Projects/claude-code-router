@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem ============================================================
rem build.bat - one-click build for claude-code-router
rem
rem Takes a checkout with nothing installed and gets it to a built,
rem runnable program: installs Node.js 22+ and workspace dependencies
rem if missing (via download-dependencies.bat), runs the repository's
rem own build script, verifies the built program exists, prints its
rem SHA-256, then offers to run it.
rem
rem Usage: build.bat [/s | --silent]   (or SILENT=1)
rem   Silent mode: no prompts of any kind; exits non-zero on the first
rem   real failure. A silent run that is not elevated says so plainly
rem   and continues, because everything it installs resolves to a
rem   user-scoped location where possible.
rem
rem This script NEVER touches code signing: no certificate is
rem requested, generated, discovered or used. For the installable
rem artifact run build-installer.bat instead.
rem ============================================================

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"
if ERRORLEVEL 1 (
  echo [build] ERROR: cannot change directory to %SCRIPT_DIR%
  exit /b 1
)

rem ---- options: /s, --silent, or SILENT=1 environment variable ----
set "SILENT_ENV=0"
if defined SILENT set "SILENT_ENV=%SILENT%"
set "SILENT=0"
if /i "%SILENT_ENV%"=="1" set "SILENT=1"
:parse_args
if "%~1"=="" goto :args_done
if /i "%~1"=="/s" set "SILENT=1"
if /i "%~1"=="--silent" set "SILENT=1"
shift
goto :parse_args
:args_done

echo [build] === build.bat: claude-code-router ===
if "%SILENT%"=="1" echo [build] Silent mode: no prompts; exits non-zero on the first real failure.

rem ---- pre-elevate up front, interactive runs only ----
rem No environment sentinel guards the relaunch: a declined UAC prompt makes
rem Start-Process throw, which aborts non-zero instead of retrying forever.
set "IS_ADMIN=0"
net session >nul 2>&1
if not ERRORLEVEL 1 set "IS_ADMIN=1"
if "%IS_ADMIN%"=="1" goto :elevated
if "%SILENT%"=="1" (
  echo [build] Silent run proceeding WITHOUT elevation: installs resolve to user-scoped locations where possible; anything that truly needs admin reports exactly what and from where.
  goto :elevated
)
echo [build] Not elevated. Relaunching with administrator rights - approve the UAC prompt to continue.
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Start-Process -FilePath '%~f0' -Verb RunAs -WorkingDirectory '%~dp0' } catch { exit 1 }"
if ERRORLEVEL 1 (
  echo [build] BLOCKER: elevation prompt was declined or failed. Re-run with /s to build without elevation.
  exit /b 1
)
exit /b 0
:elevated

set "RUN_START="
for /f %%t in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()"') do set "RUN_START=%%t"

rem ============================================================
rem Phase 1/3: dependencies (calls download-dependencies.bat -
rem never duplicates its work)
rem ============================================================
echo [build] Phase 1/3: fetching dependencies via download-dependencies.bat
set "DEPS_ARGS="
if "%SILENT%"=="1" set "DEPS_ARGS=/s"
call "%SCRIPT_DIR%download-dependencies.bat" %DEPS_ARGS%
if ERRORLEVEL 1 goto :fail
call :phase_done "dependencies"

rem ============================================================
rem Phase 2/3: build bundled assets through the repository's own
rem named script (build/build.mjs under the hood)
rem ============================================================
echo [build] Phase 2/3: building bundled assets - npm run build:assets
call npm run build:assets
if ERRORLEVEL 1 goto :fail
call :phase_done "build assets"

rem ============================================================
rem Phase 3/3: verify the built program actually exists, print SHA-256
rem ============================================================
echo [build] Phase 3/3: verifying the built program
set "ENTRY=%SCRIPT_DIR%packages\electron\dist\main\main.js"
if not exist "%ENTRY%" (
  echo [build] BLOCKER: built entry bundle is missing: packages\electron\dist\main\main.js
  echo [build] The build step reported success but did not produce its expected output.
  goto :fail
)
if not exist "%SCRIPT_DIR%packages\core\dist\main" (
  echo [build] BLOCKER: built core bundle is missing: packages\core\dist\main
  goto :fail
)
if not exist "%SCRIPT_DIR%packages\ui\dist\renderer" (
  echo [build] BLOCKER: built renderer is missing: packages\ui\dist\renderer
  goto :fail
)
echo [build] Built program verified: packages\electron\dist\main\main.js
certutil -hashfile "%ENTRY%" SHA256
call :phase_done "verification"

if "%SILENT%"=="1" goto :success
echo.
choice /c YN /n /m "[build] Run the built app now? [Y/N] "
if ERRORLEVEL 2 goto :success
echo [build] Launching Claude Code Router...
start "Claude Code Router" /d "%SCRIPT_DIR%" cmd /d /c "call npx electron ."

:success
set "RUN_END="
for /f %%t in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()"') do set "RUN_END=%%t"
set /a RUN_ELAPSED=RUN_END-RUN_START
echo [build] SUCCESS - program built and verified in %RUN_ELAPSED%s total.
echo [build] For the installable Windows artifact, run build-installer.bat.
exit /b 0

:fail
echo [build] FAILED - see the exact BLOCKER line above for the missing dependency, version constraint, source tried, or failing step.
exit /b 1

:phase_done
set "PHASE_END="
for /f %%t in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()"') do set "PHASE_END=%%t"
set /a PHASE_ELAPSED=PHASE_END-RUN_START
echo [build] Phase done (%~1): %PHASE_ELAPSED%s since start.
exit /b 0
