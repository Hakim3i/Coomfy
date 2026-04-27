const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const config = require('../config');
const { getEffectiveConfig } = require('../utils/configLoader');
const { readSprites, writeSprites } = require('../utils/dataHandler');
const { moveImageToPermanent } = require('../utils/fileUtils');
const { toNum, trimOrNull, stripIsFlipped } = require('../utils/helpers');
const comfyService = require('../services/comfyService');

const generations = new Map();
const SPRITES_DIR = config.spritesDir;
const ROOT_DIR = path.join(__dirname, '../..');

/**
 * Single read + lookup. Avoids repeated readSprites() when we need list and sprite (SRP: one place for "get list and find by id").
 */
function getListAndSprite(id) {
  const list = readSprites();
  const index = list.findIndex((s) => s.id === id);
  return { list, index, sprite: index >= 0 ? list[index] : null };
}

function getDefaultSprite() {
  const c = getEffectiveConfig();
  return {
    name: 'Unnamed',
    type: 'character',
    lora: null,
    model: null,
    gender: c.defaultGender,
    prompt: null,
    seed: -1,
    upscaleSeed: -1,
    size: c.defaultSize,
    orientation: 'portrait',
    backgroundColor: c.defaultBackgroundColor,
    imageUrl: null,
    edits: [],
  };
}

function buildSpriteFromBody(body) {
  const def = getDefaultSprite();
  return {
    name: body.name != null ? (trimOrNull(body.name) || def.name) : def.name,
    type: body.type || def.type,
    lora: body.lora != null ? trimOrNull(body.lora) : def.lora,
    model: body.model != null ? trimOrNull(body.model) : def.model,
    gender: body.gender != null ? body.gender : def.gender,
    prompt: body.prompt != null ? trimOrNull(body.prompt) : def.prompt,
    seed: toNum(body.seed, def.seed),
    upscaleSeed: toNum(body.upscaleSeed, def.upscaleSeed),
    size: body.size || def.size,
    orientation: body.orientation || def.orientation,
    backgroundColor: body.backgroundColor || def.backgroundColor,
    imageUrl: body.imageUrl ?? def.imageUrl,
  };
}

function mergeSpriteUpdates(existing, body) {
  const trim = (v) => (v && typeof v === 'string' ? v.trim() : v);
  const set = (key, fn) => (body[key] !== undefined ? (fn ? fn(body[key]) : body[key]) : existing[key]);
  return {
    ...existing,
    name: set('name', (v) => trim(v) || existing.name),
    type: set('type'),
    gender: set('gender'),
    prompt: set('prompt', trim),
    seed: body.seed != null ? Number(body.seed) : existing.seed,
    upscaleSeed: body.upscaleSeed != null ? Number(body.upscaleSeed) : existing.upscaleSeed,
    lora: set('lora', (v) => trim(v) || null),
    model: set('model', (v) => trim(v) || null),
    size: set('size'),
    orientation: set('orientation'),
    backgroundColor: set('backgroundColor'),
    imageUrl: set('imageUrl'),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Updates in-memory generation status for polling. Only marks 'complete' when actual output is ready
 * to ensure the frontend never sees "Done" without files.
 */
function updateGenerationStatus(promptId, update, seed) {
  const current = generations.get(promptId) || { images: [], videos: [], type: 'queued', seed };
  
  // If already complete, only append additional images or update videos
  if (current.type === 'complete') {
    if (update.type === 'images_ready') {
      current.images = [...current.images, ...update.images];
    } else if (update.type === 'video_ready' && update.videos?.length) {
      current.videos = update.videos;
    }
    current.lastUpdate = Date.now();
    generations.set(promptId, current);
    return;
  }
  
  // Handle status transitions
  if (update.type === 'images_ready') {
    current.images = [...current.images, ...update.images];
    current.type = 'complete';
  } else if (update.type === 'video_ready') {
    current.videos = update.videos || [];
    current.type = 'complete';
  } else if (update.type === 'finished') {
    current.type = 'progress';
    if (update.node !== undefined) current.node = update.node;
  } else {
    current.type = update.type;
    if (update.node) current.node = update.node;
  }
  
  current.lastUpdate = Date.now();
  generations.set(promptId, current);
}

/** Evict stale entries to avoid unbounded memory growth (generations map is in-memory only). */
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of generations.entries()) {
    if (now - data.lastUpdate > config.generationTtlMs) generations.delete(id);
  }
}, config.cleanupIntervalMs);

