@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem ============================================================
rem download-dependencies.bat - one-click dependency fetcher
rem
rem Installs every dependency this repository needs to build, run
rem and test, from canonical upstreams, into user-scoped locations
rem wherever possible. Idempotent: a warm run verifies what is
rem present and skips it. Never installs secrets, credentials or
rem code-signing material.
rem
rem Usage: download-dependencies.bat [/s | --silent]   (or SILENT=1)
rem
rem NOTE: elevation is the ENTRY POINTS' duty (build.bat /
rem build-installer.bat pre-elevate before calling this script).
rem This script reports its elevation state honestly and never
rem relaunches, so a caller's control flow is never broken by a
rem detached elevated child.
rem ============================================================

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"
if ERRORLEVEL 1 (
  echo [deps] ERROR: cannot change directory to %SCRIPT_DIR%
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

set "RUN_START="
for /f %%t in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()"') do set "RUN_START=%%t"

echo [deps] === download-dependencies: claude-code-router ===
if "%SILENT%"=="1" echo [deps] Silent mode: no prompts; exits non-zero on the first real failure.

rem ---- elevation state: reported, never relaunched here ----
set "IS_ADMIN=0"
net session >nul 2>&1
if not ERRORLEVEL 1 set "IS_ADMIN=1"
if "%IS_ADMIN%"=="1" (
  echo [deps] Elevation: running elevated.
) else (
  echo [deps] Elevation: NOT elevated. Installs resolve to user-scoped locations where possible; anything that genuinely needs admin will be reported exactly and fail loudly.
)

rem ============================================================
rem Phase 1/2: Node.js 22+ (canonical upstream https://nodejs.org)
rem ============================================================
echo [deps] Phase 1/2: checking Node.js ^>= 22
set "NODE_VER="
set "NODE_MAJOR=0"
where node >nul 2>&1
if not ERRORLEVEL 1 (
  for /f "tokens=1 delims=." %%m in ('node -v') do set "NODE_MAJOR_RAW=%%m"
  for /f "delims=" %%v in ('node -v') do set "NODE_VER=%%v"
  set "NODE_MAJOR=!NODE_MAJOR_RAW:v=!"
  echo !NODE_MAJOR!|findstr /r "^[0-9][0-9]*$" >nul
  if ERRORLEVEL 1 set "NODE_MAJOR=0"
)
if !NODE_MAJOR! GEQ 22 (
  echo [deps] Node.js already present: !NODE_VER! - skipping install.
  goto :node_ready
)

echo [deps] MISSING DEPENDENCY: Node.js 22+ is required ^(found: !NODE_VER!^).
where winget >nul 2>&1
if ERRORLEVEL 1 (
  echo [deps] BLOCKER: winget is not available on this machine, so Node.js cannot be installed automatically.
  echo [deps] Required: Node.js 22 LTS or newer. Source: https://nodejs.org/en/download
  echo [deps] Install it, open a new terminal, then re-run this script.
  exit /b 1
)
echo [deps] Installing via winget: package id OpenJS.NodeJS.LTS - canonical upstream https://nodejs.org
winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
if ERRORLEVEL 1 (
  echo [deps] BLOCKER: winget failed to install Node.js.
  echo [deps] Required: Node.js 22 LTS or newer. Source: https://nodejs.org/en/download
  exit /b 1
)
rem winget updates PATH for FUTURE shells only - refresh it for THIS process.
set "PATH=%PATH%;%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs"
set "NODE_VER="
set "NODE_MAJOR=0"
where node >nul 2>&1
if not ERRORLEVEL 1 (
  for /f "tokens=1 delims=." %%m in ('node -v') do set "NODE_MAJOR_RAW=%%m"
  for /f "delims=" %%v in ('node -v') do set "NODE_VER=%%v"
  set "NODE_MAJOR=!NODE_MAJOR_RAW:v=!"
  echo !NODE_MAJOR!|findstr /r "^[0-9][0-9]*$" >nul
  if ERRORLEVEL 1 set "NODE_MAJOR=0"
)
if !NODE_MAJOR! LSS 22 (
  echo [deps] BLOCKER: Node.js 22+ is still not available after the winget install.
  echo [deps] The freshly installed Node.js usually needs a NEW terminal to appear on PATH.
  echo [deps] Required: Node.js 22 LTS or newer. Source: https://nodejs.org/en/download
  exit /b 1
)
:node_ready
echo [deps] Node.js ready: !NODE_VER!

rem ============================================================
rem Phase 2/2: workspace dependencies (npm ci, lockfile pinned)
rem ============================================================
echo [deps] Phase 2/2: installing workspace dependencies - npm ci (lockfile pinned, canonical registry https://registry.npmjs.org^)
call npm ci --no-audit --no-fund
if ERRORLEVEL 1 (
  echo [deps] BLOCKER: npm ci failed. See the npm output above for the exact error.
  exit /b 1
)

set "RUN_END="
for /f %%t in ('powershell -NoProfile -Command "[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()"') do set "RUN_END=%%t"
set /a RUN_ELAPSED=RUN_END-RUN_START
echo [deps] SUCCESS - dependencies ready in %RUN_ELAPSED%s.
exit /b 0
