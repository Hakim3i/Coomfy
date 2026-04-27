/* Make tab: character creation, generation, full-page panel */

import { getSprites, deleteSprite, createSprite, updateSprite, makeSprite, getGenerationStatus, removeBackground, uploadEditedImage } from './api.js';
import { escapeHtml, syncLayout } from './ui.js';
import { randomSeed } from './utils.js';

const LIST_VIEW_ID = 'make-list-view';
const DETAIL_VIEW_ID = 'make-detail-view';

export function showMakePanel() {
    const list = document.getElementById(LIST_VIEW_ID);
    const detail = document.getElementById(DETAIL_VIEW_ID);
    if (list) list.classList.add('hidden');
    if (detail) detail.classList.remove('hidden');
}

export function hideMakePanel() {
    const list = document.getElementById(LIST_VIEW_ID);
    const detail = document.getElementById(DETAIL_VIEW_ID);
    if (list) list.classList.remove('hidden');
    if (detail) detail.classList.add('hidden');
}

const POLL_INTERVAL_MS = 1500;

let appConfig = null;
export function setAppConfig(config) { appConfig = config; }

function getSizeLabels(orientation = 'portrait') {
    if (orientation === 'landscape') {
        return appConfig?.sizeLabelLandscape ?? { small: '1024 × 640', medium: '1152 × 704', large: '1280 × 768' };
    }
    return appConfig?.sizeLabels ?? { small: '640 × 1024', medium: '704 × 1152', large: '768 × 1280' };
}

function updateLayoutForMake(orientation) {
    const layoutEl = document.querySelector('.make-layout');
    syncLayout(layoutEl, orientation);
}

function syncGenderForSpriteType() {
    const typeSelect = document.getElementById('make-sprite-type');
    const genderSelect = document.getElementById('make-gender-select');
    if (!typeSelect || !genderSelect) return;
    genderSelect.disabled = false;
}

let editingSpriteId = null;
let lastGeneratedImageUrl = null;
let lastGeneratedSeed = null;
let lastGeneratedUpscaleSeed = null;
let currentPollingPromptId = null;
let preRmbgImageUrl = null;
let makeImageEdits = { flipX: false, flipY: false, rotation: 0 };
let originalSpriteImageUrl = null;
let originalSpriteName = null;

function normalizeImageUrl(url) {
    if (!url || typeof url !== 'string') return '';
    const path = url.replace(/\?.*$/, '').trim();
    return path.startsWith('/') ? path : '/' + path;
}

function getFormData(form) {
    const trim = v => (v?.value != null ? v.value.trim() : '');
    const num = v => {
        if (!v?.value || String(v.value).trim() === '') return randomSeed();
        const n = Number(v.value);
        return Number.isFinite(n) ? n : randomSeed();
    };
    const defaultSize = appConfig?.defaultSize ?? 'large';
    const size = form.querySelector('input[name="size"]:checked')?.value || defaultSize;
    const orientation = form.querySelector('input[name="orientation"]:checked')?.value || 'portrait';
    const defaultBg = appConfig?.defaultBackgroundColor ?? '#000000';
    const bgRadio = document.querySelector('input[name="make-bg"]:checked');
    const backgroundColor = bgRadio?.value === 'transparent' ? 'transparent' : (document.getElementById('background-color-input')?.value || defaultBg);
    const typeSelect = document.getElementById('make-sprite-type');
    const spriteType = typeSelect?.value || (appConfig?.defaultSpriteType ?? 'character');
    return {
        name: trim(form.name),
        spriteType,
        gender: form.gender?.value || (appConfig?.defaultGender ?? 'female'),
        prompt: trim(form.prompt),
        seed: num(form.seed),
        upscaleSeed: num(form.upscaleSeed),
        lora: trim(form.lora) || null,
        model: trim(form.model) || null,
        size,
        orientation,
        backgroundColor,
    };
}

function getGenerationParams(data) {
    return {
        name: data.name,
        spriteType: data.spriteType,
        gender: data.gender,
        prompt: data.prompt,
        seed: data.seed,
        upscaleSeed: data.upscaleSeed,
        lora: data.lora,
        model: data.model,
        size: data.size,
        orientation: data.orientation,
        backgroundColor: data.backgroundColor,
    };
}

