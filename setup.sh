#!/usr/bin/env bash
set -euo pipefail

ENV_NAME="sci-vis"

echo "=== Setup: Python env (Miniconda) + JS deps ==="

have_conda=false
have_micromamba=false
if command -v conda >/dev/null 2>&1; then
  have_conda=true
elif command -v micromamba >/dev/null 2>&1; then
  have_micromamba=true
fi

if ! $have_conda && ! $have_micromamba; then
  echo "Neither conda nor micromamba found. Install Miniconda first (https://docs.conda.io/en/latest/miniconda.html)." >&2
  exit 1
fi

create_env() {
  if $have_conda; then
    if conda env list | grep -q "^${ENV_NAME} "; then
      echo "Conda env '${ENV_NAME}' already exists. Skipping creation."
    else
      conda env create -f environment.yml
    fi
  else
    if micromamba env list | grep -q "^${ENV_NAME} "; then
      echo "Micromamba env '${ENV_NAME}' already exists. Skipping creation."
    else
      micromamba env create -f environment.yml
    fi
  fi
}

create_env

if command -v npm >/dev/null 2>&1; then
  echo "Installing JS dependencies with npm..."
  npm install
else
  echo "npm not found; install Node.js to install JS deps." >&2
fi

cat <<EOF
Done.

Activate Python env:
  conda activate ${ENV_NAME}
    or
  micromamba activate ${ENV_NAME}

Run web dev server:
  npm run dev
EOF
