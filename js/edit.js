/* Edit tab: character editing full-page panel with transforms, filters, source overlay, and RMBG */

import { getSprites, generateEdit, addEdit, updateEdit, updateSprite, deleteEdit, getGenerationStatus, removeBackground, uploadEditedImage } from './api.js';
import { escapeHtml, syncLayout } from './ui.js';
import { randomSeed } from './utils.js';

const EDIT_LIST_ID = 'edit-rows';
const EDIT_DETAIL_ID = 'edit-detail-view';

function showEditPanel() {
  const list = document.getElementById(EDIT_LIST_ID);
  const detail = document.getElementById(EDIT_DETAIL_ID);
  if (list) list.classList.add('hidden');
  if (detail) detail.classList.remove('hidden');
}

function hideEditPanel() {
  const list = document.getElementById(EDIT_LIST_ID);
  const detail = document.getElementById(EDIT_DETAIL_ID);
  if (list) list.classList.remove('hidden');
  if (detail) detail.classList.add('hidden');
}

const POLL_INTERVAL_MS = 1500;

let editSpriteId = null;
let currentEditId = null;
let isEditingMainCard = false;
let lastEditImageUrl = null;
let lastEditSeed = null;
let currentEditPromptId = null;
let preRmbgImageUrl = null;
let panOffset = { x: 0, y: 0 };
let isPanning = false;
let panStart = { panX: 0, panY: 0, clientX: 0, clientY: 0 };
let zoomLevel = 1.0;
let imageEdits = { flipX: false, flipY: false, rotation: 0, brightness: 0, contrast: 0, saturation: 0, hue: 0 };
let currentSprite = null;

function updateLayoutForEdit(orientation) {
  const layoutEl = document.querySelector('.edit-layout');
  syncLayout(layoutEl, orientation);
}

function editPreviewImgHtml(url, withBadge = false) {
  const wrap = `<div class="edit-pan-zoom-wrap"><img src="${url}" style="width:100%;height:100%;object-fit:cover;"></div>`;
  return withBadge ? `<div class="preview-ready">${wrap}<div class="ready-badge">READY</div></div>` : `<div class="preview-ready">${wrap}</div>`;
}

export async function renderEditRows() {
  const container = document.getElementById('edit-rows');
  if (!container) return;
  let list;
  try { list = await getSprites(); } catch { container.innerHTML = '<p class="empty-state">Could not load characters.</p>'; return; }
  if (list.length === 0) { container.innerHTML = '<p class="empty-state">No characters yet. Create one in the Make tab.</p>'; return; }
  container.innerHTML = list.map(char => {
    const landscapeClass = char.orientation === 'landscape' ? ' orientation-landscape' : '';
    return `
  <div class="edit-row" data-sprite-id="${char.id}">
    <div class="edit-row-cards${landscapeClass}">
      <article class="card edit-main-card clickable-card" data-sprite-id="${char.id}" data-is-main="true">
        <div class="card-image">${char.imageUrl ? `<img src="${char.imageUrl}?t=${Date.now()}" alt="${escapeHtml(char.name)}" loading="lazy">` : '<div class="empty-image">No Image</div>'}</div>
        <div class="card-overlay-bottom"><h3 class="card-name">${escapeHtml(char.name || 'Character')}</h3></div>
      </article>
      ${(char.edits || []).map(e => `
        <article class="card edit-card clickable-card" data-sprite-id="${char.id}" data-edit-id="${e.id}">
          <div class="card-image">${e.imageUrl ? `<img src="${e.imageUrl}?t=${Date.now()}" alt="${escapeHtml(e.name)}" loading="lazy">` : '<div class="empty-image">No Image</div>'}</div>
          <div class="card-overlay-bottom"><h3 class="card-name">${escapeHtml(e.name || 'Edit')}</h3></div>
          <button type="button" class="btn-icon-small delete-edit" data-sprite-id="${char.id}" data-edit-id="${e.id}" aria-label="Delete edit">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
          </button>
        </article>`).join('')}
      <article class="add-card edit-add-card" data-sprite-id="${char.id}">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        <span>New edit</span>
      </article>
    </div>
  </div>`;
  }).join('');

  container.onclick = async e => {
    const addCard = e.target.closest('.edit-add-card');
    if (addCard) { const id = addCard.dataset.spriteId; const char = list.find(c => c.id === id); if (char) openNewEditModal(char); return; }
    const mainCard = e.target.closest('.edit-main-card');
    if (mainCard) { const id = mainCard.dataset.spriteId; const char = list.find(c => c.id === id); if (char) openEditMainModal(char); return; }
    const editCard = e.target.closest('.edit-card');
    if (editCard && !e.target.closest('.delete-edit')) { const cid = editCard.dataset.spriteId; const eid = editCard.dataset.editId; const char = list.find(c => c.id === cid); const edit = char?.edits?.find(x => x.id === eid); if (char && edit) openEditExistingModal(char, edit); return; }
    const delBtn = e.target.closest('.delete-edit');
    if (delBtn) { e.stopPropagation(); const cid = delBtn.dataset.spriteId; const eid = delBtn.dataset.editId; if (!confirm('Delete this edit?')) return; try { await deleteEdit(cid, eid); await renderEditRows(); } catch { alert('Failed to delete edit'); } }
  };
}

