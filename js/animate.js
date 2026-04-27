/* Animate tab: video generation from character images with frame/LoRA settings */

import { getSprites, generateAnimate, getGenerationStatus, saveVideo } from './api.js';
import { escapeHtml, syncLayout, isLandscape } from './ui.js';
import { randomSeed } from './utils.js';

const ANIMATE_LIST_ID = 'animate-list';
const ANIMATE_DETAIL_ID = 'animate-detail-view';
const POLL_INTERVAL_MS = 2000;
const DEFAULT_FRAMES = 81;
const DEFAULT_FPS = 16;
const FRAME_NORMAL = { min: 17, max: 113, step: 16, default: 81 };
const FRAME_PINGPONG = { min: 34, max: 204, step: 34, default: 68 };
const PLACEHOLDER_PORTRAIT = '768 × 1280';
const PLACEHOLDER_LANDSCAPE = '1280 × 768';

let animateSpriteId = null;
let currentSprite = null;
let firstFrameImageUrl = null;
let lastFrameImageUrl = null;
let currentPromptId = null;
let pollTimer = null;
let currentVideoForSave = null;

function getPlaceholderText(orientation) {
  return isLandscape(orientation) ? PLACEHOLDER_LANDSCAPE : PLACEHOLDER_PORTRAIT;
}

function updateLayoutForAnimate(orientation) {
  const layoutEl = document.querySelector('.animate-layout');
  syncLayout(layoutEl, orientation);
}

function listEl() { return document.getElementById(ANIMATE_LIST_ID); }
function detailEl() { return document.getElementById(ANIMATE_DETAIL_ID); }
function previewPlaceholderEl() { return document.getElementById('animate-preview-placeholder'); }

function showList() {
  if (listEl()) listEl().classList.remove('hidden');
  if (detailEl()) detailEl().classList.add('hidden');
  animateSpriteId = null; firstFrameImageUrl = null; lastFrameImageUrl = null;
  updateLayoutForAnimate('portrait');
  stopPolling();
}

function showDetail(sprite) {
  animateSpriteId = sprite.id;
  currentSprite = sprite;
  if (listEl()) listEl().classList.add('hidden');
  if (detailEl()) detailEl().classList.remove('hidden');
  const titleEl = document.getElementById('animate-panel-title');
  if (titleEl) titleEl.textContent = sprite.name || 'Character';
  firstFrameImageUrl = null; lastFrameImageUrl = null;
  const sameCheckbox = document.getElementById('animate-same-first-last');
  if (sameCheckbox) sameCheckbox.checked = false;
  const pingPongCheckbox = document.getElementById('animate-ping-pong');
  if (pingPongCheckbox) pingPongCheckbox.checked = false;
  applyFrameRange(false);
  updateLayoutForAnimate(sprite.orientation);
  renderImagePicker(sprite);
  updateGenerateButton();
  resetForm();
  hideOutput();
  currentVideoForSave = null;
  updateSaveVideoButton();
}

function resetForm() {
  const nameEl = document.getElementById('animate-name');
  const prompt = document.getElementById('animate-prompt');
  const length = document.getElementById('animate-length');
  const lengthValue = document.getElementById('animate-length-value');
  const seed = document.getElementById('animate-seed');
  const pingPong = document.getElementById('animate-ping-pong')?.checked;
  if (nameEl) nameEl.value = '';
  if (prompt) prompt.value = '';
  const range = pingPong ? FRAME_PINGPONG : FRAME_NORMAL;
  if (length) {
    length.min = range.min; length.max = range.max; length.step = range.step; length.value = String(range.default);
    if (lengthValue) lengthValue.textContent = range.default;
  }
  if (seed) seed.value = String(randomSeed());
  const fpsEl = document.getElementById('animate-fps');
  if (fpsEl) fpsEl.value = String(DEFAULT_FPS);
}