function deleteSpriteImage(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') return;
  if (!imageUrl.startsWith('/data/sprites/') && !imageUrl.startsWith('/data/images/')) return;
  const filePath = path.join(__dirname, '../..', imageUrl.replace(/^\//, ''));
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.error('Error deleting sprite image:', err);
  }
}

const getSprites = (req, res) => {
  const list = readSprites();
  const normalized = list.map((s) => stripIsFlipped({ ...s, edits: s.edits || [] }));
  res.json(normalized);
};

const createSprite = (req, res) => {
  const id = crypto.randomUUID();
  const permanentImageUrl = moveImageToPermanent(req.body?.imageUrl, SPRITES_DIR, id);
  const sprite = buildSpriteFromBody({ ...req.body, imageUrl: permanentImageUrl });
  sprite.id = id;
  sprite.edits = [];
  sprite.createdAt = new Date().toISOString();

  const list = readSprites();
  list.unshift(sprite);
  writeSprites(list);
  res.status(201).json(stripIsFlipped(sprite));
};

const makeSprite = async (req, res) => {
  try {
    const { promptId, fullPrompt, seed, upscaleSeed } = await comfyService.makeSprite(
      req.body,
      (update) => updateGenerationStatus(promptId, update, seed)
    );
    
    generations.set(promptId, {
      type: 'queued',
      promptId,
      fullPrompt,
      images: [],
      lastUpdate: Date.now(),
      seed,
      upscaleSeed,
    });
    
    res.json({ promptId });
  } catch (err) {
    console.error('[SpriteController] Make error:', err);
    res.status(500).json({ error: err.message });
  }
};

const getGenerationStatus = (req, res) => {
  const status = generations.get(req.params.promptId);
  if (!status) return res.status(404).json({ error: 'Generation not found or expired' });
  res.json(status);
};

const deleteSprite = (req, res) => {
  const { list, sprite } = getListAndSprite(req.params.id);
  if (!sprite) return res.status(404).json({ error: 'Not found' });
  deleteSpriteImage(sprite.imageUrl);
  (sprite.edits || []).forEach((edit) => {
    if (edit.imageUrl) deleteSpriteImage(edit.imageUrl);
  });
  writeSprites(list.filter((s) => s.id !== req.params.id));
  res.status(204).send();
};

const updateSprite = (req, res) => {
  const { id } = req.params;
  const { list, index, sprite: existing } = getListAndSprite(id);
  if (index === -1) return res.status(404).json({ error: 'Sprite not found' });
  const newImageUrl =
    req.body.imageUrl != null && req.body.imageUrl !== existing.imageUrl
      ? moveImageToPermanent(req.body.imageUrl, SPRITES_DIR, id)
      : (req.body.imageUrl ?? existing.imageUrl);
  const updated = mergeSpriteUpdates(existing, { ...req.body, imageUrl: newImageUrl });
  list[index] = updated;
  writeSprites(list);
  res.json(stripIsFlipped(updated));
};

function getSpriteImagePath(sprite) {
  if (!sprite?.imageUrl) return null;
  return path.join(ROOT_DIR, sprite.imageUrl.replace(/^\//, ''));
}

/** URL prefix -> [baseDir, prefixLength]. Avoids magic numbers and keeps path resolution in one place. */
const IMAGE_URL_PREFIXES = [
  ['outputs/', config.outputsDir, 8],
  ['data/sprites/', config.spritesDir, 13],
  ['data/videos/', config.videosDir, 13],
  ['data/images/', path.join(ROOT_DIR, 'data', 'images'), 12],
];

function resolveImageUrlToPath(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') return null;
  const normalized = imageUrl.replace(/^\//, '').split('?')[0].split('#')[0];
  for (const [prefix, baseDir, len] of IMAGE_URL_PREFIXES) {
    if (normalized.startsWith(prefix)) return path.join(baseDir, normalized.slice(len));
  }
  return null;
}

async function flipImageFile(filePath) {
  if (!fs.existsSync(filePath)) throw new Error('Image file not found');
  const buffer = await sharp(filePath).flop().toBuffer();
  fs.writeFileSync(filePath, buffer);
}

const flipSprite = async (req, res) => {
  const { sprite } = getListAndSprite(req.params.id);
  if (!sprite) return res.status(404).json({ error: 'Sprite not found' });
  const imagePath = getSpriteImagePath(sprite);
  if (!imagePath) return res.status(400).json({ error: 'Sprite has no image' });
  try {
    await flipImageFile(imagePath);
    res.json(stripIsFlipped(sprite));
  } catch (err) {
    console.error('Flip sprite image error:', err);
    res.status(500).json({ error: err.message });
  }
};

const flipImage = async (req, res) => {
  const { imageUrl } = req.body || {};
  const filePath = resolveImageUrlToPath(imageUrl);
  if (!filePath) return res.status(400).json({ error: 'Invalid image URL' });
  try {
    await flipImageFile(filePath);
    res.json({ imageUrl });
  } catch (err) {
    console.error('Flip image error:', err);
    res.status(500).json({ error: err.message });
  }
};

const panImage = async (req, res) => {
  const { imageUrl, panX, panY, backgroundColor, zoom } = req.body || {};
  const filePath = resolveImageUrlToPath(imageUrl);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(400).json({ error: 'Invalid or missing image' });
  }
  try {
    const metadata = await sharp(filePath).metadata();
    const width = metadata.width;
    const height = metadata.height;
    
    // Parse background color (hex to RGB)
    const bgColor = backgroundColor || '#000000';
    const r = parseInt(bgColor.slice(1, 3), 16);
    const g = parseInt(bgColor.slice(3, 5), 16);
    const b = parseInt(bgColor.slice(5, 7), 16);
    
    const offsetX = Math.round(panX || 0);
    const offsetY = Math.round(panY || 0);
    const zoomLevel = zoom || 1.0;
    
    let processedImage;
    
    if (zoomLevel !== 1.0) {
      // Zoom: scale image, then crop to viewport
      const scaledWidth = Math.round(width * zoomLevel);
      const scaledHeight = Math.round(height * zoomLevel);
      
      // Resize image to zoomed size
      const scaledBuffer = await sharp(filePath)
        .resize(scaledWidth, scaledHeight, { fit: 'fill' })
        .toBuffer();
      
      // Calculate crop region (what part of the scaled image is visible)
      const cropLeft = Math.max(0, Math.round((scaledWidth - width) / 2 - offsetX));
      const cropTop = Math.max(0, Math.round((scaledHeight - height) / 2 - offsetY));
      const cropWidth = Math.min(width, scaledWidth - cropLeft);
      const cropHeight = Math.min(height, scaledHeight - cropTop);
      
      // Crop the scaled image
      const croppedBuffer = await sharp(scaledBuffer)
        .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
        .toBuffer();
      
      // Create background and composite cropped portion
      const compositeLeft = Math.max(0, -Math.round((scaledWidth - width) / 2 - offsetX));
      const compositeTop = Math.max(0, -Math.round((scaledHeight - height) / 2 - offsetY));
      
      processedImage = await sharp({
        create: {
          width,
          height,
          channels: 4,
          background: { r, g, b, alpha: 1 }
        }
      }).composite([{
        input: croppedBuffer,
        left: compositeLeft,
        top: compositeTop,
        blend: 'over'
      }]).png().toBuffer();
      
    } else {
      // No zoom, just pan
      const background = sharp({
        create: {
          width,
          height,
          channels: 4,
          background: { r, g, b, alpha: 1 }
        }
      }).png();
      
      processedImage = await background.composite([{
        input: filePath,
        left: offsetX,
        top: offsetY,
        blend: 'over'
      }]).png().toBuffer();
    }
    
    fs.writeFileSync(filePath, processedImage);
    
    res.json({ imageUrl });
  } catch (err) {
    console.error('Pan image error:', err);
    res.status(500).json({ error: err.message });
  }
};

const removeBackground = async (req, res) => {
  const { imageUrl, backgroundColor } = req.body || {};
  const filePath = resolveImageUrlToPath(imageUrl);
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(400).json({ error: 'Invalid or missing image' });
  }
  try {
    const { promptId } = await comfyService.runRMBG(
      filePath,
      backgroundColor,
      (update) => updateGenerationStatus(promptId, update)
    );
    generations.set(promptId, {
      type: 'queued',
      promptId,
      images: [],
      lastUpdate: Date.now(),
    });
    res.json({ promptId });
  } catch (err) {
    console.error('[SpriteController] Remove background error:', err);
    res.status(500).json({ error: err.message });
  }
};

const uploadEditedImage = async (req, res) => {
  const { imageData } = req.body || {};
  if (!imageData || typeof imageData !== 'string') {
    return res.status(400).json({ error: 'Missing image data' });
  }
  try {
    // Extract base64 data from data URL
    const matches = imageData.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: 'Invalid image data format' });
    }
    const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Generate unique filename
    const filename = `${crypto.randomUUID()}.${ext}`;
    const imagesDir = path.join(ROOT_DIR, 'data', 'images');
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
    const filePath = path.join(imagesDir, filename);
    
    fs.writeFileSync(filePath, buffer);
    
    const imageUrl = `/data/images/${filename}`;
    res.json({ imageUrl });
  } catch (err) {
    console.error('[SpriteController] Upload edited image error:', err);
    res.status(500).json({ error: err.message });
  }
};