function setEditModalState({ spriteId, sprite, editingEditId, mainCard, name, prompt, seed, previewHtml, saveDisabled }) {
  editSpriteId = spriteId;
  currentEditId = editingEditId ?? null;
  isEditingMainCard = mainCard ?? false;
  lastEditSeed = seed ?? randomSeed();
  currentEditPromptId = null;
  currentSprite = sprite;
  document.getElementById('edit-sprite-id').value = spriteId || '';
  const editIdInput = document.getElementById('edit-edit-id');
  if (editIdInput) editIdInput.value = editingEditId != null ? String(editingEditId) : '';
  const originalNameInput = document.getElementById('edit-original-name');
  if (originalNameInput) originalNameInput.value = editingEditId != null && name != null ? String(name) : '';
  document.getElementById('edit-name').value = name ?? '';
  document.getElementById('edit-prompt').value = prompt ?? '';
  document.getElementById('edit-seed').value = String(seed ?? randomSeed());
  document.getElementById('edit-preview-placeholder').innerHTML = previewHtml ?? '<span>Preview</span>';
  const saveBtn = document.getElementById('edit-save-btn');
  if (saveBtn) saveBtn.disabled = saveDisabled !== false;
  const nameRow = document.getElementById('edit-form')?.querySelector('.edit-name-row');
  if (nameRow) nameRow.style.display = mainCard ? 'none' : '';
  const titleEl = document.getElementById('edit-panel-title');
  if (titleEl) titleEl.textContent = mainCard ? 'Edit Character' : (editingEditId ? 'Edit edit' : 'New edit');
  const edit = sprite?.edits?.find(e => e.id === editingEditId);
  const sourceOpts = mainCard ? { sourceImageUrl: sprite?.imageUrl } : editingEditId ? { sourceImageUrl: edit?.sourceImageUrl || edit?.imageUrl || sprite?.imageUrl } : {};
  populateEditSourceDropdown(sprite, sourceOpts, mainCard);
  const overlaySlider = document.getElementById('edit-overlay-slider');
  const overlayValue = document.getElementById('edit-overlay-value');
  if (overlaySlider) { overlaySlider.value = '0'; if (overlayValue) overlayValue.textContent = '0'; }
  const panToggleEl = document.getElementById('edit-pan-toggle');
  if (panToggleEl) panToggleEl.classList.remove('active');
}

function populateEditSourceDropdown(sprite, options = {}, mainCard) {
  const select = document.getElementById('edit-source-image');
  if (!select) return;
  const { sourceImageUrl } = options;
  const edits = sprite?.edits || [];
  select.innerHTML = '';
  const mainUrl = sprite?.imageUrl;
  if (mainUrl) {
    const opt = document.createElement('option');
    opt.value = mainUrl.startsWith('/') ? mainUrl : '/' + mainUrl;
    opt.textContent = sprite?.name || 'Character';
    select.appendChild(opt);
  }
  edits.forEach(e => {
    if (!e.imageUrl) return;
    const url = e.imageUrl.startsWith('/') ? e.imageUrl : '/' + e.imageUrl;
    const opt = document.createElement('option');
    opt.value = url;
    opt.textContent = e.name || 'Edit';
    select.appendChild(opt);
  });
  let valueToSet = sourceImageUrl != null ? (sourceImageUrl.startsWith('/') ? sourceImageUrl : '/' + sourceImageUrl) : (mainUrl ? (mainUrl.startsWith('/') ? mainUrl : '/' + mainUrl) : '');
  if (valueToSet && !Array.from(select.options).some(o => o.value === valueToSet)) {
    const opt = document.createElement('option');
    opt.value = valueToSet;
    opt.textContent = 'Source';
    select.appendChild(opt);
  }
  select.value = valueToSet || (select.options[0]?.value ?? '');
}

