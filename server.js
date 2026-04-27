const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('./src/config');
const spriteRoutes = require('./src/routes/sprites');
const spriteController = require('./src/controllers/spriteController');
const configRoutes = require('./src/routes/config');
const videoRoutes = require('./src/routes/videos');
const modelRoutes = require('./src/routes/models');

const app = express();

/** Ensures directory exists. */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Clears all files in directory to prevent temp file accumulation. */
function clearDirectory(dir) {
  ensureDir(dir);
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile()) fs.unlinkSync(path.join(dir, entry.name));
  }
}

// Initialize directories
clearDirectory(config.outputsDir);
ensureDir(config.spritesDir);
ensureDir(config.videosDir);
ensureDir(config.tempExportDir || path.join(__dirname, 'temp_export'));
ensureDir(path.join(__dirname, 'data', 'images'));

// Middleware (large limit for base64 image uploads e.g. /api/image/upload-edited)
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));
app.use('/outputs', express.static(config.outputsDir));
app.use('/data/sprites', express.static(config.spritesDir));
app.use('/data/videos', express.static(config.videosDir));
// Fallback for old character paths (legacy support)
app.use('/data/characters', express.static(config.spritesDir));
app.use('/data/images', express.static(path.join(__dirname, 'data', 'images')));

// Routes
app.use('/api/sprites', spriteRoutes);
app.post('/api/image/flip', spriteController.flipImage);
app.post('/api/image/pan', spriteController.panImage);
app.post('/api/image/remove-background', spriteController.removeBackground);
app.post('/api/image/upload-edited', spriteController.uploadEditedImage);
app.post('/api/export/rmbg', spriteController.exportRmbg);
app.post('/api/animate/rmbg-video', spriteController.animateRmbgVideo);
app.use('/api/config', configRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/models', modelRoutes);

// Start server (HOST defaults to 0.0.0.0 in config so cloud proxies can connect)
app.listen(config.PORT, config.HOST, () => {
  console.log(`Coomfy listening on http://${config.HOST}:${config.PORT}`);
});