const generateEdit = async (req, res) => {
  try {
    const { sprite } = getListAndSprite(req.params.id);
    if (!sprite) return res.status(404).json({ error: 'Sprite not found' });
    
    const { prompt, seed, imageUrl, lora, model, type } = req.body || {};
    const imagePath = imageUrl ? resolveImageUrlToPath(imageUrl) : getSpriteImagePath(sprite);
    
    if (!imagePath || !fs.existsSync(imagePath)) {
      return res.status(400).json({ error: 'Invalid or missing source image' });
    }
    
    const { promptId, seed: finalSeed } = await comfyService.runEdit(
      imagePath,
      prompt || '',
      seed,
      lora,
      (update, pid) => updateGenerationStatus(pid || promptId, update, finalSeed),
      { model, type }
    );
    
    generations.set(promptId, {
      type: 'queued',
      promptId,
      images: [],
      lastUpdate: Date.now(),
      seed: finalSeed,
    });
    
    res.json({ promptId });
  } catch (err) {
    console.error('[SpriteController] Edit generation error:', err);
    res.status(500).json({ error: err.message });
  }
};

const addEdit = (req, res) => {
  const { editName, prompt, seed, imageUrl, sourceImageUrl, lora, model, type } = req.body || {};
  const { list, sprite } = getListAndSprite(req.params.id);
  
  if (!sprite) return res.status(404).json({ error: 'Sprite not found' });
  
  const permanentUrl = imageUrl?.startsWith('/outputs/')
    ? moveImageToPermanent(imageUrl, SPRITES_DIR, crypto.randomUUID())
    : imageUrl;
  
  const edit = {
    id: crypto.randomUUID(),
    name: trimOrNull(editName) || 'Edit',
    prompt: prompt != null ? String(prompt) : '',
    seed: toNum(seed, -1),
    imageUrl: permanentUrl || null,
    sourceImageUrl: trimOrNull(sourceImageUrl),
    lora: trimOrNull(lora),
    model: trimOrNull(model),
    type: trimOrNull(type) || 'human',
    createdAt: new Date().toISOString(),
  };
  
  sprite.edits = sprite.edits || [];
  sprite.edits.unshift(edit);
  writeSprites(list);
  res.status(201).json(edit);
};