function setEditModalBackgroundColor(hexColor) {
  const isTransparent = hexColor === 'transparent';
  const c = hexColor && /^#[0-9A-Fa-f]{6}$/.test(hexColor) ? hexColor : '#000000';
  const input = document.getElementById('edit-background-color');
  const valueEl = document.getElementById('edit-background-color-value');
  const colorContainer = input?.closest('.color-picker-container');
  const transparentRadio = document.querySelector('input[name="edit-bg"][value="transparent"]');
  const solidRadio = document.querySelector('input[name="edit-bg"][value="solid"]');
  if (isTransparent) {
    if (transparentRadio) transparentRadio.checked = true;
    if (solidRadio) solidRadio.checked = false;
    if (input) input.disabled = true;
    if (colorContainer) colorContainer.style.opacity = '0.5';
  } else {
    if (solidRadio) solidRadio.checked = true;
    if (transparentRadio) transparentRadio.checked = false;
    if (input) { input.disabled = false; input.value = c; }
    if (valueEl) valueEl.textContent = c.toUpperCase();
    if (colorContainer) colorContainer.style.opacity = '1';
  }
}

function openNewEditModal(char) {
  setEditModalState({ spriteId: char.id, sprite: char, editingEditId: null, mainCard: false, name: '', prompt: '', seed: randomSeed(), previewHtml: '<span>Preview</span>', saveDisabled: true });
  setEditModalBackgroundColor(char.backgroundColor);
  updateLayoutForEdit(char.orientation);
  preRmbgImageUrl = null;
  resetImageEdits();
  document.getElementById('edit-generate-btn').disabled = false;
  showEditPanel();
  setTimeout(() => { updateSourceOverlay(); updatePreviewBackground(); }, 50);
}

function openEditMainModal(char) {
  setEditModalState({ spriteId: char.id, sprite: char, editingEditId: null, mainCard: true, name: '', prompt: '', seed: randomSeed(), previewHtml: char.imageUrl ? editPreviewImgHtml(`${char.imageUrl}?t=${Date.now()}`) : '<span>No image</span>', saveDisabled: false });
  lastEditImageUrl = char.imageUrl || null;
  setEditModalBackgroundColor(char.backgroundColor);
  updateLayoutForEdit(char.orientation);
  preRmbgImageUrl = null;
  resetImageEdits();
  document.getElementById('edit-generate-btn').disabled = false;
  showEditPanel();
  setTimeout(() => { updateSourceOverlay(); updatePreviewBackground(); }, 50);
}

function openEditExistingModal(char, edit) {
  setEditModalState({ spriteId: char.id, sprite: char, editingEditId: edit.id, mainCard: false, name: edit.name ?? '', prompt: edit.prompt ?? '', seed: edit.seed ?? randomSeed(), previewHtml: edit.imageUrl ? editPreviewImgHtml(`${edit.imageUrl}?t=${Date.now()}`) : '<span>Preview</span>', saveDisabled: false });
  lastEditImageUrl = edit.imageUrl || null;
  setEditModalBackgroundColor(char.backgroundColor);
  updateLayoutForEdit(char.orientation);
  preRmbgImageUrl = null;
  resetImageEdits();
  const modelSel = document.getElementById('edit-model');
  const loraSel = document.getElementById('edit-lora');
  if (modelSel && edit.model) modelSel.value = edit.model;
  if (loraSel && edit.lora) loraSel.value = edit.lora;
  document.getElementById('edit-generate-btn').disabled = false;
  showEditPanel();
  setTimeout(() => { updateSourceOverlay(); updatePreviewBackground(); }, 50);
}

export function closeEditModal() {
  editSpriteId = null; currentEditId = null; isEditingMainCard = false; lastEditImageUrl = null; lastEditSeed = null; currentEditPromptId = null; preRmbgImageUrl = null; currentSprite = null;
  resetImageEdits();
  updateLayoutForEdit('portrait');
  const editIdInput = document.getElementById('edit-edit-id'); if (editIdInput) editIdInput.value = '';
  const originalNameInput = document.getElementById('edit-original-name'); if (originalNameInput) originalNameInput.value = '';
  const nameRow = document.getElementById('edit-form')?.querySelector('.edit-name-row'); if (nameRow) nameRow.style.display = '';
  hideEditPanel();
}