function applyFrameRange(pingPong) {
  const lengthSlider = document.getElementById('animate-length');
  const lengthValue = document.getElementById('animate-length-value');
  if (!lengthSlider || !lengthValue) return;
  const range = pingPong ? FRAME_PINGPONG : FRAME_NORMAL;
  lengthSlider.min = range.min; lengthSlider.max = range.max; lengthSlider.step = range.step;
  let v = parseInt(lengthSlider.value, 10);
  if (v < range.min || v > range.max) v = range.default;
  else v = Math.round((v - range.min) / range.step) * range.step + range.min;
  v = Math.max(range.min, Math.min(range.max, v));
  lengthSlider.value = String(v);
  lengthValue.textContent = String(v);
}

function setPreviewPlaceholder(content) {
  const el = previewPlaceholderEl();
  if (el) el.innerHTML = content;
}

function hideOutput() {
  const placeholderText = getPlaceholderText(currentSprite?.orientation);
  setPreviewPlaceholder(`<span>${placeholderText}</span>`);
  currentPromptId = null; currentVideoForSave = null;
  updateSaveVideoButton();
  stopPolling();
}

function updateSaveVideoButton() {
  const btn = document.getElementById('animate-save-video-btn');
  if (btn) btn.disabled = !currentVideoForSave;
}

function updateGenerateButton() {
  const btn = document.getElementById('animate-generate-btn');
  if (btn) btn.disabled = !firstFrameImageUrl;
}

function renderImagePicker(sprite) {
  const container = document.getElementById('animate-image-picker');
  if (!container) return;
  const mainUrl = sprite.imageUrl;
  const edits = sprite.edits || [];
  const items = [{ url: mainUrl, label: 'Main', isMain: true }, ...edits.map(e => ({ url: e.imageUrl, label: e.name || 'Edit', isMain: false }))].filter(i => i.url);
  const landscapeClass = isLandscape(sprite.orientation) ? 'orientation-landscape' : '';
  container.innerHTML = items.map(item => {
    const isFirst = firstFrameImageUrl === item.url;
    const isLast = lastFrameImageUrl === item.url;
    const classes = ['animate-pick-card', landscapeClass, isFirst ? 'selected-first' : '', isLast ? 'selected-last' : ''].filter(Boolean).join(' ');
    return `
  <button type="button" class="${classes}" data-url="${escapeHtml(item.url)}" data-is-main="${item.isMain}">
    <div class="animate-pick-image">${item.url ? `<img src="${item.url}?t=${Date.now()}" alt="${escapeHtml(item.label)}" loading="lazy">` : '<div class="empty-image">No Image</div>'}</div>
    <span class="animate-pick-label">${escapeHtml(item.label)}</span>
  </button>`;
  }).join('');

  const sameFirstLastCheckbox = document.getElementById('animate-same-first-last');
  container.querySelectorAll('.animate-pick-card').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.url || null;
      if (!url) return;
      const sameFirstLast = sameFirstLastCheckbox?.checked;
      if (sameFirstLast) {
        if (url === firstFrameImageUrl) firstFrameImageUrl = null;
        else { firstFrameImageUrl = url; lastFrameImageUrl = null; }
      } else {
        if (url === firstFrameImageUrl) { firstFrameImageUrl = null; if (url === lastFrameImageUrl) lastFrameImageUrl = null; }
        else if (url === lastFrameImageUrl) { lastFrameImageUrl = null; }
        else if (!firstFrameImageUrl) { firstFrameImageUrl = url; }
        else { lastFrameImageUrl = url; }
      }
      renderImagePicker(sprite);
      updateGenerateButton();
    });
  });
}