const updateEdit = (req, res) => {
  const { id, editId } = req.params;
  const { editName, name, prompt, seed, imageUrl, sourceImageUrl, lora, model, type } = req.body || {};
  const { list, sprite } = getListAndSprite(id);
  
  if (!sprite) return res.status(404).json({ error: 'Sprite not found' });
  
  const edits = sprite.edits || [];
  const editIndex = edits.findIndex((e) => e.id === editId);
  
  if (editIndex === -1) return res.status(404).json({ error: 'Edit not found' });
  
  const edit = edits[editIndex];
  const resolvedName = trimOrNull(editName ?? name) || edit.name;
  const resolvedPrompt = prompt !== undefined ? String(prompt) : edit.prompt;
  const resolvedSeed = seed != null ? toNum(seed, -1) : edit.seed;
  const resolvedImageUrl = imageUrl == null 
    ? edit.imageUrl 
    : (imageUrl.startsWith('/outputs/') 
        ? moveImageToPermanent(imageUrl, SPRITES_DIR, crypto.randomUUID()) 
        : imageUrl);
  const resolvedSource = sourceImageUrl !== undefined ? trimOrNull(sourceImageUrl) : edit.sourceImageUrl;
  const resolvedLora = lora !== undefined ? trimOrNull(lora) : edit.lora;
  const resolvedModel = model !== undefined ? trimOrNull(model) : edit.model;
  const resolvedType = type !== undefined ? (trimOrNull(type) || 'human') : (edit.type || 'human');
  
  edits[editIndex] = {
    ...edit,
    name: resolvedName,
    prompt: resolvedPrompt,
    seed: resolvedSeed,
    imageUrl: resolvedImageUrl,
    sourceImageUrl: resolvedSource,
    lora: resolvedLora,
    model: resolvedModel,
    type: resolvedType,
  };
  
  writeSprites(list);
  res.json(edits[editIndex]);
};