export async function handleEditGenerate() {
  const spriteId = document.getElementById('edit-sprite-id').value;
  const editName = document.getElementById('edit-name').value?.trim();
  const prompt = document.getElementById('edit-prompt').value?.trim() || '';
  const seedInput = document.getElementById('edit-seed');
  const seed = seedInput.value === '' || isNaN(Number(seedInput.value)) ? randomSeed() : Number(seedInput.value);
  const preview = document.getElementById('edit-preview-placeholder');
  const genBtn = document.getElementById('edit-generate-btn');
  const saveBtn = document.getElementById('edit-save-btn');
  if (!isEditingMainCard && !editName) { alert('Enter an edit name'); return; }
  const sourceSelect = document.getElementById('edit-source-image');
  const imageUrl = sourceSelect?.value?.trim() || null;
  if (!imageUrl && !isEditingMainCard) { alert('Select a source image'); return; }
  const loraSelect = document.getElementById('edit-lora');
  const lora = loraSelect?.value?.trim() || '';
  const modelSelect = document.getElementById('edit-model');
  const model = modelSelect?.value?.trim() || '';
  try {
    genBtn.disabled = true; saveBtn.disabled = true;
    preview.innerHTML = '<div class="spinner"></div><span>Queueing...</span>';
    const { promptId } = await generateEdit(spriteId, { editName: isEditingMainCard ? 'Character' : editName, prompt, seed, imageUrl: imageUrl || undefined, lora: lora || undefined, model: model || undefined, type: 'human' });
    currentEditPromptId = promptId;
    pollEditStatus(promptId, preview, (imageUrl, seedUsed) => { lastEditImageUrl = imageUrl; lastEditSeed = seedUsed ?? lastEditSeed; resetImageEdits(); genBtn.disabled = false; saveBtn.disabled = false; });
  } catch (err) { alert('Generation failed: ' + err.message); genBtn.disabled = false; preview.innerHTML = '<span>Error</span>'; }
}

async function pollEditStatus(promptId, previewArea, onComplete) {
  const interval = setInterval(async () => {
    if (currentEditPromptId !== promptId) { clearInterval(interval); return; }
    try {
      const status = await getGenerationStatus(promptId);
      if (!status) return;
      const nodeText = status.node ? `Node ${status.node}...` : 'Queueing...';
      if (status.type === 'progress' || status.type === 'queued') {
        const img = status.images?.length ? status.images[status.images.length - 1] : null;
        const overlay = previewArea.querySelector('.poll-overlay');
        const spinner = previewArea.querySelector('.spinner');
        if (img && overlay) { const imgEl = previewArea.querySelector('img'); if (imgEl) imgEl.src = img; const span = overlay.querySelector('span'); if (span) span.textContent = nodeText; }
        else if (img) previewArea.innerHTML = `<div class="edit-pan-zoom-wrap"><img src="${img}" style="width:100%;height:100%;object-fit:cover;opacity:0.6;"></div><div class="poll-overlay"><div class="spinner"></div><span>${nodeText}</span></div>`;
        else if (spinner) { const span = previewArea.querySelector('span'); if (span) span.textContent = nodeText; }
        else previewArea.innerHTML = `<div class="spinner"></div><span>${nodeText}</span>`;
      }
      if (status.type === 'complete') {
        clearInterval(interval);
        const img = status.images?.[status.images.length - 1];
        previewArea.innerHTML = img ? editPreviewImgHtml(img, true) : '<span>Done</span>';
        onComplete(img, status.seed);
        updateSourceOverlay();
      }
    } catch { clearInterval(interval); previewArea.innerHTML = '<span>Error</span>'; }
  }, POLL_INTERVAL_MS);
}