export async function renderCards() {
    const container = document.getElementById('make-cards');
    if (!container) return;
    let list;
    try {
        list = await getSprites();
    } catch {
        container.innerHTML = '<p class="empty-state">Could not load characters. Is the server running?</p>';
        return;
    }

    const addCardHtml = `
  <article class="add-card" id="add-new-card">
    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"></line>
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
    <span>New Character</span>
  </article>`;

    container.innerHTML = list.map(c => {
        const landscapeClass = c.orientation === 'landscape' ? ' orientation-landscape' : '';
        const typeLabel = 'Character';
        const orientationLabel = c.orientation === 'landscape' ? 'Landscape' : 'Portrait';
        return `
  <article class="card clickable-card${landscapeClass}" data-id="${c.id}">
    <div class="card-image">
      ${c.imageUrl ? `<img src="${c.imageUrl}?t=${Date.now()}" alt="${escapeHtml(c.name)}" loading="lazy">` : '<div class="empty-image">No Image</div>'}
    </div>
    <div class="card-overlay-top">
      <div class="card-badges">
        <span class="card-badge">${escapeHtml(typeLabel)}</span>
        <span class="card-badge">${escapeHtml(orientationLabel)}</span>
      </div>
      <button type="button" class="btn-icon-small delete-sprite" data-id="${c.id}" aria-label="Delete">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
      </button>
    </div>
    <div class="card-overlay-bottom">
      <h3 class="card-name">${escapeHtml(c.name || 'Character')}</h3>
      ${c.lora ? `<span class="card-lora-tag">${escapeHtml(c.lora)}</span>` : ''}
    </div>
  </article>`;
    }).join('') + addCardHtml;

    container.onclick = async e => {
        const addCard = e.target.closest('.add-card');
        if (addCard) { resetModal(); showMakePanel(); return; }
        const deleteBtn = e.target.closest('.delete-sprite');
        if (deleteBtn) {
            e.stopPropagation();
            const id = deleteBtn.dataset.id;
            if (!confirm('Are you sure you want to delete this character?')) return;
            try { await deleteSprite(id); await renderCards(); } catch { alert('Failed to delete character'); }
            return;
        }
        const card = e.target.closest('.clickable-card');
        if (card) {
            const id = card.dataset.id;
            const char = list.find(c => c.id === id);
            if (char) openEditModal(char);
        }
    };
}

export function openEditModal(char) {
    editingSpriteId = char.id;
    makeImageEdits = { flipX: false, flipY: false, rotation: 0 };
    originalSpriteImageUrl = char.imageUrl ? normalizeImageUrl(char.imageUrl) : null;
    originalSpriteName = char.name || '';
    const form = document.getElementById('make-sprite-form');
    const titleEl = document.getElementById('make-panel-title');
    if (titleEl) titleEl.textContent = 'Make Character';
    form.name.value = char.name || '';
    const typeSelect = document.getElementById('make-sprite-type');
    if (typeSelect) typeSelect.value = char.type || 'character';
    const genderSelect = document.getElementById('make-gender-select');
    if (genderSelect) genderSelect.value = char.gender || 'female';
    form.prompt.value = char.prompt || '';
    form.seed.value = char.seed !== undefined && char.seed !== -1 ? char.seed : randomSeed();
    form.lora.value = char.lora || '';
    if (form.model && char.model) form.model.value = char.model;
    form.upscaleSeed.value = char.upscaleSeed !== undefined && char.upscaleSeed !== -1 ? char.upscaleSeed : randomSeed();
    lastGeneratedImageUrl = char.imageUrl;
    lastGeneratedSeed = form.seed.value;
    lastGeneratedUpscaleSeed = form.upscaleSeed.value;
    const previewArea = form.querySelector('.image-placeholder');
    const size = char.size || 'large';
    const orientation = char.orientation || 'portrait';
    const sizeRadio = form.querySelector(`input[name="size"][value="${size}"]`);
    if (sizeRadio) sizeRadio.checked = true;
    const orientationRadio = form.querySelector(`input[name="orientation"][value="${orientation}"]`);
    if (orientationRadio) orientationRadio.checked = true;
    const sizeLabels = getSizeLabels(orientation);
    const previewSpan = previewArea.querySelector('span');
    if (previewSpan) previewSpan.textContent = sizeLabels[size] || sizeLabels.large;
    const backgroundColor = char.backgroundColor || (appConfig?.defaultBackgroundColor ?? '#000000');
    const colorInput = document.getElementById('background-color-input');
    const colorContainer = colorInput?.closest('.color-picker-container');
    const transparentRadio = document.querySelector('input[name="make-bg"][value="transparent"]');
    const solidRadio = document.querySelector('input[name="make-bg"][value="solid"]');
    if (backgroundColor === 'transparent') {
        if (transparentRadio) transparentRadio.checked = true;
        if (solidRadio) solidRadio.checked = false;
        if (colorInput) colorInput.disabled = true;
        if (colorContainer) colorContainer.style.opacity = '0.5';
    } else {
        if (solidRadio) solidRadio.checked = true;
        if (transparentRadio) transparentRadio.checked = false;
        if (colorInput) { colorInput.disabled = false; colorInput.value = backgroundColor; }
        if (colorContainer) colorContainer.style.opacity = '1';
        const colorValue = document.getElementById('background-color-value');
        if (colorValue) colorValue.textContent = (backgroundColor + '').toUpperCase();
    }
    if (char.imageUrl) {
        previewArea.innerHTML = `<img src="${char.imageUrl}?t=${Date.now()}" style="width:100%; height:100%; object-fit: cover;">`;
    } else {
        previewArea.innerHTML = `<span>${sizeLabels[size] || sizeLabels.large}</span>`;
    }
    updateLayoutForMake(orientation);
    syncGenderForSpriteType();
    syncMakeTransformControls();
    applyMakePreviewTransform();
    document.getElementById('save-btn').disabled = false;
    showMakePanel();
}