const generateAnimate = async (req, res) => {
  try {
    const { sprite } = getListAndSprite(req.params.id);
    if (!sprite) return res.status(404).json({ error: 'Sprite not found' });
    
    const { imageUrl, imageUrlLastFrame, prompt, length, fps, seed, pingPong, loraHigh, loraLow, modelHigh, modelLow } = req.body || {};
    const animateFps = Number(fps) || 16;
    const imagePath = resolveImageUrlToPath(imageUrl);
    
    if (!imagePath || !fs.existsSync(imagePath)) {
      return res.status(400).json({ error: 'Invalid or missing image. Select a sprite image or edit' });
    }

    const useFFLF = imageUrlLastFrame && String(imageUrlLastFrame).trim();
    const imagePathLF = useFFLF ? resolveImageUrlToPath(imageUrlLastFrame) : null;
    
    if (useFFLF && (!imagePathLF || !fs.existsSync(imagePathLF))) {
      return res.status(400).json({ error: 'Invalid or missing last frame image' });
    }

    // Determine animation workflow and execute
    const modelOptions = { modelHigh, modelLow };
    let result;
    if (pingPong) {
      result = await comfyService.runAnimatePP(
        imagePath,
        imagePathLF || imagePath,
        prompt || '',
        length,
        seed,
        animateFps,
        loraHigh,
        loraLow,
        (update, pId) => updateGenerationStatus(pId, update, result.seed),
        modelOptions
      );
    } else if (useFFLF) {
      result = await comfyService.runAnimateFFLF(
        imagePath,
        imagePathLF,
        prompt || '',
        length,
        seed,
        animateFps,
        loraHigh,
        loraLow,
        (update, pId) => updateGenerationStatus(pId, update, result.seed),
        modelOptions
      );
    } else {
      result = await comfyService.runAnimate(
        imagePath,
        prompt || '',
        length,
        seed,
        animateFps,
        loraHigh,
        loraLow,
        (update, pId) => updateGenerationStatus(pId, update, result.seed),
        modelOptions
      );
    }

    // Don't overwrite if callback already set complete (fast workflow race)
    const existing = generations.get(result.promptId);
    if (!existing || existing.type !== 'complete') {
      generations.set(result.promptId, {
        type: 'queued',
        promptId: result.promptId,
        videos: [],
        lastUpdate: Date.now(),
        seed: result.seed,
      });
    }

    res.json({ promptId: result.promptId });
  } catch (err) {
    console.error('[SpriteController] Animate generation error:', err);
    res.status(500).json({ error: err.message });
  }
};