export async function handleEditSave() {
  const spriteId = document.getElementById('edit-sprite-id').value;
  const editName = document.getElementById('edit-name').value?.trim();
  const prompt = document.getElementById('edit-prompt').value?.trim() || '';
  const seedInput = document.getElementById('edit-seed');
  const seed = seedInput.value === '' || isNaN(Number(seedInput.value)) ? randomSeed() : Number(seedInput.value);
  const previewPlaceholder = document.getElementById('edit-preview-placeholder');
  if (!lastEditImageUrl) { alert('Generate an image first'); return; }
  if (hasVisualEdits()) {
    try {
      const dataUrl = await renderEditedImageToCanvas();
      previewPlaceholder.innerHTML = '<div class="spinner"></div><span>Applying edits...</span>';
      const saveBtn = document.getElementById('edit-save-btn'); if (saveBtn) saveBtn.disabled = true;
      const { imageUrl: uploadedUrl } = await uploadEditedImage(dataUrl);
      lastEditImageUrl = uploadedUrl;
      resetImageEdits();
      previewPlaceholder.innerHTML = editPreviewImgHtml(`${uploadedUrl}?t=${Date.now()}`, true);
    } catch (err) { alert('Failed to apply edits: ' + err.message); if (lastEditImageUrl) { previewPlaceholder.innerHTML = editPreviewImgHtml(lastEditImageUrl); applyPanTransform(); } return; }
    finally { const saveBtn = document.getElementById('edit-save-btn'); if (saveBtn) saveBtn.disabled = false; }
  }
  if (isEditingMainCard) {
    try {
      const bgRadio = document.querySelector('input[name="edit-bg"]:checked');
      const backgroundColor = bgRadio?.value === 'transparent' ? 'transparent' : (document.getElementById('edit-background-color')?.value || '#000000');
      await updateSprite(spriteId, { imageUrl: lastEditImageUrl, backgroundColor });
      closeEditModal();
      await renderEditRows();
    } catch (err) { alert('Failed to save: ' + err.message); }
    return;
  }
  if (!editName) { alert('Enter an edit name'); return; }
  const sourceSelect = document.getElementById('edit-source-image');
  const sourceImageUrl = sourceSelect?.value?.trim() || null;
  const editIdInput = document.getElementById('edit-edit-id');
  const existingEditId = (editIdInput?.value ?? '').trim() || null;
  const originalNameInput = document.getElementById('edit-original-name');
  const originalName = (originalNameInput?.value ?? '').trim();
  const nameUnchanged = existingEditId && originalName !== '' && editName === originalName;
  const modelSel = document.getElementById('edit-model');
  const loraSel = document.getElementById('edit-lora');
  const editModel = modelSel?.value?.trim() || null;
  const editLora = loraSel?.value?.trim() || null;
  try {
    if (existingEditId && nameUnchanged) await updateEdit(spriteId, existingEditId, { editName, prompt, seed: lastEditSeed ?? seed, imageUrl: lastEditImageUrl, model: editModel, lora: editLora, type: 'human' });
    else await addEdit(spriteId, { editName, prompt, seed: lastEditSeed ?? seed, imageUrl: lastEditImageUrl, sourceImageUrl: sourceImageUrl || undefined, model: editModel, lora: editLora, type: 'human' });
    closeEditModal();
    await renderEditRows();
  } catch (err) { alert('Failed to save edit: ' + err.message); }
}

function applyPanTransform() {
  const previewPlaceholder = document.getElementById('edit-preview-placeholder'); if (!previewPlaceholder) return;
  const wrap = previewPlaceholder.querySelector('.edit-pan-zoom-wrap');
  const mainImg = previewPlaceholder.querySelector('img:not(.source-overlay)'); if (!mainImg) return;
  const target = wrap || mainImg;
  let transform = `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`;
  if (imageEdits.flipX) transform += ' scaleX(-1)';
  if (imageEdits.flipY) transform += ' scaleY(-1)';
  if (imageEdits.rotation !== 0) transform += ` rotate(${imageEdits.rotation}deg)`;
  target.style.transform = transform;
  target.style.transformOrigin = 'center center';
  mainImg.style.filter = buildFilterCss() || '';
}

function updatePreviewBackground() {
  const previewPlaceholder = document.getElementById('edit-preview-placeholder');
  const bgRadio = document.querySelector('input[name="edit-bg"]:checked');
  const colorInput = document.getElementById('edit-background-color');
  if (previewPlaceholder) previewPlaceholder.style.background = (bgRadio?.value === 'transparent') ? 'transparent' : (colorInput?.value || '#000000');
}

function resetImageEdits() {
  imageEdits = { flipX: false, flipY: false, rotation: 0, brightness: 0, contrast: 0, saturation: 0, hue: 0 };
  zoomLevel = 1.0; panOffset = { x: 0, y: 0 };
  const panToggle = document.getElementById('edit-pan-toggle');
  if (panToggle) panToggle.classList.remove('active');
  syncEditControlsToState(); applyPanTransform();
}

function syncEditControlsToState() {
  const flipXBtn = document.getElementById('edit-flip-x-btn');
  const flipYBtn = document.getElementById('edit-flip-y-btn');
  if (flipXBtn) flipXBtn.classList.toggle('active', imageEdits.flipX);
  if (flipYBtn) flipYBtn.classList.toggle('active', imageEdits.flipY);
  const rotationSelect = document.getElementById('edit-rotation-select');
  if (rotationSelect) rotationSelect.value = imageEdits.rotation;
  syncSlider('edit-filter-brightness', 'edit-filter-brightness-value', imageEdits.brightness);
  syncSlider('edit-filter-contrast', 'edit-filter-contrast-value', imageEdits.contrast);
  syncSlider('edit-filter-saturation', 'edit-filter-saturation-value', imageEdits.saturation);
  syncSlider('edit-filter-hue', 'edit-filter-hue-value', imageEdits.hue);
  syncSlider('edit-zoom-slider', 'edit-zoom-value', Math.round(zoomLevel * 100));
}