export async function renderAnimateList() {
  const container = listEl();
  if (!container) return;
  let list;
  try { list = await getSprites(); } catch { container.innerHTML = '<p class="empty-state">Could not load characters.</p>'; return; }
  if (list.length === 0) { container.innerHTML = '<p class="empty-state">No characters yet. Create one in the Make tab.</p>'; return; }
  container.innerHTML = list.map(char => {
    const landscapeClass = isLandscape(char.orientation) ? ' orientation-landscape' : '';
    return `
  <article class="card clickable-card animate-sprite-card${landscapeClass}" data-sprite-id="${char.id}">
    <div class="card-image">${char.imageUrl ? `<img src="${char.imageUrl}?t=${Date.now()}" alt="${escapeHtml(char.name)}" loading="lazy">` : '<div class="empty-image">No Image</div>'}</div>
    <div class="card-overlay-bottom"><h3 class="card-name">${escapeHtml(char.name || 'Character')}</h3></div>
  </article>`;
  }).join('');

  container.querySelectorAll('.animate-sprite-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.spriteId;
      const char = list.find(c => c.id === id);
      if (char) showDetail(char);
    });
  });
}

function stopPolling() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
}

function pollStatus(promptId) {
  stopPolling();
  const tick = async () => {
    const status = await getGenerationStatus(promptId);
    if (!status) { stopPolling(); return; }
    if (status.type === 'complete') {
      stopPolling();
      if (status.videos && status.videos.length > 0) {
        const url = status.videos[0];
        setPreviewPlaceholder(`<video class="animate-video" controls autoplay loop muted playsinline src="${escapeHtml(url)}">Your browser does not support the video tag.</video>`);
        const lengthEl = document.getElementById('animate-length');
        const frames = lengthEl ? parseInt(lengthEl.value, 10) : DEFAULT_FRAMES;
        const fpsEl = document.getElementById('animate-fps');
        const fps = fpsEl ? parseInt(fpsEl.value, 10) : DEFAULT_FPS;
        const nameEl = document.getElementById('animate-name');
        currentVideoForSave = {
          videoUrl: url,
          spriteId: animateSpriteId,
          spriteName: currentSprite?.name || '',
          name: nameEl?.value?.trim() || '',
          prompt: document.getElementById('animate-prompt')?.value?.trim() || '',
          fps: Number.isFinite(fps) ? fps : DEFAULT_FPS,
          frames: Number.isFinite(frames) ? frames : DEFAULT_FRAMES,
        };
        updateSaveVideoButton();
      } else {
        setPreviewPlaceholder(`<span>${getPlaceholderText(currentSprite?.orientation)}</span>`);
        currentVideoForSave = null;
        updateSaveVideoButton();
      }
      return;
    }
    const nodeText = status.node ? `Executing node ${status.node}...` : (status.type === 'queued' ? 'Queueing...' : 'Generating...');
    const placeholder = previewPlaceholderEl();
    if (placeholder?.querySelector('.spinner')) {
      const span = placeholder.querySelector('span');
      if (span) span.textContent = nodeText;
    } else {
      setPreviewPlaceholder(`<div class="spinner"></div><span>${escapeHtml(nodeText)}</span>`);
    }
    pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
  };
  tick();
}

