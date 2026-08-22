@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem ============================================================
rem build-installer.bat - one-click Windows installer build
rem
rem Produces the same Squirrel.Windows installer the Release
rem workflow publishes: it calls the repository's own named script
rem (build:app:win:local = windows-package-preflight + build:assets +
rem electron-builder with the local config), so a locally built
rem installer and a released one are the same thing.
rem
rem Usage: build-installer.bat [/s | --silent]   (or SILENT=1)
rem   Silent mode: no prompts; exits non-zero on the first failure.
rem
rem This script NEVER publishes, tags, pushes or creates a release,
rem and NEVER touches code signing. The installer it produces is
rem UNSIGNED - stated plainly in its output below.
rem ============================================================

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"
if ERRORLEVEL 1 (
  echo [installer] ERROR: cannot change directory to %SCRIPT_DIR%
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

echo [installer] === build-installer.bat: claude-code-router (Windows Squirrel) ===
if "%SILENT%"=="1" echo [installer] Silent mode: no prompts; exits non-zero on the first real failure.

rem ---- pre-elevate up front, interactive runs only ----
set "IS_ADMIN=0"
net session >nul 2>&1
if not ERRORLEVEL 1 set "IS_ADMIN=1"
if "%IS_ADMIN%"=="1" goto :elevated
if "%SILENT%"=="1" (
  echo [installer] Silent run proceeding WITHOUT elevation: installs resolve to user-scoped locations where possible.
  goto :elevated
)
echo [installer] Not elevated. Relaunching with administrator rights - approve the UAC prompt to continue.
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Start-Process -FilePath '%~f0' -Verb RunAs -WorkingDirectory '%~dp0' } catch { exit 1 }"
if ERRORLEVEL 1 (
  echo [installer] BLOCKER: elevation prompt was declined or failed. Re-run with /s to build without elevation.
  exit /b 1
)
exit /b 0
:elevated

set "RUN_START="
for /f %%t in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()"') do set "RUN_START=%%t"

rem ============================================================
rem Phase 1/3: dependencies via download-dependencies.bat
rem ============================================================
echo [installer] Phase 1/3: fetching dependencies via download-dependencies.bat
set "DEPS_ARGS="
if "%SILENT%"=="1" set "DEPS_ARGS=/s"
call "%SCRIPT_DIR%download-dependencies.bat" %DEPS_ARGS%
if ERRORLEVEL 1 goto :fail
call :phase_done "dependencies"

rem ============================================================
rem Phase 2/3: package through the repository's own named script.
rem build:app:win:local = windows-package-preflight (packaging
rem environment sanity, not a test gate) + npm run build:assets +
rem electron-builder --config build/electron-builder.local.cjs
rem --win --publish never. Output lands in release-local\ .
rem ============================================================
echo [installer] Phase 2/3: packaging Windows Squirrel installer - npm run build:app:win:local
call npm run build:app:win:local
if ERRORLEVEL 1 goto :fail
call :phase_done "packaging"

rem ============================================================
rem Phase 3/3: verify what was built before claiming success:
rem Setup exe + RELEASES + .nupkg must all exist; print SHA-256.
rem ============================================================
echo [installer] Phase 3/3: verifying packaged artifacts
set "OUTDIR=%SCRIPT_DIR%release-local"
if not exist "%OUTDIR%\" (
  echo [installer] BLOCKER: packaging output directory is missing: release-local\
  goto :fail
)
set "SETUP="
for %%F in ("%OUTDIR%\*Setup*.exe") do set "SETUP=%%F"
if not defined SETUP for %%F in ("%OUTDIR%\*.exe") do set "SETUP=%%F"
if not defined SETUP (
  echo [installer] BLOCKER: no installer executable was produced under release-local\
  dir /b "%OUTDIR%"
  goto :fail
)
if not exist "%OUTDIR%\RELEASES" (
  echo [installer] BLOCKER: Squirrel RELEASES feed is missing under release-local\
  dir /b "%OUTDIR%"
  goto :fail
)
set "NUPKG_COUNT=0"
for %%F in ("%OUTDIR%\*.nupkg") do set /a NUPKG_COUNT+=1
if %NUPKG_COUNT% LSS 1 (
  echo [installer] BLOCKER: no .nupkg package was produced under release-local\
  dir /b "%OUTDIR%"
  goto :fail
)
echo [installer] Packaged artifacts in release-local\ :
dir /b "%OUTDIR%"
echo [installer] Installer executable: %SETUP%
certutil -hashfile "%SETUP%" SHA256
call :phase_done "verification"

echo [installer] This installer is UNSIGNED by policy: no code-signing certificate was requested, generated or used.
echo [installer] Windows may show an unknown-publisher or SmartScreen warning; no signature verification is claimed.
echo [installer] Nothing was published, tagged or pushed here - building the installer and shipping it are different actions.

:success
set "RUN_END="
for /f %%t in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()"') do set "RUN_END=%%t"
set /a RUN_ELAPSED=RUN_END-RUN_START
echo [installer] SUCCESS - installer built and verified in %RUN_ELAPSED%s total.
exit /b 0

:fail
echo [installer] FAILED - see the exact BLOCKER line above for what is missing and why.
exit /b 1

:phase_done
set "PHASE_END="
for /f %%t in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()"') do set "PHASE_END=%%t"
set /a PHASE_ELAPSED=PHASE_END-RUN_START
echo [installer] Phase done (%~1): %PHASE_ELAPSED%s since start.
exit /b 0
