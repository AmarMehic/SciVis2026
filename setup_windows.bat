@echo off
setlocal enabledelayedexpansion

set ENV_NAME=sci-vis

echo === Setup: Python env (Miniconda) + JS deps (Windows) ===

:: Check conda
where conda >nul 2>nul
if %errorlevel% neq 0 (
  echo conda not found. Install Miniconda and ensure it is on PATH.
  exit /b 1
)

:: Create environment if missing
for /f "tokens=1" %%A in ('conda env list ^| findstr /R "^%ENV_NAME% "') do set FOUND_ENV=1
if defined FOUND_ENV (
  echo Conda env "%ENV_NAME%" already exists. Skipping creation.
) else (
  conda env create -f environment.yml
)

:: Activate env for this session
call conda activate %ENV_NAME%
if %errorlevel% neq 0 (
  echo Failed to activate conda env %ENV_NAME%.
  exit /b 1
)

:: Install JS deps
where npm >nul 2>nul
if %errorlevel% neq 0 (
  echo npm not found. Install Node.js and ensure it is on PATH.
) else (
  echo Installing JS dependencies with npm...
  npm install
)

echo.
echo Done.
echo Activate env in new shells: conda activate %ENV_NAME%
echo Run web dev server: npm run dev

endlocal