async function handleAnimateSubmit(e) {
  e.preventDefault();
  if (!animateSpriteId || !firstFrameImageUrl) { alert('Select at least one image (first frame). Optionally select a second image as last frame.'); return; }
  const prompt = document.getElementById('animate-prompt')?.value?.trim() || '';
  const pingPong = document.getElementById('animate-ping-pong')?.checked;
  const lengthEl = document.getElementById('animate-length');
  let length = lengthEl ? parseInt(lengthEl.value, 10) : DEFAULT_FRAMES;
  const range = pingPong ? FRAME_PINGPONG : FRAME_NORMAL;
  if (!Number.isFinite(length) || length < range.min || length > range.max) length = range.default;
  const seed = document.getElementById('animate-seed')?.value?.trim();
  const seedNum = seed ? parseInt(seed, 10) : randomSeed();
  const fpsEl = document.getElementById('animate-fps');
  let fps = fpsEl ? parseInt(fpsEl.value, 10) : DEFAULT_FPS;
  if (!Number.isFinite(fps) || fps < 1 || fps > 60) fps = DEFAULT_FPS;
  const btn = document.getElementById('animate-generate-btn');
  if (btn) btn.disabled = true;
  const sameFirstLast = document.getElementById('animate-same-first-last')?.checked;
  const loraHigh = document.getElementById('animate-lora-high')?.value ?? '';
  const loraLow = document.getElementById('animate-lora-low')?.value ?? '';
  const modelHigh = document.getElementById('animate-model-high')?.value?.trim() || '';
  const modelLow = document.getElementById('animate-model-low')?.value?.trim() || '';
  const payload = { imageUrl: firstFrameImageUrl, prompt, length, fps, seed: seedNum, loraHigh: loraHigh || '', loraLow: loraLow || '', modelHigh, modelLow };
  if (sameFirstLast && firstFrameImageUrl) payload.imageUrlLastFrame = firstFrameImageUrl;
  else if (lastFrameImageUrl) payload.imageUrlLastFrame = lastFrameImageUrl;
  if (pingPong) { payload.pingPong = true; if (!payload.imageUrlLastFrame && firstFrameImageUrl) payload.imageUrlLastFrame = firstFrameImageUrl; }
  try {
    currentVideoForSave = null;
    updateSaveVideoButton();
    const { promptId } = await generateAnimate(animateSpriteId, payload);
    currentPromptId = promptId;
    setPreviewPlaceholder('<div class="spinner"></div><span>Queueing...</span>');
    pollStatus(promptId);
  } catch (err) {
    alert(err.message || 'Failed to start animation');
    setPreviewPlaceholder(`<span>${getPlaceholderText(currentSprite?.orientation)}</span>`);
  } finally {
    if (btn) btn.disabled = false;
  }
}


export function setupAnimateTab() {
  const backBtn = document.getElementById('animate-back');
  if (backBtn) backBtn.addEventListener('click', () => { showList(); renderAnimateList(); });

  const form = document.getElementById('animate-form');
  if (form) form.addEventListener('submit', handleAnimateSubmit);

  const lengthSlider = document.getElementById('animate-length');
  const lengthValue = document.getElementById('animate-length-value');
  if (lengthSlider && lengthValue) lengthSlider.addEventListener('input', () => { lengthValue.textContent = lengthSlider.value; });

  const randomSeedBtn = document.getElementById('animate-random-seed');
  if (randomSeedBtn) randomSeedBtn.addEventListener('click', () => { const seedInput = document.getElementById('animate-seed'); if (seedInput) seedInput.value = String(randomSeed()); });

  const sameFirstLastCheckbox = document.getElementById('animate-same-first-last');
  if (sameFirstLastCheckbox) {
    sameFirstLastCheckbox.addEventListener('change', () => {
      if (sameFirstLastCheckbox.checked) {
        lastFrameImageUrl = null;
        if (currentSprite) { renderImagePicker(currentSprite); updateGenerateButton(); }
      }
    });
  }

  const pingPongCheckbox = document.getElementById('animate-ping-pong');
  if (pingPongCheckbox) pingPongCheckbox.addEventListener('change', () => applyFrameRange(pingPongCheckbox.checked));

  const saveVideoBtn = document.getElementById('animate-save-video-btn');
  if (saveVideoBtn) {
    saveVideoBtn.addEventListener('click', async () => {
      if (!currentVideoForSave) return;
      saveVideoBtn.disabled = true;
      try { await saveVideo(currentVideoForSave); alert('Video saved.'); }
      catch (err) { alert(err.message || 'Failed to save video'); }
      finally { saveVideoBtn.disabled = false; }
    });
  }

  const animateTab = document.querySelector('.tab[data-tab="animate"]');
  if (animateTab) animateTab.addEventListener('click', () => { showList(); renderAnimateList(); });
}