export function resetModal() {
    editingSpriteId = null;
    lastGeneratedImageUrl = null;
    lastGeneratedSeed = null;
    lastGeneratedUpscaleSeed = null;
    preRmbgImageUrl = null;
    makeImageEdits = { flipX: false, flipY: false, rotation: 0 };
    originalSpriteImageUrl = null;
    originalSpriteName = null;
    currentPollingPromptId = null;
    const form = document.getElementById('make-sprite-form');
    form.reset();
    const defaultBg = appConfig?.defaultBackgroundColor ?? '#000000';
    const defaultSize = appConfig?.defaultSize ?? 'large';
    const defaultOrientation = 'portrait';
    const sizeLabels = getSizeLabels(defaultOrientation);
    const titleEl = document.getElementById('make-panel-title');
    if (titleEl) titleEl.textContent = 'New Character';
    const placeholder = form.querySelector('.image-placeholder');
    placeholder.innerHTML = `<span>${sizeLabels[defaultSize] || sizeLabels.large}</span>`;
    const sizeRadio = form.querySelector(`input[name="size"][value="${defaultSize}"]`);
    if (sizeRadio) sizeRadio.checked = true;
    const orientationRadio = form.querySelector(`input[name="orientation"][value="${defaultOrientation}"]`);
    syncMakeTransformControls();
    if (orientationRadio) orientationRadio.checked = true;
    updateLayoutForMake(defaultOrientation);
    const typeSelect = document.getElementById('make-sprite-type');
    if (typeSelect) typeSelect.value = appConfig?.defaultSpriteType ?? 'character';
    syncGenderForSpriteType();
    const solidRadio = document.querySelector('input[name="make-bg"][value="solid"]');
    if (solidRadio) solidRadio.checked = true;
    const transparentRadio = document.querySelector('input[name="make-bg"][value="transparent"]');
    if (transparentRadio) transparentRadio.checked = false;
    const colorInput = document.getElementById('background-color-input');
    if (colorInput) {
        colorInput.disabled = false;
        colorInput.value = defaultBg;
    }
    const colorValue = document.getElementById('background-color-value');
    if (colorValue) colorValue.textContent = defaultBg.toUpperCase();
    const colorContainer = colorInput?.closest('.color-picker-container');
    if (colorContainer) colorContainer.style.opacity = '1';
    form.seed.value = randomSeed();
    form.upscaleSeed.value = randomSeed();
    document.getElementById('save-btn').disabled = true;
    document.getElementById('generate-btn').disabled = false;
}

export async function handleGenerateClick() {
    preRmbgImageUrl = null;
    const form = document.getElementById('make-sprite-form');
    const generateBtn = document.getElementById('generate-btn');
    const saveBtn = document.getElementById('save-btn');
    const previewArea = document.getElementById('sprite-preview-placeholder');
    if (!previewArea) { alert('Error: Preview area not found'); return; }
    const data = getFormData(form);
    const currentParams = getGenerationParams(data);
    if (!data.name) { alert('Please enter a name first'); return; }
    try {
        generateBtn.disabled = true;
        saveBtn.disabled = true;
        previewArea.innerHTML = '<div class="spinner"></div><span>Queueing...</span>';
        const { promptId } = await makeSprite(currentParams);
        currentPollingPromptId = promptId;
        pollGenerationStatus(promptId, previewArea, (imageUrl, seedUsed, upscaleSeedUsed) => {
            lastGeneratedImageUrl = imageUrl;
            lastGeneratedSeed = seedUsed;
            lastGeneratedUpscaleSeed = upscaleSeedUsed ?? lastGeneratedUpscaleSeed;
            generateBtn.disabled = false;
            saveBtn.disabled = false;
        });
    } catch (err) {
        alert('Generation failed: ' + err.message);
        generateBtn.disabled = false;
        previewArea.innerHTML = '<span>Error</span>';
    }
}

