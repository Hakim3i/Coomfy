/* API client: all backend communication for sprites, config, videos */

const API = '/api/sprites';
const CONFIG_API = '/api/config';
const VIDEOS_API = '/api/videos';
const MODELS_API = '/api/models';

const FALLBACK_CONFIG = {
  defaultBackgroundColor: '#000000',
  defaultGender: 'female',
  defaultSize: 'large',
  sizeLabels: { small: '640 × 1024', medium: '704 × 1152', large: '768 × 1280' },
  sizeLabelLandscape: { small: '1024 × 640', medium: '1152 × 704', large: '1280 × 768' },
};

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function request(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

export async function getConfig() {
  try {
    const { ok, data } = await request(CONFIG_API);
    return ok ? data : FALLBACK_CONFIG;
  } catch {
    return FALLBACK_CONFIG;
  }
}

export async function putConfig(payload) {
  const { ok, data } = await request(CONFIG_API, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(payload) });
  if (!ok) throw new Error(data?.error || 'Failed to save config');
  return data;
}

export async function getModels({ refresh = false } = {}) {
  try {
    const url = refresh ? `${MODELS_API}?refresh=1` : MODELS_API;
    const { ok, data } = await request(url);
    return ok ? data : { checkpoints: [], diffusionModels: [], loras: [] };
  } catch {
    return { checkpoints: [], diffusionModels: [], loras: [] };
  }
}

export async function getSprites() {
  const { ok, data } = await request(API);
  return ok ? data : [];
}

export async function createSprite(data) {
  const { ok, data: body } = await request(API, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(data) });
  if (!ok) throw new Error('Failed to create');
  return body;
}

export async function deleteSprite(id) {
  const { ok } = await request(`${API}/${id}`, { method: 'DELETE' });
  if (!ok) throw new Error('Failed to delete');
}

export async function makeSprite(data) {
  const { ok, data: body } = await request(`${API}/make`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(data) });
  if (!ok) throw new Error('Failed to make');
  return body;
}

export async function getGenerationStatus(promptId) {
  const { ok, data } = await request(`${API}/status/${promptId}`);
  return ok ? data : null;
}

export async function exportRmbg(frames, backgroundColor) {
  const { ok, data: body } = await request('/api/export/rmbg', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ frames, backgroundColor }) });
  if (!ok) throw new Error(body?.error || 'RMBG export failed');
  return body;
}

export async function animateRmbgVideo(videoUrl, backgroundColor) {
  const { ok, data: body } = await request('/api/animate/rmbg-video', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ videoUrl, backgroundColor }) });
  if (!ok) throw new Error(body?.error || 'RMBG video failed');
  return body;
}

export async function updateSprite(id, data) {
  const { ok, data: body } = await request(`${API}/${id}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(data) });
  if (!ok) throw new Error('Failed to update');
  return body;
}

export async function flipSprite(id) {
  const { ok, data } = await request(`${API}/${id}/flip`, { method: 'POST' });
  if (!ok) throw new Error('Failed to flip image');
  return data;
}

export async function flipImage(imageUrl) {
  const { ok, data } = await request('/api/image/flip', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ imageUrl }) });
  if (!ok) throw new Error('Failed to flip image');
  return data;
}

export async function panImage(imageUrl, panX, panY, backgroundColor, zoom) {
  const { ok, data } = await request('/api/image/pan', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ imageUrl, panX, panY, backgroundColor, zoom }) });
  if (!ok) throw new Error('Failed to pan image');
  return data;
}

export async function removeBackground(imageUrl, backgroundColor) {
  const { ok, data: body } = await request('/api/image/remove-background', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ imageUrl, backgroundColor }) });
  if (!ok) throw new Error(body?.error || 'Failed to remove background');
  return body;
}

export async function uploadEditedImage(imageDataUrl) {
  const { ok, data: body } = await request('/api/image/upload-edited', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ imageData: imageDataUrl }) });
  if (!ok) throw new Error(body?.error || 'Failed to upload edited image');
  return body;
}

export async function generateEdit(spriteId, data) {
  const { ok, data: body } = await request(`${API}/${spriteId}/edits/generate`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(data) });
  if (!ok) throw new Error('Failed to generate edit');
  return body;
}

export async function addEdit(spriteId, data) {
  const { ok, data: body } = await request(`${API}/${spriteId}/edits`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(data) });
  if (!ok) throw new Error('Failed to save edit');
  return body;
}

export async function updateEdit(spriteId, editId, data) {
  const { ok, data: body } = await request(`${API}/${spriteId}/edits/${editId}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(data) });
  if (!ok) throw new Error('Failed to update edit');
  return body;
}

export async function deleteEdit(spriteId, editId) {
  const { ok } = await request(`${API}/${spriteId}/edits/${editId}`, { method: 'DELETE' });
  if (!ok) throw new Error('Failed to delete edit');
}

export async function generateAnimate(spriteId, data) {
  const { ok, data: body } = await request(`${API}/${spriteId}/animate/generate`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(data) });
  if (!ok) throw new Error(body?.error || 'Failed to generate animation');
  return body;
}

export async function getSavedVideos() {
  const { ok, data } = await request(VIDEOS_API);
  return ok ? data : [];
}

export async function saveVideo(payload) {
  const { ok, data: body } = await request(`${VIDEOS_API}/save`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload) });
  if (!ok) throw new Error(body?.error || 'Failed to save video');
  return body;
}

export async function deleteVideo(id) {
  const { ok, data } = await request(`${VIDEOS_API}/${id}`, { method: 'DELETE' });
  if (!ok) throw new Error(data?.error || 'Failed to delete video');
}
