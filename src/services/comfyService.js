const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');
const config = require('../config');
const { getEffectiveConfig } = require('../utils/configLoader');
const { parseSeed } = require('../utils/helpers');

const RECONNECT_MS = 5000;

/** Make.json workflow node IDs (sprite creation). LORA = Power Lora Loader (rgthree) node 1168. */
const MAKE_NODE = {
  PROMPT: '1154',
  NEGATIVE: '1153',
  SEED: '972',
  SIZE: '955',
  LORA: '1168',
  BACKGROUND: '1028',
  UPSCALE_SEED: '925',
  OUTPUT_RESIZE: '1142',
  PADDING_WIDTH: '1162',
  PADDING_HEIGHT: '1163',
  CHECKPOINT: '1157',
};

/** Edit.json workflow node IDs: 83 = LoadImage, 103 = prompt, 107 = KSampler seed, 92 = SaveImage, 110 = Qwen Edit Lora, 96 = UNETLoader */
const EDIT_NODE = {
  IMAGE: '83',
  PROMPT: '103',
  SEED: '107',
  OUTPUT: '92',
  QWEN_EDIT_LORA: '110',
  MODEL: '96',
};

/** Make workflow final output node (SaveImage). Only this node's executed message is used for completion. */
const MAKE_OUTPUT_NODE = '1156';

/** RMBG.json: 3 = LoadImage, 2 = RMBG (background removal), 5 = SaveImage */
const RMBG_NODE = {
  IMAGE: '3',
  RMBG: '2',
  OUTPUT: '5',
};

/** RMBG_IMAGES.json: 19 = VHS_LoadImagesPath (directory), 2 = RMBG, 18 = SaveImage */
const RMBG_IMAGES_NODE = {
  LOAD_PATH: '19',
  RMBG: '2',
  OUTPUT: '18',
};

/** RMBG_VIDEO.json: 22 = VHS_LoadVideo, 2 = RMBG, 24 = VHS_VideoCombine, 25 = VHS_VideoInfo */
const RMBG_VIDEO_NODE = {
  LOAD_VIDEO: '22',
  RMBG: '2',
  OUTPUT: '24',
  VIDEO_INFO: '25',
};

/** Animate.json: 97 = LoadImage, 93 = prompt, 98 = length, 86 = noise_seed, 94 = CreateVideo, 108 = SaveVideo; 119 = Power Lora HIGH NOISE, 120 = Power Lora LOW NOISE; 95 = UNETLoader HIGH, 96 = UNETLoader LOW. */
const ANIMATE_NODE = {
  IMAGE: '97',
  PROMPT: '93',
  LENGTH: '98',
  NOISE_SEED: '86',
  CREATE_VIDEO: '94',
  OUTPUT: '108',
  LORA_HIGH: '119',
  LORA_LOW: '120',
  MODEL_HIGH: '95',
  MODEL_LOW: '96',
};

/** AnimateFFLF.json: 97 = First Frame, 118 = Last Frame, 117 = length, 86 = noise_seed, 94 = CreateVideo, 108 = SaveVideo; 127 = Power Lora HIGH NOISE, 126 = Power Lora LOW NOISE; 95 = UNETLoader HIGH, 96 = UNETLoader LOW. */
const ANIMATE_FFLF_NODE = {
  IMAGE_FF: '97',
  IMAGE_LF: '118',
  PROMPT: '93',
  LENGTH: '117',
  NOISE_SEED: '86',
  CREATE_VIDEO: '94',
  OUTPUT: '108',
  LORA_HIGH: '127',
  LORA_LOW: '126',
  MODEL_HIGH: '95',
  MODEL_LOW: '96',
};

/** AnimatePP.json: 97 = FF, 118 = LF, 117/119 = lengths, 86 + 120 = noise_seed, 94 = CreateVideo, 108 = SaveVideo; 131 = Power Lora HIGH NOISE, 130 = Power Lora LOW NOISE; 95 = UNETLoader HIGH, 96 = UNETLoader LOW. */
const ANIMATE_PP_NODE = {
  IMAGE_FF: '97',
  IMAGE_LF: '118',
  PROMPT: '93',
  LENGTH_1: '117',
  LENGTH_2: '119',
  NOISE_SEED_1: '86',
  NOISE_SEED_2: '120',
  CREATE_VIDEO: '94',
  OUTPUT: '108',
  LORA_HIGH: '131',
  LORA_LOW: '130',
  MODEL_HIGH: '95',
  MODEL_LOW: '96',
};