async function pollGenerationStatus(promptId, previewArea, onComplete) {
    const interval = setInterval(async () => {
        if (currentPollingPromptId !== promptId) { clearInterval(interval); return; }
        try {
            const status = await getGenerationStatus(promptId);
            if (!status) return;
            const nodeText = status.node ? `Executing node ${status.node}...` : 'Queueing...';
            if (status.type === 'progress' || status.type === 'queued') {
                const latestImg = status.images?.length ? status.images[status.images.length - 1] : null;
                const overlay = previewArea.querySelector('.poll-overlay');
                const spinner = previewArea.querySelector('.spinner');
                if (latestImg && overlay) {
                    const img = previewArea.querySelector('img');
                    if (img) img.src = latestImg;
                    const span = overlay.querySelector('span');
                    if (span) span.textContent = nodeText;
                } else if (latestImg) {
                    previewArea.innerHTML = `<img src="${latestImg}" style="width:100%;height:100%;object-fit:cover;opacity:0.6;"><div class="poll-overlay"><div class="spinner"></div><span>${nodeText}</span></div>`;
                } else if (spinner) {
                    const span = previewArea.querySelector('span');
                    if (span) span.textContent = nodeText;
                } else {
                    previewArea.innerHTML = `<div class="spinner"></div><span>${nodeText}</span>`;
                }
            }
            if (status.type === 'complete') {
                clearInterval(interval);
                makeImageEdits = { flipX: false, flipY: false, rotation: 0 };
                syncMakeTransformControls();
                const finalImg = status.images?.[status.images.length - 1];
                previewArea.innerHTML = finalImg
                    ? `<div class="preview-ready"><img src="${finalImg}" style="width:100%;height:100%;object-fit:cover;"><div class="ready-badge">READY</div></div>`
                    : '<span>Done</span>';
                onComplete(finalImg, status.seed, status.upscaleSeed);
            }
        } catch {
            clearInterval(interval);
            previewArea.innerHTML = '<span>Error</span>';
        }
    }, POLL_INTERVAL_MS);
}

function hasMakeTransforms() {
    return makeImageEdits.flipX || makeImageEdits.flipY || makeImageEdits.rotation !== 0;
}

function syncMakeTransformControls() {
    const flipXBtn = document.getElementById('make-flip-x-btn');
    const flipYBtn = document.getElementById('make-flip-y-btn');
    const rotationSelect = document.getElementById('make-rotation-select');
    if (flipXBtn) flipXBtn.classList.toggle('active', makeImageEdits.flipX);
    if (flipYBtn) flipYBtn.classList.toggle('active', makeImageEdits.flipY);
    if (rotationSelect) rotationSelect.value = String(makeImageEdits.rotation);
}

function applyMakePreviewTransform() {
    const previewArea = document.getElementById('sprite-preview-placeholder');
    const previewImg = previewArea?.querySelector('img');
    if (!previewImg) return;
    let transform = '';
    if (makeImageEdits.flipX) transform += ' scaleX(-1)';
    if (makeImageEdits.flipY) transform += ' scaleY(-1)';
    if (makeImageEdits.rotation !== 0) transform += ` rotate(${makeImageEdits.rotation}deg)`;
    previewImg.style.transform = transform.trim() || '';
    previewImg.style.transformOrigin = 'center center';
}