function syncSlider(sliderId, outputId, value) {
  const slider = document.getElementById(sliderId);
  const output = document.getElementById(outputId);
  if (slider) slider.value = value;
  if (output) output.textContent = Math.round(value);
}

function hasVisualEdits() {
  return imageEdits.flipX || imageEdits.flipY || imageEdits.rotation !== 0 ||
    imageEdits.brightness !== 0 || imageEdits.contrast !== 0 ||
    imageEdits.saturation !== 0 || imageEdits.hue !== 0 ||
    zoomLevel !== 1.0 || panOffset.x !== 0 || panOffset.y !== 0;
}

function buildFilterCss() {
  const parts = [];
  if (imageEdits.brightness !== 0) parts.push(`brightness(${100 + imageEdits.brightness}%)`);
  if (imageEdits.contrast !== 0) parts.push(`contrast(${100 + imageEdits.contrast}%)`);
  if (imageEdits.saturation !== 0) parts.push(`saturate(${100 + imageEdits.saturation}%)`);
  if (imageEdits.hue !== 0) parts.push(`hue-rotate(${imageEdits.hue}deg)`);
  return parts.join(' ');
}

async function renderEditedImageToCanvas() {
  const previewPlaceholder = document.getElementById('edit-preview-placeholder');
  const wrap = previewPlaceholder?.querySelector('.edit-pan-zoom-wrap');
  const previewImg = previewPlaceholder?.querySelector('img:not(.source-overlay)');
  if (!previewImg || !lastEditImageUrl) throw new Error('No image to render');
  await new Promise((resolve, reject) => { if (previewImg.complete && previewImg.naturalWidth > 0) resolve(); else { previewImg.onload = resolve; previewImg.onerror = reject; } });
  const width = previewImg.naturalWidth; const height = previewImg.naturalHeight;
  const viewEl = wrap || previewImg.parentElement || previewPlaceholder;
  const viewW = viewEl.clientWidth || 1;
  const viewH = viewEl.clientHeight || 1;
  const scaleX = width / viewW;
  const scaleY = height / viewH;
  const panImgX = panOffset.x * scaleX;
  const panImgY = panOffset.y * scaleY;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  const bgRadio = document.querySelector('input[name="edit-bg"]:checked');
  const bgColor = bgRadio?.value === 'transparent' ? null : (document.getElementById('edit-background-color')?.value || '#000000');
  if (bgColor) { ctx.fillStyle = bgColor; ctx.fillRect(0, 0, width, height); }
  else ctx.clearRect(0, 0, width, height);
  ctx.save(); ctx.translate(width / 2, height / 2);
  if (imageEdits.flipX) ctx.scale(-1, 1);
  if (imageEdits.flipY) ctx.scale(1, -1);
  if (imageEdits.rotation !== 0) ctx.rotate((imageEdits.rotation * Math.PI) / 180);
  ctx.scale(zoomLevel, zoomLevel);
  ctx.translate(panImgX, panImgY);
  const filterCss = buildFilterCss();
  if (filterCss) ctx.filter = filterCss;
  ctx.drawImage(previewImg, -width / 2, -height / 2, width, height);
  ctx.restore();
  return canvas.toDataURL('image/png');
}

function updateSourceOverlay() {
  const previewPlaceholder = document.getElementById('edit-preview-placeholder');
  const slider = document.getElementById('edit-overlay-slider');
  const sourceSelect = document.getElementById('edit-source-image');
  if (!previewPlaceholder || !slider || !sourceSelect) return;
  const opacity = parseInt(slider.value) / 100;
  const sourceUrl = sourceSelect.value?.trim();
  let overlay = previewPlaceholder.querySelector('.source-overlay');
  if (opacity === 0 || !sourceUrl) { if (overlay) overlay.remove(); return; }
  if (!overlay) { overlay = document.createElement('img'); overlay.className = 'source-overlay'; previewPlaceholder.appendChild(overlay); }
  overlay.src = sourceUrl + '?t=' + Date.now();
  overlay.style.opacity = opacity;
}

