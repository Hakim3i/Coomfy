#!/usr/bin/env bash
# Fetch the latest runpod_setup_comfysprites.sh from GitHub and execute it.
# Use this on RunPod (or any Linux host) so you always run the current script without cloning first.
set -euo pipefail

RAW_URL="${RAW_URL:-https://raw.githubusercontent.com/Hakim3i/ComfySprites/main/scripts/runpod_setup_comfysprites.sh}"
CACHED_SCRIPT="${CACHED_SCRIPT:-/tmp/runpod_setup_comfysprites.sh}"

usage() {
  cat <<'EOF'
Usage:
  ./runpod_update_and_run.sh <APP_PORT> [COMFY_URL]

Downloads the latest scripts/runpod_setup_comfysprites.sh from GitHub (main), then runs it.

Arguments:
  APP_PORT   Port for the ComfySprites HTTP server (also use this port in RunPod "Expose HTTP".)
  COMFY_URL  Optional. Base URL of ComfyUI, e.g. http://127.0.0.1:8188
             If omitted, the setup script uses its default (see runpod_setup_comfysprites.sh --help).

Examples:
  bash runpod_update_and_run.sh 8890
  bash runpod_update_and_run.sh 8890 http://127.0.0.1:8188
  curl -fsSL https://raw.githubusercontent.com/Hakim3i/ComfySprites/main/scripts/runpod_update_and_run.sh | bash -s -- 8890 http://127.0.0.1:8188

Optional environment (forwarded to the setup script):
  REPO_URL  REPO_DIR  BRANCH  COMFY_URL (used only when COMFY_URL arg is not given)
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "${1:-}" ]]; then
  echo "Error: APP_PORT is required." >&2
  usage >&2
  exit 1
fi

APP_PORT="$1"
COMFY_URL_ARG="${2:-}"

if ! [[ "$APP_PORT" =~ ^[0-9]+$ ]] || [[ "$APP_PORT" -lt 1 || "$APP_PORT" -gt 65535 ]]; then
  echo "Error: APP_PORT must be a number between 1 and 65535, got: $APP_PORT" >&2
  exit 1
fi

echo "==> Downloading latest runpod_setup_comfysprites.sh"
echo "    ${RAW_URL}"
if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required." >&2
  exit 1
fi
curl -fsSL "$RAW_URL" -o "$CACHED_SCRIPT"
chmod +x "$CACHED_SCRIPT"

export APP_PORT
if [[ -n "$COMFY_URL_ARG" ]]; then
  echo "==> Running setup (APP_PORT=${APP_PORT}, COMFY_URL=${COMFY_URL_ARG})"
  exec bash "$CACHED_SCRIPT" "$COMFY_URL_ARG"
else
  echo "==> Running setup (APP_PORT=${APP_PORT}, COMFY_URL from env or setup default)"
  exec bash "$CACHED_SCRIPT"
fi