async function renderMakeImageWithTransforms() {
    const previewArea = document.getElementById('sprite-preview-placeholder');
    const previewImg = previewArea?.querySelector('img');
    if (!previewImg || !lastGeneratedImageUrl || !hasMakeTransforms()) return lastGeneratedImageUrl;
    const width = previewImg.naturalWidth;
    const height = previewImg.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const bgRadio = document.querySelector('input[name="make-bg"]:checked');
    const bgColor = bgRadio?.value === 'transparent' ? null : (document.getElementById('background-color-input')?.value || '#000000');
    if (bgColor) { ctx.fillStyle = bgColor; ctx.fillRect(0, 0, width, height); }
    else ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(width / 2, height / 2);
    if (makeImageEdits.flipX) ctx.scale(-1, 1);
    if (makeImageEdits.flipY) ctx.scale(1, -1);
    if (makeImageEdits.rotation !== 0) ctx.rotate((makeImageEdits.rotation * Math.PI) / 180);
    ctx.drawImage(previewImg, -width / 2, -height / 2, width, height);
    ctx.restore();
    const dataUrl = canvas.toDataURL('image/png');
    const result = await uploadEditedImage(dataUrl);
    return result.imageUrl;
}

export async function handleCreateSubmit(e) {
    e.preventDefault();
    const form = e.target;
    let imageUrlToSave = lastGeneratedImageUrl;
    if (lastGeneratedImageUrl && hasMakeTransforms()) {
        try {
            imageUrlToSave = await renderMakeImageWithTransforms();
        } catch (err) { alert('Failed to apply transforms: ' + err.message); return; }
    }
    const data = getFormData(form);
    if (!data.name) return;
    try {
        const charData = {
            ...getGenerationParams(data),
            type: data.spriteType,
            seed: lastGeneratedSeed ?? data.seed,
            upscaleSeed: lastGeneratedUpscaleSeed ?? data.upscaleSeed,
            imageUrl: imageUrlToSave,
        };
        const nameChanged = editingSpriteId && originalSpriteName && data.name !== originalSpriteName;
        if (editingSpriteId && !nameChanged) { await updateSprite(editingSpriteId, charData); } else { await createSprite(charData); }
        resetModal();
        hideMakePanel();
        await renderCards();
    } catch (err) { alert('Failed to save character: ' + err.message); }
}

