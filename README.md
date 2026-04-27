# Coomfy

Coomfy is a local web app for creating and processing character assets using ComfyUI workflows. It provides a browser interface and a Node.js backend to manage character generation jobs, editing jobs, animation jobs, and export-ready outputs.

The app is designed for fast iteration: select or upload inputs, run a workflow, preview results, and save generated assets to organized local folders.

## What This Project Does

- Connects to a ComfyUI server over WebSocket/API.
- Runs preconfigured workflows from the `workflows/` folder.
- Supports character creation, editing, animation, and video-related processing flows.
- Stores generated files and metadata locally for easy reuse.
- Serves a simple frontend (`index.html`, `styles.css`, `js/`) backed by an Express server (`server.js`, `src/`).

## Project Structure

- `server.js` - app entry point.
- `src/` - routes, controllers, services, and utility modules.
- `workflows/` - ComfyUI workflow JSON files used by the app.
- `data/` - local app data and configuration files.
- `outputs/` - generated assets (ignored in git).
- `temp_export/` - temporary export artifacts (ignored in git).

## Run Locally

```bash
npm install
npm start
```

Then open: `http://localhost:3000`

## Requirements

- Node.js 18+ (recommended)
- A running ComfyUI instance (default expected endpoint: `127.0.0.1:8190`)

## Notes

- This repository ignores generated and temporary folders to keep commits clean.
- If ComfyUI is not running, the app will start but Comfy job calls will fail until the backend is available.