export function setupEditTab() {
  const genBtn = document.getElementById('edit-generate-btn'); if (genBtn) genBtn.addEventListener('click', handleEditGenerate);
  const saveBtn = document.getElementById('edit-save-btn'); if (saveBtn) saveBtn.addEventListener('click', handleEditSave);
  const backBtn = document.getElementById('edit-back');
  if (backBtn) backBtn.addEventListener('click', closeEditModal);
  const randomSeedBtn = document.getElementById('edit-random-seed'); if (randomSeedBtn) randomSeedBtn.addEventListener('click', () => { const input = document.getElementById('edit-seed'); if (input) input.value = randomSeed(); });

  const overlaySlider = document.getElementById('edit-overlay-slider');
  const overlayValue = document.getElementById('edit-overlay-value');
  const sourceSelect = document.getElementById('edit-source-image');
  if (overlaySlider && overlayValue) overlaySlider.addEventListener('input', e => { overlayValue.textContent = e.target.value; updateSourceOverlay(); });
  if (sourceSelect) sourceSelect.addEventListener('change', () => updateSourceOverlay());

  document.querySelectorAll('input[name="edit-bg"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const colorInput = document.getElementById('edit-background-color');
      const colorContainer = colorInput?.closest('.color-picker-container');
      if (radio.value === 'transparent') {
        if (colorInput) colorInput.disabled = true;
        if (colorContainer) colorContainer.style.opacity = '0.5';
      } else {
        if (colorInput) colorInput.disabled = false;
        if (colorContainer) colorContainer.style.opacity = '1';
      }
      updatePreviewBackground();
    });
  });
  const bgColorInput = document.getElementById('edit-background-color');
  if (bgColorInput) bgColorInput.addEventListener('input', () => updatePreviewBackground());

  const previewPlaceholder = document.getElementById('edit-preview-placeholder');
  const panToggle = document.getElementById('edit-pan-toggle');
  function isPanEnabled() { return panToggle && panToggle.classList.contains('active'); }
  if (panToggle) panToggle.addEventListener('click', () => panToggle.classList.toggle('active'));

  if (previewPlaceholder) {
    const isInPanArea = (target) => {
      const mainImg = previewPlaceholder.querySelector('img:not(.source-overlay)');
      return mainImg && (target === mainImg || target.closest('.edit-pan-zoom-wrap'));
    };
    previewPlaceholder.addEventListener('mousedown', e => {
      if (!isPanEnabled() || !lastEditImageUrl || !isInPanArea(e.target)) return;
      isPanning = true;
      panStart = { panX: panOffset.x, panY: panOffset.y, clientX: e.clientX, clientY: e.clientY };
      previewPlaceholder.style.cursor = 'grabbing';
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!isPanning) return;
      panOffset.x = panStart.panX + (e.clientX - panStart.clientX);
      panOffset.y = panStart.panY + (e.clientY - panStart.clientY);
      applyPanTransform();
      e.preventDefault();
    });
    document.addEventListener('mouseup', () => {
      if (isPanning) { isPanning = false; previewPlaceholder.style.cursor = ''; }
    });
    previewPlaceholder.addEventListener('mousemove', e => {
      if (!isPanning) previewPlaceholder.style.cursor = (isPanEnabled() && isInPanArea(e.target)) ? 'grab' : '';
    });
    previewPlaceholder.addEventListener('mouseleave', () => {
      if (!isPanning) previewPlaceholder.style.cursor = '';
    });
  }

  const flipXBtn = document.getElementById('edit-flip-x-btn');
  const flipYBtn = document.getElementById('edit-flip-y-btn');
  const rotationSelect = document.getElementById('edit-rotation-select');
  if (flipXBtn) flipXBtn.addEventListener('click', () => { if (!lastEditImageUrl) return; imageEdits.flipX = !imageEdits.flipX; flipXBtn.classList.toggle('active', imageEdits.flipX); applyPanTransform(); });
  if (flipYBtn) flipYBtn.addEventListener('click', () => { if (!lastEditImageUrl) return; imageEdits.flipY = !imageEdits.flipY; flipYBtn.classList.toggle('active', imageEdits.flipY); applyPanTransform(); });
  if (rotationSelect) rotationSelect.addEventListener('change', e => { if (!lastEditImageUrl) return; imageEdits.rotation = parseInt(e.target.value, 10); applyPanTransform(); });

  const filterSliders = [
    { id: 'edit-filter-brightness', prop: 'brightness' },
    { id: 'edit-filter-contrast', prop: 'contrast' },
    { id: 'edit-filter-saturation', prop: 'saturation' },
    { id: 'edit-filter-hue', prop: 'hue' },
  ];
  filterSliders.forEach(({ id, prop }) => {
    const slider = document.getElementById(id);
    const output = document.getElementById(id + '-value');
    if (slider) {
      slider.addEventListener('input', e => { if (output) output.textContent = e.target.value; imageEdits[prop] = parseInt(e.target.value, 10); applyPanTransform(); });
    }
  });

  const zoomSlider = document.getElementById('edit-zoom-slider');
  const zoomOutput = document.getElementById('edit-zoom-value');
  if (zoomSlider) {
    zoomSlider.addEventListener('input', e => { if (zoomOutput) zoomOutput.textContent = e.target.value; zoomLevel = parseInt(e.target.value, 10) / 100; applyPanTransform(); });
  }

  const resetAllBtn = document.getElementById('edit-reset-all-btn');
  if (resetAllBtn) resetAllBtn.addEventListener('click', () => { if (!lastEditImageUrl) return; resetImageEdits(); });

  document.addEventListener('keydown', e => {
    const detail = document.getElementById(EDIT_DETAIL_ID);
    if (!detail || detail.classList.contains('hidden')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); }
  });

  const removeBgBtn = document.getElementById('edit-remove-background-btn');
  if (removeBgBtn && previewPlaceholder) {
    removeBgBtn.addEventListener('click', async () => {
      if (!lastEditImageUrl || typeof lastEditImageUrl !== 'string') { alert('No image to process. Open a character or generate an edit first.'); return; }
      const bgRadio = document.querySelector('input[name="edit-bg"]:checked');
      const colorInput = document.getElementById('edit-background-color');
      const backgroundColor = bgRadio?.value === 'transparent' ? 'transparent' : (colorInput?.value || '#000000');
      preRmbgImageUrl = lastEditImageUrl;
      try {
        removeBgBtn.disabled = true;
        let imageUrl = lastEditImageUrl;
        if (hasVisualEdits()) {
          const dataUrl = await renderEditedImageToCanvas();
          const { imageUrl: uploadedUrl } = await uploadEditedImage(dataUrl);
          imageUrl = uploadedUrl;
          lastEditImageUrl = uploadedUrl;
          resetImageEdits();
        }
        if (imageUrl.startsWith('http')) { try { imageUrl = new URL(imageUrl).pathname; } catch { alert('Invalid image URL.'); removeBgBtn.disabled = false; return; } }
        if (!imageUrl.startsWith('/')) imageUrl = '/' + imageUrl;
        previewPlaceholder.innerHTML = '<div class="spinner"></div><span>Removing background...</span>';
        const { promptId } = await removeBackground(imageUrl, backgroundColor);
        const interval = setInterval(async () => {
          try {
            const status = await getGenerationStatus(promptId);
            if (!status) return;
            if (status.type === 'progress' || status.type === 'queued') { previewPlaceholder.innerHTML = '<div class="spinner"></div><span>Removing background...</span>'; return; }
            if (status.type === 'complete' && status.images?.length) {
              clearInterval(interval);
              const newUrl = status.images[status.images.length - 1];
              lastEditImageUrl = newUrl;
              resetImageEdits();
              previewPlaceholder.innerHTML = editPreviewImgHtml(newUrl, true);
              updateSourceOverlay();
            }
          } catch { clearInterval(interval); previewPlaceholder.innerHTML = '<span>Error</span>'; }
          finally { removeBgBtn.disabled = false; }
        }, POLL_INTERVAL_MS);
      } catch (err) {
        alert('Remove background failed: ' + err.message);
        if (lastEditImageUrl) previewPlaceholder.innerHTML = editPreviewImgHtml(lastEditImageUrl);
        removeBgBtn.disabled = false;
      }
    });
  }

  const editRestoreBtn = document.getElementById('edit-restore-before-rmbg-btn');
  if (editRestoreBtn && previewPlaceholder) {
    editRestoreBtn.addEventListener('click', () => {
      if (!preRmbgImageUrl) { alert('Nothing to restore. Run RMBG first to be able to revert.'); return; }
      lastEditImageUrl = preRmbgImageUrl;
      resetImageEdits();
      previewPlaceholder.innerHTML = editPreviewImgHtml(preRmbgImageUrl, true);
      updateSourceOverlay();
    });
  }

  const editColorInput = document.getElementById('edit-background-color');
  const editColorValue = document.getElementById('edit-background-color-value');
  if (editColorInput && editColorValue) editColorInput.addEventListener('input', e => { editColorValue.textContent = (e.target.value || '#000000').toUpperCase(); });
}
