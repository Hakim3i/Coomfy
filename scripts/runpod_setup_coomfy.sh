#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./runpod_setup_coomfy.sh [COMFY_URL]

Examples:
  ./runpod_setup_coomfy.sh http://127.0.0.1:8188
  APP_PORT=8190 ./runpod_setup_coomfy.sh http://10.0.0.25:8188

Priority for COMFY_URL:
  1) First CLI argument
  2) COMFY_URL environment variable
  3) Default: http://127.0.0.1:8188
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

# -----------------------------
# Config (override with env vars)
# -----------------------------
REPO_URL="${REPO_URL:-https://github.com/Hakim3i/Coomfy.git}"
REPO_DIR="${REPO_DIR:-/workspace/Coomfy}"
BRANCH="${BRANCH:-main}"
APP_PORT="${APP_PORT:-8190}"
COMFY_URL="${1:-${COMFY_URL:-http://127.0.0.1:8188}}"
COMFYUI_DIR="${COMFYUI_DIR:-/workspace/ComfyUI}"
CUSTOM_NODES_DIR="${CUSTOM_NODES_DIR:-${COMFYUI_DIR}/custom_nodes}"

echo "==> Coomfy Runpod setup starting"
echo "    REPO_URL:  ${REPO_URL}"
echo "    REPO_DIR:  ${REPO_DIR}"
echo "    BRANCH:    ${BRANCH}"
echo "    APP_PORT:  ${APP_PORT}"
echo "    COMFY_URL: ${COMFY_URL}"
echo "    COMFYUI_DIR: ${COMFYUI_DIR}"
echo "    CUSTOM_NODES_DIR: ${CUSTOM_NODES_DIR}"

# -----------------------------
# Ensure required tools
# -----------------------------
if ! command -v git >/dev/null 2>&1; then
  echo "==> Installing git"
  apt-get update
  apt-get install -y git
fi

if ! command -v node >/dev/null 2>&1; then
  echo "==> Installing Node.js + npm"
  apt-get update
  apt-get install -y curl ca-certificates gnupg
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
fi

echo "==> Node version: $(node -v)"
echo "==> npm version:  $(npm -v)"

if ! command -v python3 >/dev/null 2>&1; then
  echo "==> Installing python3 + pip"
  apt-get update
  apt-get install -y python3 python3-pip
fi

echo "==> Python version: $(python3 --version)"

install_or_update_custom_node() {
  local repo_url="$1"
  local repo_name="$2"
  local node_dir="${CUSTOM_NODES_DIR}/${repo_name}"

  if [ ! -d "${CUSTOM_NODES_DIR}" ]; then
    mkdir -p "${CUSTOM_NODES_DIR}"
  fi

  if [ ! -d "${node_dir}/.git" ]; then
    echo "==> Installing custom node: ${repo_name}"
    git clone --depth 1 "${repo_url}" "${node_dir}"
  else
    echo "==> Updating custom node: ${repo_name}"
    git -C "${node_dir}" fetch --all --prune
    git -C "${node_dir}" pull --ff-only || true
  fi

  if [ -f "${node_dir}/requirements.txt" ]; then
    echo "==> Installing Python requirements for ${repo_name}"
    python3 -m pip install -r "${node_dir}/requirements.txt"
  fi
}

# -----------------------------
# Stop active Coomfy process (if any)
# -----------------------------
echo "==> Checking for active Coomfy process"
if pgrep -f "node server.js" >/dev/null 2>&1; then
  echo "==> Stopping active Coomfy process"
  pkill -f "node server.js" || true
  sleep 1
else
  echo "==> No active Coomfy process found"
fi

# -----------------------------
# Clone or update repository
# -----------------------------
if [ ! -d "${REPO_DIR}/.git" ]; then
  echo "==> Cloning repository"
  mkdir -p "$(dirname "${REPO_DIR}")"
  git clone "${REPO_URL}" "${REPO_DIR}"
else
  echo "==> Repository exists, pulling latest"
fi

cd "${REPO_DIR}"
echo "==> Forcing latest code from GitHub (${BRANCH})"
git fetch origin "${BRANCH}" --prune
git checkout "${BRANCH}"
git reset --hard "origin/${BRANCH}"

# -----------------------------
# Install required ComfyUI custom nodes
# -----------------------------
echo "==> Ensuring required ComfyUI custom nodes"
install_or_update_custom_node "https://github.com/Smirnov75/ComfyUI-mxToolkit.git" "ComfyUI-mxToolkit"
install_or_update_custom_node "https://github.com/pythongosssss/ComfyUI-Custom-Scripts.git" "ComfyUI-Custom-Scripts"

# -----------------------------
# Install app dependencies
# -----------------------------
echo "==> Installing npm dependencies"
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

# -----------------------------
# Start Coomfy
# -----------------------------
echo "==> Starting Coomfy"
mkdir -p logs

HOST=0.0.0.0 PORT="${APP_PORT}" COMFY_URL="${COMFY_URL}" nohup npm start > logs/coomfy.log 2>&1 &
sleep 2

echo "==> Coomfy started"
echo "    URL:   http://0.0.0.0:${APP_PORT}"
echo "    RunPod: use the HTTPS URL whose hostname ends with -${APP_PORT}.proxy.runpod.net"
echo "            (this app). Do not use the ComfyUI port in the proxy URL — that causes 502."
echo "    Logs:  ${REPO_DIR}/logs/coomfy.log"
echo "    Tail:  tail -f ${REPO_DIR}/logs/coomfy.log"
