const http = require('http');
const config = require('../config');

/**
 * Discovers models and LoRAs by querying ComfyUI's /object_info/{NodeName} endpoints.
 * Combo (dropdown) inputs expose the actual filenames as `input.required.<field>[0]`,
 * so this reflects whatever is installed on the ComfyUI host, no hardcoding needed.
 */

const CACHE_TTL_MS = 30 * 1000;

let cache = null;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data || '{}')); }
        catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error(`Timed out fetching ${url}`)));
  });
}

/** Safely reads `input.required.<field>[0]` (the combo list). Returns [] on any shape mismatch. */
function extractComboList(objectInfo, nodeName, fieldName) {
  const entry = objectInfo?.[nodeName]?.input?.required?.[fieldName];
  if (!Array.isArray(entry) || !Array.isArray(entry[0])) return [];
  return entry[0].filter((v) => typeof v === 'string');
}

async function fetchNodeInfo(nodeName) {
  const url = `${config.COMFY_URL}/object_info/${nodeName}`;
  try {
    const body = await fetchJson(url);
    return body || {};
  } catch (err) {
    console.warn(`[modelDiscovery] Failed to fetch ${nodeName}:`, err.message);
    return {};
  }
}

async function discoverModels() {
  const [ckptInfo, unetInfo, loraInfo] = await Promise.all([
    fetchNodeInfo('CheckpointLoaderSimple'),
    fetchNodeInfo('UNETLoader'),
    fetchNodeInfo('LoraLoader'),
  ]);

  return {
    checkpoints: extractComboList(ckptInfo, 'CheckpointLoaderSimple', 'ckpt_name'),
    diffusionModels: extractComboList(unetInfo, 'UNETLoader', 'unet_name'),
    loras: extractComboList(loraInfo, 'LoraLoader', 'lora_name'),
    comfyUrl: config.COMFY_URL,
    fetchedAt: new Date().toISOString(),
  };
}

async function getModels({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache && now - cache.ts < CACHE_TTL_MS) {
    return cache.data;
  }
  const data = await discoverModels();
  cache = { ts: now, data };
  return data;
}

function clearCache() { cache = null; }

module.exports = { getModels, clearCache };