export function setupRandomSeed() {
    const backBtn = document.getElementById('make-back');
    if (backBtn) backBtn.addEventListener('click', () => { resetModal(); hideMakePanel(); });

    const btn = document.getElementById('random-seed-btn');
    if (btn) btn.addEventListener('click', () => { const input = document.querySelector('input[name="seed"]'); if (input) input.value = randomSeed(); });

    const typeSelect = document.getElementById('make-sprite-type');
    if (typeSelect) typeSelect.addEventListener('change', syncGenderForSpriteType);

    const sizeInputs = document.querySelectorAll('input[name="size"]');
    const orientationInputs = document.querySelectorAll('input[name="orientation"]');
    const previewSpan = document.querySelector('.image-placeholder span');

    function updateSizeLabel() {
        const form = document.getElementById('make-sprite-form');
        const size = form.querySelector('input[name="size"]:checked')?.value || 'large';
        const orientation = form.querySelector('input[name="orientation"]:checked')?.value || 'portrait';
        const labels = getSizeLabels(orientation);
        if (previewSpan) previewSpan.textContent = labels[size] || labels.large;
        updateLayoutForMake(orientation);
    }

    sizeInputs.forEach(input => input.addEventListener('change', updateSizeLabel));
    orientationInputs.forEach(input => input.addEventListener('change', updateSizeLabel));

    const upscaleSeedBtn = document.getElementById('random-upscale-seed-btn');
    if (upscaleSeedBtn) upscaleSeedBtn.addEventListener('click', () => { const input = document.querySelector('input[name="upscaleSeed"]'); if (input) input.value = randomSeed(); });

    const flipXBtn = document.getElementById('make-flip-x-btn');
    const flipYBtn = document.getElementById('make-flip-y-btn');
    const rotationSelect = document.getElementById('make-rotation-select');
    if (flipXBtn) flipXBtn.addEventListener('click', () => {
        const previewImg = document.getElementById('sprite-preview-placeholder')?.querySelector('img');
        if (!previewImg) { alert('No image to flip.'); return; }
        makeImageEdits.flipX = !makeImageEdits.flipX;
        flipXBtn.classList.toggle('active', makeImageEdits.flipX);
        applyMakePreviewTransform();
    });
    if (flipYBtn) flipYBtn.addEventListener('click', () => {
        const previewImg = document.getElementById('sprite-preview-placeholder')?.querySelector('img');
        if (!previewImg) { alert('No image to flip.'); return; }
        makeImageEdits.flipY = !makeImageEdits.flipY;
        flipYBtn.classList.toggle('active', makeImageEdits.flipY);
        applyMakePreviewTransform();
    });
    if (rotationSelect) rotationSelect.addEventListener('change', (e) => {
        const previewImg = document.getElementById('sprite-preview-placeholder')?.querySelector('img');
        if (!previewImg) { alert('No image to rotate.'); return; }
        makeImageEdits.rotation = parseInt(e.target.value, 10);
        applyMakePreviewTransform();
    });

    const removeBgBtn = document.getElementById('remove-background-btn');
    const makePreviewArea = () => document.getElementById('sprite-preview-placeholder');
    if (removeBgBtn) {
        removeBgBtn.addEventListener('click', async () => {
            let imageUrl = lastGeneratedImageUrl;
            if (!imageUrl || typeof imageUrl !== 'string') { alert('No image to process. Generate a character or open one to edit first.'); return; }
            if (imageUrl.startsWith('http')) { try { imageUrl = new URL(imageUrl).pathname; } catch { alert('Invalid image URL.'); return; } }
            if (!imageUrl.startsWith('/')) imageUrl = '/' + imageUrl;
            const bgRadio = document.querySelector('input[name="make-bg"]:checked');
            const colorInput = document.getElementById('background-color-input');
            const backgroundColor = bgRadio?.value === 'transparent' ? 'transparent' : (colorInput?.value || '#000000');
            const previewArea = makePreviewArea();
            preRmbgImageUrl = lastGeneratedImageUrl;
            try {
                removeBgBtn.disabled = true;
                if (previewArea) previewArea.innerHTML = '<div class="spinner"></div><span>Removing background...</span>';
                const { promptId } = await removeBackground(imageUrl, backgroundColor);
                const interval = setInterval(async () => {
                    try {
                        const status = await getGenerationStatus(promptId);
                        if (!status) return;
                        if (status.type === 'progress' || status.type === 'queued') {
                            if (previewArea) previewArea.innerHTML = '<div class="spinner"></div><span>Removing background...</span>';
                            return;
                        }
                        if (status.type === 'complete' && status.images?.length) {
                            clearInterval(interval);
                            const newUrl = status.images[status.images.length - 1];
                            lastGeneratedImageUrl = newUrl;
                            if (previewArea) {
                                previewArea.innerHTML = `<div class="preview-ready"><img src="${newUrl}" style="width:100%;height:100%;object-fit:cover;"><div class="ready-badge">READY</div></div>`;
                                applyMakePreviewTransform();
                            }
                        }
                    } catch { clearInterval(interval); if (previewArea) previewArea.innerHTML = '<span>Error</span>'; }
                    finally { removeBgBtn.disabled = false; }
                }, POLL_INTERVAL_MS);
            } catch (err) {
                alert('Remove background failed: ' + err.message);
                if (previewArea && lastGeneratedImageUrl) {
                    previewArea.innerHTML = `<img src="${lastGeneratedImageUrl}" style="width:100%;height:100%;object-fit:cover;">`;
                    applyMakePreviewTransform();
                }
                removeBgBtn.disabled = false;
            }
        });
    }

    const restoreRmbgBtn = document.getElementById('restore-before-rmbg-btn');
    if (restoreRmbgBtn) {
        restoreRmbgBtn.addEventListener('click', () => {
            if (!preRmbgImageUrl) { alert('Nothing to restore. Run RMBG first to be able to revert.'); return; }
            lastGeneratedImageUrl = preRmbgImageUrl;
            const pa = makePreviewArea();
            if (pa) {
                pa.innerHTML = `<div class="preview-ready"><img src="${preRmbgImageUrl}" style="width:100%;height:100%;object-fit:cover;"><div class="ready-badge">READY</div></div>`;
                applyMakePreviewTransform();
            }
        });
    }

    document.querySelectorAll('input[name="make-bg"]').forEach(radio => {
        radio.addEventListener('change', e => {
            const colorInput = document.getElementById('background-color-input');
            const colorContainer = colorInput?.closest('.color-picker-container');
            if (e.target.value === 'transparent') {
                if (colorInput) colorInput.disabled = true;
                if (colorContainer) colorContainer.style.opacity = '0.5';
            } else {
                if (colorInput) colorInput.disabled = false;
                if (colorContainer) colorContainer.style.opacity = '1';
            }
        });
    });
    const colorInput = document.getElementById('background-color-input');
    if (colorInput) colorInput.addEventListener('input', e => {
        const colorValue = document.getElementById('background-color-value');
        if (colorValue) colorValue.textContent = e.target.value.toUpperCase();
    });
}