const deleteEdit = (req, res) => {
  const { id, editId } = req.params;
  const { list, sprite } = getListAndSprite(id);
  
  if (!sprite) return res.status(404).json({ error: 'Sprite not found' });
  
  const edit = (sprite.edits || []).find((e) => e.id === editId);
  
  if (!edit) return res.status(404).json({ error: 'Edit not found' });
  
  // Delete associated image file
  if (edit.imageUrl?.startsWith('/data/')) {
    const filePath = path.join(ROOT_DIR, edit.imageUrl.replace(/^\//, ''));
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      console.error('[SpriteController] Error deleting edit image:', err);
    }
  }
  
  sprite.edits = sprite.edits.filter((e) => e.id !== editId);
  writeSprites(list);
  res.status(204).send();
};

/**
 * Export RMBG: write frames to temp folder, run RMBG_IMAGES workflow, return promptId for polling.
 * Client sends { frames: dataUrl[], backgroundColor: 'transparent' | '#rrggbb' }.
 */
const exportRmbg = async (req, res) => {
  const { frames, backgroundColor } = req.body || {};
  if (!Array.isArray(frames) || frames.length === 0) {
    return res.status(400).json({ error: 'Missing or empty frames array' });
  }
  if (!fs.existsSync(config.tempExportDir)) {
    fs.mkdirSync(config.tempExportDir, { recursive: true });
  }
  const tempDir = path.join(config.tempExportDir, `rmbg_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`);
  fs.mkdirSync(tempDir, { recursive: true });
  try {
    const padLen = Math.max(5, String(frames.length).length);
    for (let i = 0; i < frames.length; i++) {
      const dataUrl = frames[i];
      const match = typeof dataUrl === 'string' && dataUrl.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
      if (!match) {
        return res.status(400).json({ error: `Invalid frame ${i + 1}: expected data URL` });
      }
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const buffer = Buffer.from(match[2], 'base64');
      const filename = String(i + 1).padStart(padLen, '0') + '.' + ext;
      fs.writeFileSync(path.join(tempDir, filename), buffer);
    }
    const background = backgroundColor === 'transparent' ? 'Alpha' : 'Color';
    const bgColor = backgroundColor === 'transparent' ? undefined : (backgroundColor || '#000000');
    const { promptId } = await comfyService.runRMBGImages(
      tempDir,
      background,
      bgColor,
      (update, pid) => updateGenerationStatus(pid, update)
    );
    generations.set(promptId, {
      type: 'queued',
      promptId,
      images: [],
      lastUpdate: Date.now(),
    });
    res.json({ promptId });
  } catch (err) {
    console.error('[SpriteController] Export RMBG error:', err);
    try {
      const entries = fs.readdirSync(tempDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile()) fs.unlinkSync(path.join(tempDir, e.name));
      }
      fs.rmdirSync(tempDir);
    } catch (_) {}
    res.status(500).json({ error: err.message });
  }
};

/**
 * Animate RMBG: run RMBG_VIDEO workflow on a video file, return promptId for polling.
 * Client sends { videoUrl: string, backgroundColor: 'transparent' | '#rrggbb' }.
 */
const animateRmbgVideo = async (req, res) => {
  const { videoUrl, backgroundColor } = req.body || {};
  if (!videoUrl || typeof videoUrl !== 'string') {
    return res.status(400).json({ error: 'Missing videoUrl' });
  }
  const videoPath = resolveImageUrlToPath(videoUrl.trim());
  if (!videoPath || !fs.existsSync(videoPath)) {
    return res.status(400).json({ error: 'Video file not found. It may have been cleared or the path is invalid.' });
  }
  try {
    const background = backgroundColor === 'transparent' ? 'Alpha' : 'Color';
    const bgColor = backgroundColor === 'transparent' ? undefined : (backgroundColor || '#000000');
    const { promptId } = await comfyService.runRMBGVideo(
      videoPath,
      background,
      bgColor,
      (update, pid) => updateGenerationStatus(pid, update),
      (pid) => {
        generations.set(pid, {
          type: 'queued',
          promptId: pid,
          videos: [],
          lastUpdate: Date.now(),
        });
      }
    );
    res.json({ promptId });
  } catch (err) {
    console.error('[SpriteController] Animate RMBG video error:', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getSprites,
  createSprite,
  makeSprite,
  getGenerationStatus,
  deleteSprite,
  updateSprite,
  flipSprite,
  flipImage,
  panImage,
  removeBackground,
  uploadEditedImage,
  generateEdit,
  addEdit,
  updateEdit,
  deleteEdit,
  generateAnimate,
  exportRmbg,
  animateRmbgVideo,
};