/** Builds ComfyUI /view URL for downloading an output image. */
function buildViewUrl(filename, subfolder = '', type = 'output') {
  const q = new URLSearchParams({ filename, subfolder, type });
  return `${config.COMFY_URL}/view?${q.toString()}`;
}

/** Fetch JSON from ComfyUI using native http module. */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data || '{}'));
        } catch {
          resolve({});
        }
      });
    }).on('error', reject);
  });
}

/** Track animate prompt IDs so we can fetch from history on finish. */
const animatePromptIds = new Set();

class ComfyService {
  constructor() {
    this.clientId = crypto.randomUUID();
    this.ws = null;
    this.activeGenerations = new Map();
    this.messageBuffer = new Map();
    this.outputNodeByPromptId = new Map();
    this.workflowCache = null;
    this.connect();
  }

  connect() {
    const wsBase = config.COMFY_URL.replace(/^http/, 'ws');
    const wsUrl = `${wsBase}/ws?clientId=${this.clientId}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      console.log(`[ComfyService] Connected to ComfyUI (clientId: ${this.clientId})`);
    });

    this.ws.on('message', (data) => {
      try {
        this.handleMessage(JSON.parse(data));
      } catch {
        // Ignore binary (previews)
      }
    });

    this.ws.on('error', (err) => {
      console.error('[ComfyService] WebSocket error:', err.message);
    });

    this.ws.on('close', () => {
      console.log('[ComfyService] Closed. Reconnecting in', RECONNECT_MS / 1000, 's...');
      setTimeout(() => this.connect(), RECONNECT_MS);
    });
  }

  /**
   * Routes WebSocket messages to the correct generation callback.
   * Buffers messages for promptIds not yet registered (race: prompt queued before we set callback).
   */
  handleMessage(msg) {
    const promptId = msg.data?.prompt_id;
    if (!promptId) return;

    const callback = this.activeGenerations.get(promptId);
    if (!callback) {
      const buf = this.messageBuffer.get(promptId) ?? [];
      if (!buf.length) this.messageBuffer.set(promptId, buf);
      buf.push(msg);
      return;
    }

    if (msg.type === 'executing') {
      const { node } = msg.data;
      if (node === null) {
        callback({ type: 'finished' }, promptId);
        if (animatePromptIds.has(promptId)) {
          this.fetchVideoFromHistory(promptId, callback).catch((err) => {
            console.error('[ComfyService] fetchVideoFromHistory error:', err);
          });
        }
      } else {
        callback({ type: 'progress', node }, promptId);
      }
    } else if (msg.type === 'executed') {
      const expectedNode = this.outputNodeByPromptId.get(promptId);
      const executedNode = msg.data?.node;
      const nodeMatch = expectedNode == null || String(executedNode) === String(expectedNode);
      if (!nodeMatch) return;
      this.outputNodeByPromptId.delete(promptId);
      const output = msg.data?.output || {};
      
      // For animate workflows, skip - wait for history fetch
      if (animatePromptIds.has(promptId)) return;
      
      const images = output.images;
      if (images?.length) {
        this.handleImages(images, promptId, callback);
      } else {
        callback({ type: 'images_ready', images: [] }, promptId);
      }
    }
  }

  /** Fetch video from ComfyUI history API for animate workflows. */
  async fetchVideoFromHistory(promptId, callback) {
    animatePromptIds.delete(promptId);
    try {
      await new Promise((r) => setTimeout(r, 1000));
      const historyUrl = `${config.COMFY_URL}/history/${promptId}`;
      const body = await fetchJson(historyUrl);
      const record = body[promptId] || body;
      const outputs = record?.outputs || {};
      
      let videos = [];
      for (const nodeId of Object.keys(outputs)) {
        const nodeOut = outputs[nodeId];
        for (const key of Object.keys(nodeOut || {})) {
          const value = nodeOut[key];
          if (Array.isArray(value)) {
            for (const item of value) {
              if (item && typeof item === 'object' && (item.filename || item.name)) {
                let filename = item.filename || item.name;
                let subfolder = item.subfolder || '';
                if (filename.includes('/') && !subfolder) {
                  const parts = filename.split('/');
                  subfolder = parts.slice(0, -1).join('/');
                  filename = parts[parts.length - 1];
                }
                if (filename.match(/\.(mp4|webm|gif|avi|mov)$/i)) {
                  videos.push({
                    filename,
                    subfolder,
                    type: item.type || 'output'
                  });
                }
              }
            }
          }
        }
        if (videos.length > 0) break;
      }
      
      if (videos.length > 0) {
        await this.handleVideo(videos, promptId, callback);
      } else {
        callback({ type: 'video_ready', videos: [] }, promptId);
      }
    } catch (err) {
      console.error('[ComfyService] History fetch error:', err);
      callback({ type: 'video_ready', videos: [] }, promptId);
    }
  }

  /**
   * Downloads images from ComfyUI and writes to outputsDir. Runs downloads in parallel to reduce
   * total latency when a workflow outputs multiple images (e.g. preview + final).
   */
  async handleImages(images, promptId, callback) {
    const ts = Date.now();
    const tasks = images.map(async (img) => {
      const { filename, subfolder, type } = img;
      const url = buildViewUrl(filename, subfolder || '', type || 'output');
      const localFilename = `gen_${ts}_${filename}`;
      const localPath = path.join(config.outputsDir, localFilename);
      try {
        await this.downloadFile(url, localPath);
        return `/outputs/${localFilename}`;
      } catch (err) {
        console.error('[ComfyService] Download failed:', filename, err.message);
        return null;
      }
    });
    const results = (await Promise.all(tasks)).filter(Boolean);
    callback({ type: 'images_ready', images: results }, promptId);
  }

  /** Downloads file from ComfyUI /view endpoint (supports images and videos). */
  downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      http.get(url, (res) => {
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => {});
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close((err) => (err ? reject(err) : resolve()));
        });
      }).on('error', (err) => {
        file.close();
        fs.unlink(dest, () => {});
        reject(err);
      });
      file.on('error', reject);
    });
  }

  /** Downloads video output from SaveVideo node; callback receives video_ready with URLs. */
  async handleVideo(videoList, promptId, callback) {
    const ts = Date.now();
    const tasks = videoList.map(async (item) => {
      const filename = item.filename;
      const subfolder = item.subfolder || '';
      const type = item.type || 'output';
      const url = buildViewUrl(filename, subfolder, type);
      const localFilename = `gen_${ts}_${filename}`;
      const localPath = path.join(config.outputsDir, localFilename);
      try {
        await this.downloadFile(url, localPath);
        return `/outputs/${localFilename}`;
      } catch (err) {
        console.error('[ComfyService] Video download failed:', filename, err.message);
        return null;
      }
    });
    const results = (await Promise.all(tasks)).filter(Boolean);
    callback({ type: 'video_ready', videos: results }, promptId);
  }

  /** Loads workflow from file path. Make workflow is cached. */
  loadWorkflowFromPath(filePath, workflowName = 'Workflow') {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      console.error(`[ComfyService] ${workflowName} load failed:`, err.message);
      throw new Error(`${workflowName}: ${err.message}`);
    }
  }

  /** Returns a deep copy of the make workflow. Cached to avoid repeated disk I/O. */
  loadMakeWorkflow() {
    if (this.workflowCache) return JSON.parse(JSON.stringify(this.workflowCache));
    this.workflowCache = this.loadWorkflowFromPath(config.makeWorkflowPath, 'Make workflow');
    return JSON.parse(JSON.stringify(this.workflowCache));
  }

  /** Returns parsed Edit workflow. */
  loadEditWorkflow() {
    return this.loadWorkflowFromPath(config.editWorkflowPath, 'Edit workflow');
  }

  /** Returns parsed Animate workflow. */
  loadAnimateWorkflow() {
    return this.loadWorkflowFromPath(config.animateWorkflowPath, 'Animate workflow');
  }

  /** Returns parsed AnimateFFLF workflow (first frame + last frame). */
  loadAnimateFFLFWorkflow() {
    return this.loadWorkflowFromPath(config.animateFFLFWorkflowPath, 'AnimateFFLF workflow');
  }

  /** Returns parsed AnimatePP workflow (ping pong: two segments, lengths in 117 and 119). */
  loadAnimatePPWorkflow() {
    return this.loadWorkflowFromPath(config.animatePPWorkflowPath, 'AnimatePP workflow');
  }

  /** Returns parsed RMBG workflow (background removal). */
  loadRMBGWorkflow() {
    return this.loadWorkflowFromPath(config.rmbgWorkflowPath, 'RMBG workflow');
  }

  /** Returns parsed RMBG_IMAGES workflow (batch load from directory). */
  loadRMBGImagesWorkflow() {
    return this.loadWorkflowFromPath(config.rmbgImagesWorkflowPath, 'RMBG_IMAGES workflow');
  }

  /** Returns parsed RMBG_VIDEO workflow (video in → RMBG → video out). */
  loadRMBGVideoWorkflow() {
    return this.loadWorkflowFromPath(config.rmbgVideoWorkflowPath, 'RMBG_VIDEO workflow');
  }

  /**
   * Registers a generation callback and replays any buffered WebSocket messages.
   * Ensures we don't miss messages that arrived before the callback was set.
   */
  registerGeneration(promptId, outputNodeId, statusCallback) {
    this.outputNodeByPromptId.set(promptId, outputNodeId);
    if (statusCallback) {
      this.activeGenerations.set(promptId, statusCallback);
      const buffered = this.messageBuffer.get(promptId);
      if (buffered) {
        this.messageBuffer.delete(promptId);
        buffered.forEach((m) => this.handleMessage(m));
      }
    }
  }

  /** Uploads image to ComfyUI and returns the filename. */
  async uploadImageToComfy(imagePath) {
    const buffer = fs.readFileSync(imagePath);
    const blob = new Blob([buffer]);
    const form = new FormData();
    form.append('image', blob, path.basename(imagePath));
    const res = await fetch(`${config.COMFY_URL}/upload/image`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`);
    const data = await res.json();
    return data?.name || path.basename(imagePath);
  }

  /** Uploads video to ComfyUI input folder. Uses /upload/image (ComfyUI accepts video files there). */
  async uploadVideoToComfy(videoPath) {
    const buffer = fs.readFileSync(videoPath);
    const blob = new Blob([buffer]);
    const form = new FormData();
    form.append('image', blob, path.basename(videoPath));
    const res = await fetch(`${config.COMFY_URL}/upload/image`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Video upload failed: ${res.statusText}`);
    const data = await res.json();
    return data?.name || path.basename(videoPath);
  }

  /** Submits workflow to ComfyUI and handles errors. */
  async submitWorkflow(workflow) {
    const res = await fetch(`${config.COMFY_URL}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: this.clientId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = data.error?.message ?? data.error ?? (data.node_errors ? JSON.stringify(data.node_errors) : res.statusText);
      throw new Error(`ComfyUI: ${errMsg}`);
    }
    return data.prompt_id;
  }

  async runEdit(spriteImagePath, prompt, seed, lora, statusCallback, options = {}) {
    const workflow = this.loadEditWorkflow();
    const finalSeed = parseSeed(seed);

    if (spriteImagePath && fs.existsSync(spriteImagePath)) {
      const filename = await this.uploadImageToComfy(spriteImagePath);
      if (workflow[EDIT_NODE.IMAGE]?.inputs) workflow[EDIT_NODE.IMAGE].inputs.image = filename;
    }
    const normalizedType = typeof options.type === 'string' ? options.type.trim().toLowerCase() : '';
    const finalPrompt = normalizedType ? [normalizedType, prompt].filter(Boolean).join(', ') : (prompt || '');
    if (workflow[EDIT_NODE.PROMPT]?.inputs) workflow[EDIT_NODE.PROMPT].inputs.prompt = finalPrompt;
    if (workflow[EDIT_NODE.SEED]?.inputs) workflow[EDIT_NODE.SEED].inputs.seed = finalSeed;
    if (workflow[EDIT_NODE.QWEN_EDIT_LORA]?.inputs?.lora_1) {
      const loraName = (lora && String(lora).trim()) || '';
      workflow[EDIT_NODE.QWEN_EDIT_LORA].inputs.lora_1.lora = loraName || 'None';
      workflow[EDIT_NODE.QWEN_EDIT_LORA].inputs.lora_1.on = !!loraName;
    }
    this.setUnetNode(workflow, EDIT_NODE.MODEL, options.model);

    const promptId = await this.submitWorkflow(workflow);
    this.registerGeneration(promptId, EDIT_NODE.OUTPUT, statusCallback);
    return { promptId, seed: finalSeed };
  }

  /**
   * Runs the RMBG (remove background) workflow on an image.
   * @param {string} imagePath - Absolute path to the image file
   * @param {string} [backgroundColor] - 'transparent' for alpha, or hex color for solid (e.g. #000000)
   * @param {Function} statusCallback - Called with (update, promptId) for progress/completion
   * @returns {Promise<{ promptId: string }>}
   */
  async runRMBG(imagePath, backgroundColor, statusCallback) {
    const workflow = this.loadRMBGWorkflow();

    if (imagePath && fs.existsSync(imagePath)) {
      const filename = await this.uploadImageToComfy(imagePath);
      if (workflow[RMBG_NODE.IMAGE]?.inputs) workflow[RMBG_NODE.IMAGE].inputs.image = filename;
    } else {
      throw new Error('Image file not found for background removal');
    }

    const background = backgroundColor === 'transparent' ? 'Alpha' : 'Color';
    const bgColor = backgroundColor === 'transparent' ? '#000000' : (backgroundColor && /^#[0-9A-Fa-f]{6}$/.test(backgroundColor) ? backgroundColor : '#000000');
    if (workflow[RMBG_NODE.RMBG]?.inputs) {
      workflow[RMBG_NODE.RMBG].inputs.background = background;
      workflow[RMBG_NODE.RMBG].inputs.background_color = bgColor;
    }

    const promptId = await this.submitWorkflow(workflow);
    this.registerGeneration(promptId, RMBG_NODE.OUTPUT, statusCallback);
    return { promptId };
  }

  /**
   * Runs the RMBG_IMAGES workflow: load images from a directory, process with RMBG, output via SaveImage.
   * @param {string} tempDir - Absolute path to folder containing input images (e.g. frame_00001.png)
   * @param {string} background - "Alpha" for transparent or "Color" for solid
   * @param {string} [backgroundColor] - Hex color when background is "Color" (e.g. #000000)
   * @param {Function} statusCallback - Called with (update, promptId)
   * @returns {Promise<{ promptId: string }>}
   */
  async runRMBGImages(tempDir, background, backgroundColor, statusCallback) {
    const workflow = this.loadRMBGImagesWorkflow();
    const dirPath = path.isAbsolute(tempDir) ? tempDir : path.resolve(tempDir);
    const dirForComfy = dirPath.replace(/\//g, path.sep);

    if (workflow[RMBG_IMAGES_NODE.LOAD_PATH]?.inputs) {
      workflow[RMBG_IMAGES_NODE.LOAD_PATH].inputs.directory = dirForComfy;
    }
    if (workflow[RMBG_IMAGES_NODE.RMBG]?.inputs) {
      workflow[RMBG_IMAGES_NODE.RMBG].inputs.background = background === 'Color' ? 'Color' : 'Alpha';
      if (background === 'Color' && backgroundColor && /^#[0-9A-Fa-f]{6}$/.test(backgroundColor)) {
        workflow[RMBG_IMAGES_NODE.RMBG].inputs.background_color = backgroundColor;
      } else {
        workflow[RMBG_IMAGES_NODE.RMBG].inputs.background_color = '#000000';
      }
    }

    const promptId = await this.submitWorkflow(workflow);
    this.registerGeneration(promptId, RMBG_IMAGES_NODE.OUTPUT, statusCallback);
    return { promptId };
  }

  /**
   * Runs the RMBG_VIDEO workflow: VHS_LoadVideo, RMBG, VHS_VideoCombine.
   * @param {string} videoPath - Absolute path to the input video file
   * @param {string} background - "Alpha" for transparent or "Color" for solid
   * @param {string} [backgroundColor] - Hex color when background is "Color"
   * @param {Function} statusCallback - Called with (update, promptId)
   * @param {Function} [initCallback] - Called with (promptId) as soon as we have it; use to pre-create polling entry
   * @returns {Promise<{ promptId: string }>}
   */
  async runRMBGVideo(videoPath, background, backgroundColor, statusCallback, initCallback) {
    const workflow = this.loadRMBGVideoWorkflow();

    if (!videoPath || !fs.existsSync(videoPath)) {
      throw new Error('Video file not found for RMBG');
    }
    const filename = await this.uploadVideoToComfy(videoPath);
    if (workflow[RMBG_VIDEO_NODE.LOAD_VIDEO]?.inputs) {
      workflow[RMBG_VIDEO_NODE.LOAD_VIDEO].inputs.video = filename;
    }
    if (workflow[RMBG_VIDEO_NODE.RMBG]?.inputs) {
      workflow[RMBG_VIDEO_NODE.RMBG].inputs.background = background === 'Color' ? 'Color' : 'Alpha';
      if (background === 'Color' && backgroundColor && /^#[0-9A-Fa-f]{6}$/.test(backgroundColor)) {
        workflow[RMBG_VIDEO_NODE.RMBG].inputs.background_color = backgroundColor;
      } else {
        workflow[RMBG_VIDEO_NODE.RMBG].inputs.background_color = '#000000';
      }
    }

    const promptId = await this.submitWorkflow(workflow);
    if (initCallback) initCallback(promptId);
    animatePromptIds.add(promptId);
    this.registerGeneration(promptId, RMBG_VIDEO_NODE.OUTPUT, statusCallback);
    return { promptId };
  }

  async makeSprite(params, statusCallback) {
    const { gender, spriteType, prompt, seed, lora, orientation, model } = params;
    const cfg = getEffectiveConfig();
    const isObject = spriteType === 'object';
    const baseTags = isObject ? cfg.defaultPromptTagsObject : cfg.defaultPromptTags;
    const genderTag = isObject ? null : (cfg.genderPrompts[gender] || cfg.genderPrompts.female);
    const fullPrompt = [genderTag, prompt, baseTags].filter(Boolean).join(', ');
    const negativePrompt = cfg.defaultNegativePrompt;
    const isLandscape = orientation === 'landscape';

    const workflow = this.loadMakeWorkflow();
    const finalSeed = parseSeed(seed);
    const finalUpscaleSeed = parseSeed(params.upscaleSeed);

    if (workflow[MAKE_NODE.PROMPT]) workflow[MAKE_NODE.PROMPT].inputs.value = fullPrompt;
    if (workflow[MAKE_NODE.NEGATIVE]) workflow[MAKE_NODE.NEGATIVE].inputs.value = negativePrompt;
    if (workflow[MAKE_NODE.SEED]) workflow[MAKE_NODE.SEED].inputs.seed = finalSeed;
    if (workflow[MAKE_NODE.UPSCALE_SEED]) workflow[MAKE_NODE.UPSCALE_SEED].inputs.seed = finalUpscaleSeed;

    if (workflow[MAKE_NODE.SIZE]) {
      const presets = cfg.sizePresets;
      const size = presets[params.size] || presets[cfg.defaultSize] || presets.large;
      // Invert width/height for landscape orientation
      workflow[MAKE_NODE.SIZE].inputs.width_override = isLandscape ? size.height : size.width;
      workflow[MAKE_NODE.SIZE].inputs.height_override = isLandscape ? size.width : size.height;
    }
    
    // Update output resize node (1142) with inverted dimensions for landscape
    if (workflow[MAKE_NODE.OUTPUT_RESIZE]) {
      // Default is 768x1280 (portrait), for landscape use 1280x768
      workflow[MAKE_NODE.OUTPUT_RESIZE].inputs.width = isLandscape ? 1280 : 768;
      workflow[MAKE_NODE.OUTPUT_RESIZE].inputs.height = isLandscape ? 768 : 1280;
    }
    
    // Update padding Math Expression nodes for landscape
    // Node 1162: left/right padding = (outputWidth - inputWidth) / 2
    // Node 1163: top/bottom padding = (outputHeight - inputHeight) / 2
    if (workflow[MAKE_NODE.PADDING_WIDTH]) {
      workflow[MAKE_NODE.PADDING_WIDTH].inputs.expression = isLandscape ? '(1280 - a) / 2' : '(768 - a) / 2';
    }
    if (workflow[MAKE_NODE.PADDING_HEIGHT]) {
      workflow[MAKE_NODE.PADDING_HEIGHT].inputs.expression = isLandscape ? '(768 - a) / 2' : '(1280 - a) / 2';
    }
    
    if (workflow[MAKE_NODE.LORA]?.inputs?.lora_1) {
      const loraName = (lora && String(lora).trim()) || '';
      workflow[MAKE_NODE.LORA].inputs.lora_1.lora = loraName || 'None';
      workflow[MAKE_NODE.LORA].inputs.lora_1.on = !!loraName;
    }
    this.setCheckpointNode(workflow, MAKE_NODE.CHECKPOINT, model);
    if (params.backgroundColor && workflow[MAKE_NODE.BACKGROUND]) {
      workflow[MAKE_NODE.BACKGROUND].inputs.background_color = params.backgroundColor;
    }

    const promptId = await this.submitWorkflow(workflow);
    this.registerGeneration(promptId, MAKE_OUTPUT_NODE, statusCallback);
    return { promptId, fullPrompt, seed: finalSeed, upscaleSeed: finalUpscaleSeed };
  }

  /** Set Power Lora Loader (rgthree) lora_1 from loraName ('' or 'None' = off). */
  setAnimateLoraNode(workflow, nodeId, loraName) {
    if (!workflow[nodeId]?.inputs?.lora_1) return;
    const name = (loraName && String(loraName).trim()) || '';
    workflow[nodeId].inputs.lora_1.lora = name || 'None';
    workflow[nodeId].inputs.lora_1.on = !!name;
  }

  /** Set CheckpointLoaderSimple.ckpt_name. No-op when modelName is empty to preserve workflow default. */
  setCheckpointNode(workflow, nodeId, modelName) {
    const name = (modelName && String(modelName).trim()) || '';
    if (!name || !workflow[nodeId]?.inputs) return;
    workflow[nodeId].inputs.ckpt_name = name;
  }

  /** Set UNETLoader.unet_name. No-op when modelName is empty to preserve workflow default. */
  setUnetNode(workflow, nodeId, modelName) {
    const name = (modelName && String(modelName).trim()) || '';
    if (!name || !workflow[nodeId]?.inputs) return;
    workflow[nodeId].inputs.unet_name = name;
  }

  async runAnimate(imagePath, prompt, length, seed, fps, loraHigh, loraLow, statusCallback, options = {}) {
    const workflow = this.loadAnimateWorkflow();
    const finalSeed = parseSeed(seed);
    const frameCount = Number(length) || config.defaultAnimateFrames || 81;
    const fpsNum = Number(fps) || 16;

    if (imagePath && fs.existsSync(imagePath)) {
      const filename = await this.uploadImageToComfy(imagePath);
      if (workflow[ANIMATE_NODE.IMAGE]?.inputs) workflow[ANIMATE_NODE.IMAGE].inputs.image = filename;
    }
    if (workflow[ANIMATE_NODE.PROMPT]?.inputs) workflow[ANIMATE_NODE.PROMPT].inputs.text = prompt || '';
    if (workflow[ANIMATE_NODE.LENGTH]?.inputs) workflow[ANIMATE_NODE.LENGTH].inputs.length = frameCount;
    if (workflow[ANIMATE_NODE.NOISE_SEED]?.inputs) workflow[ANIMATE_NODE.NOISE_SEED].inputs.noise_seed = finalSeed;
    if (workflow[ANIMATE_NODE.CREATE_VIDEO]?.inputs) workflow[ANIMATE_NODE.CREATE_VIDEO].inputs.fps = fpsNum;
    this.setAnimateLoraNode(workflow, ANIMATE_NODE.LORA_HIGH, loraHigh);
    this.setAnimateLoraNode(workflow, ANIMATE_NODE.LORA_LOW, loraLow);
    this.setUnetNode(workflow, ANIMATE_NODE.MODEL_HIGH, options.modelHigh);
    this.setUnetNode(workflow, ANIMATE_NODE.MODEL_LOW, options.modelLow);

    const promptId = await this.submitWorkflow(workflow);
    animatePromptIds.add(promptId);
    this.registerGeneration(promptId, ANIMATE_NODE.OUTPUT, statusCallback);
    return { promptId, seed: finalSeed };
  }

  async runAnimateFFLF(imagePathFF, imagePathLF, prompt, length, seed, fps, loraHigh, loraLow, statusCallback, options = {}) {
    const workflow = this.loadAnimateFFLFWorkflow();
    const finalSeed = parseSeed(seed);
    const frameCount = Number(length) || config.defaultAnimateFrames || 81;
    const fpsNum = Number(fps) || 16;

    if (imagePathFF && fs.existsSync(imagePathFF)) {
      const filenameFF = await this.uploadImageToComfy(imagePathFF);
      if (workflow[ANIMATE_FFLF_NODE.IMAGE_FF]?.inputs) workflow[ANIMATE_FFLF_NODE.IMAGE_FF].inputs.image = filenameFF;
    }
    if (imagePathLF && fs.existsSync(imagePathLF)) {
      const filenameLF = await this.uploadImageToComfy(imagePathLF);
      if (workflow[ANIMATE_FFLF_NODE.IMAGE_LF]?.inputs) workflow[ANIMATE_FFLF_NODE.IMAGE_LF].inputs.image = filenameLF;
    }
    if (workflow[ANIMATE_FFLF_NODE.PROMPT]?.inputs) workflow[ANIMATE_FFLF_NODE.PROMPT].inputs.text = prompt || '';
    if (workflow[ANIMATE_FFLF_NODE.LENGTH]?.inputs) workflow[ANIMATE_FFLF_NODE.LENGTH].inputs.length = frameCount;
    if (workflow[ANIMATE_FFLF_NODE.NOISE_SEED]?.inputs) workflow[ANIMATE_FFLF_NODE.NOISE_SEED].inputs.noise_seed = finalSeed;
    if (workflow[ANIMATE_FFLF_NODE.CREATE_VIDEO]?.inputs) workflow[ANIMATE_FFLF_NODE.CREATE_VIDEO].inputs.fps = fpsNum;
    this.setAnimateLoraNode(workflow, ANIMATE_FFLF_NODE.LORA_HIGH, loraHigh);
    this.setAnimateLoraNode(workflow, ANIMATE_FFLF_NODE.LORA_LOW, loraLow);
    this.setUnetNode(workflow, ANIMATE_FFLF_NODE.MODEL_HIGH, options.modelHigh);
    this.setUnetNode(workflow, ANIMATE_FFLF_NODE.MODEL_LOW, options.modelLow);

    const promptId = await this.submitWorkflow(workflow);
    animatePromptIds.add(promptId);
    this.registerGeneration(promptId, ANIMATE_FFLF_NODE.OUTPUT, statusCallback);
    return { promptId, seed: finalSeed };
  }

  /** Ping pong: totalLength split evenly between nodes 117 and 119 (min 34, max 204). */
  async runAnimatePP(imagePathFF, imagePathLF, prompt, totalLength, seed, fps, loraHigh, loraLow, statusCallback, options = {}) {
    const workflow = this.loadAnimatePPWorkflow();
    const finalSeed = parseSeed(seed);
    const fpsNum = Number(fps) || 16;
    const total = Math.max(34, Math.min(204, Number(totalLength) || 68));
    const length1 = Math.floor(total / 2);
    const length2 = total - length1;

    if (imagePathFF && fs.existsSync(imagePathFF)) {
      const filenameFF = await this.uploadImageToComfy(imagePathFF);
      if (workflow[ANIMATE_PP_NODE.IMAGE_FF]?.inputs) workflow[ANIMATE_PP_NODE.IMAGE_FF].inputs.image = filenameFF;
    }
    if (imagePathLF && fs.existsSync(imagePathLF)) {
      const filenameLF = await this.uploadImageToComfy(imagePathLF);
      if (workflow[ANIMATE_PP_NODE.IMAGE_LF]?.inputs) workflow[ANIMATE_PP_NODE.IMAGE_LF].inputs.image = filenameLF;
    }
    if (workflow[ANIMATE_PP_NODE.PROMPT]?.inputs) workflow[ANIMATE_PP_NODE.PROMPT].inputs.text = prompt || '';
    if (workflow[ANIMATE_PP_NODE.LENGTH_1]?.inputs) workflow[ANIMATE_PP_NODE.LENGTH_1].inputs.length = length1;
    if (workflow[ANIMATE_PP_NODE.LENGTH_2]?.inputs) workflow[ANIMATE_PP_NODE.LENGTH_2].inputs.length = length2;
    if (workflow[ANIMATE_PP_NODE.NOISE_SEED_1]?.inputs) workflow[ANIMATE_PP_NODE.NOISE_SEED_1].inputs.noise_seed = finalSeed;
    if (workflow[ANIMATE_PP_NODE.NOISE_SEED_2]?.inputs) workflow[ANIMATE_PP_NODE.NOISE_SEED_2].inputs.noise_seed = finalSeed;
    if (workflow[ANIMATE_PP_NODE.CREATE_VIDEO]?.inputs) workflow[ANIMATE_PP_NODE.CREATE_VIDEO].inputs.fps = fpsNum;
    this.setAnimateLoraNode(workflow, ANIMATE_PP_NODE.LORA_HIGH, loraHigh);
    this.setAnimateLoraNode(workflow, ANIMATE_PP_NODE.LORA_LOW, loraLow);
    this.setUnetNode(workflow, ANIMATE_PP_NODE.MODEL_HIGH, options.modelHigh);
    this.setUnetNode(workflow, ANIMATE_PP_NODE.MODEL_LOW, options.modelLow);

    const promptId = await this.submitWorkflow(workflow);
    animatePromptIds.add(promptId);
    this.registerGeneration(promptId, ANIMATE_PP_NODE.OUTPUT, statusCallback);
    return { promptId, seed: finalSeed };
  }
}

module.exports = new ComfyService();
