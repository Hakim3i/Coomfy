/* Export tab: frame editor, sprite sheet generation, video list */

import { getSavedVideos, deleteVideo, exportRmbg, getGenerationStatus } from './api.js';
import { escapeHtml } from './ui.js';

const PREFETCH_RANGE = 5;
const CACHE_KEEP_RANGE = 20;
const TIMELINE_FRAME_WIDTH = 12;
let editorState = null;

let frameExtractor = null;
let videoElement = null;

const listEl = () => document.getElementById('videos-list');
const editorEl = () => document.getElementById('frame-editor');

function formatDate(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, { dateStyle: 'medium' });
  } catch {
    return isoString;
  }
}

function createDefaultEdits() {
  return {
    crop: null,
    transform: { flipX: false, flipY: false, rotation: 0 },
    filters: { brightness: 0, contrast: 0, saturation: 0, hue: 0 },
    pan: { x: 0, y: 0 },
    zoom: 1.0,
  };
}

function createFrame(index, fps) {
  return {
    index,
    timestamp: index / fps,
    imageData: null,
    isDeleted: false,
    edits: createDefaultEdits(),
    rmbgImageUrl: null,
  };
}

function createDefaultExportSettings(defaultFilename = 'spritesheet') {
  return {
    exportMode: 'spriteSheet', // 'spriteSheet' | 'pictures'
    columns: 4,
    rows: 'auto',
    padding: 2,
    backgroundColor: 'transparent',
    format: 'png',
    quality: 90,
    frameOrder: 'original',
    customOrder: [],
    includeMetadata: true,
    outputFilename: defaultFilename,
  };
}

function createEditorState(video, totalFrames) {
  const fps = video.fps || 16;
  const frames = Array.from({ length: totalFrames }, (_, i) => createFrame(i, fps));
  const spriteName = video.spriteName || 'Character';
  const displayName = video.name || spriteName;

  // Create safe filename from animation/sprite name (remove special characters)
  const safeFilename = displayName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();

  return {
    videoId: video.id,
    videoUrl: video.videoUrl,
    spriteName: displayName,
    fps,
    frames,
    totalFrames,
    currentFrameIndex: 0,
    isPlaying: false,
    playbackTimer: null,
    exportSettings: createDefaultExportSettings(safeFilename),
  };
}

class FrameExtractor {
  constructor(video, fps, totalFrames) {
    this.video = video;
    this.fps = fps;
    this.totalFrames = totalFrames;
    this.frameCache = new Map();
    this.pendingExtractions = new Map();
    this._extractQueue = Promise.resolve();
  }

  async extractFrame(frameIndex) {
    if (frameIndex < 0 || frameIndex >= this.totalFrames) return null;
    if (this.frameCache.has(frameIndex)) return this.frameCache.get(frameIndex);
    if (this.pendingExtractions.has(frameIndex)) return this.pendingExtractions.get(frameIndex);

    const extractionPromise = this._extractQueue
      .then(() => this._doExtract(frameIndex))
      .then((bitmap) => {
        this.frameCache.set(frameIndex, bitmap);
        return bitmap;
      })
      .finally(() => {
        this.pendingExtractions.delete(frameIndex);
      });

    this.pendingExtractions.set(frameIndex, extractionPromise);
    this._extractQueue = this._extractQueue.then(() => extractionPromise);

    return extractionPromise;
  }

  async _doExtract(frameIndex) {
    const timestamp = frameIndex / this.fps;

    return new Promise((resolve, reject) => {
      const onSeeked = async () => {
        this.video.removeEventListener('seeked', onSeeked);
        this.video.removeEventListener('error', onError);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = this.video.videoWidth;
          canvas.height = this.video.videoHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(this.video, 0, 0);
          const bitmap = await createImageBitmap(canvas);
          resolve(bitmap);
        } catch (err) {
          reject(err);
        }
      };

      const onError = () => {
        this.video.removeEventListener('seeked', onSeeked);
        this.video.removeEventListener('error', onError);
        reject(new Error('Video seek failed'));
      };

      this.video.addEventListener('seeked', onSeeked);
      this.video.addEventListener('error', onError);
      this.video.currentTime = timestamp;
    });
  }

  async prefetchRange(centerIndex) {
    const start = Math.max(0, centerIndex - PREFETCH_RANGE);
    const end = Math.min(this.totalFrames - 1, centerIndex + PREFETCH_RANGE);

    const promises = [];
    for (let i = start; i <= end; i++) {
      if (!this.frameCache.has(i) && !this.pendingExtractions.has(i)) {
        promises.push(this.extractFrame(i).catch(() => null));
      }
    }

    await Promise.all(promises);
  }

  clearDistantFrames(currentIndex) {
    for (const [index, bitmap] of this.frameCache) {
      if (Math.abs(index - currentIndex) > CACHE_KEEP_RANGE) {
        if (bitmap && typeof bitmap.close === 'function') {
          bitmap.close();
        }
        this.frameCache.delete(index);
      }
    }
  }

  getFrameFromCache(frameIndex) {
    return this.frameCache.get(frameIndex) || null;
  }

  dispose() {
    for (const bitmap of this.frameCache.values()) {
      if (bitmap && typeof bitmap.close === 'function') {
        bitmap.close();
      }
    }
    this.frameCache.clear();
    this.pendingExtractions.clear();
  }
}

async function goToFrame(index) {
  if (!editorState || !frameExtractor) return;

  // Clamp to valid range
  index = Math.max(0, Math.min(editorState.totalFrames - 1, index));
  editorState.currentFrameIndex = index;

  await renderCurrentFrame();
  updateFrameCounter();
  updateTimelinePosition();
  updateDeleteButton();

  // Background prefetch and cleanup
  frameExtractor.prefetchRange(index);
  frameExtractor.clearDistantFrames(index);
}

function nextFrame() {
  if (!editorState) return;
  const idx = editorState.currentFrameIndex;
  for (let i = idx + 1; i < editorState.totalFrames; i++) {
    if (!editorState.frames[i].isDeleted) {
      goToFrame(i);
      return;
    }
  }
  for (let i = 0; i < idx; i++) {
    if (!editorState.frames[i].isDeleted) {
      goToFrame(i);
      return;
    }
  }
}

function prevFrame() {
  if (!editorState) return;
  const idx = editorState.currentFrameIndex;
  for (let i = idx - 1; i >= 0; i--) {
    if (!editorState.frames[i].isDeleted) {
      goToFrame(i);
      return;
    }
  }
  for (let i = editorState.totalFrames - 1; i > idx; i--) {
    if (!editorState.frames[i].isDeleted) {
      goToFrame(i);
      return;
    }
  }
}

function goToFirstFrame() {
  if (!editorState) return;
  for (let i = 0; i < editorState.totalFrames; i++) {
    if (!editorState.frames[i].isDeleted) {
      goToFrame(i);
      return;
    }
  }
}

function goToLastFrame() {
  if (!editorState) return;
  for (let i = editorState.totalFrames - 1; i >= 0; i--) {
    if (!editorState.frames[i].isDeleted) {
      goToFrame(i);
      return;
    }
  }
}

function togglePlayback() {
  if (!editorState) return;

  if (editorState.isPlaying) {
    pausePlayback();
  } else {
    startPlayback();
  }
}

function startPlayback() {
  if (!editorState || editorState.isPlaying) return;

  editorState.isPlaying = true;
  updatePlaybackButton();

  const interval = 1000 / editorState.fps;
  editorState.playbackTimer = setInterval(() => {
    // Find next non-deleted frame
    let nextIndex = editorState.currentFrameIndex + 1;

    // Skip deleted frames
    while (nextIndex < editorState.totalFrames && editorState.frames[nextIndex].isDeleted) {
      nextIndex++;
    }

    // If we reached the end, loop back to first non-deleted frame
    if (nextIndex >= editorState.totalFrames) {
      nextIndex = 0;
      while (nextIndex < editorState.totalFrames && editorState.frames[nextIndex].isDeleted) {
        nextIndex++;
      }

      // If all frames are deleted, stop playback
      if (nextIndex >= editorState.totalFrames) {
        pausePlayback();
        return;
      }
    }

    goToFrame(nextIndex);
  }, interval);
}

function pausePlayback() {
  if (!editorState) return;

  editorState.isPlaying = false;
  if (editorState.playbackTimer) {
    clearInterval(editorState.playbackTimer);
    editorState.playbackTimer = null;
  }
  updatePlaybackButton();
}

function updatePlaybackButton() {
  const btn = document.getElementById('frame-play-btn');
  if (!btn) return;

  if (editorState?.isPlaying) {
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
    btn.title = 'Pause (Space)';
  } else {
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"></polygon></svg>`;
    btn.title = 'Play (Space)';
  }
}

async function renderCurrentFrame() {
  if (!editorState || !frameExtractor) return;

  const canvas = document.getElementById('frame-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const frame = editorState.frames[editorState.currentFrameIndex];

  // Show loading state
  const placeholder = document.getElementById('frame-canvas-placeholder');

  let bitmap = null;
  if (frame.rmbgImageUrl) {
    if (frame._rmbgBitmap) {
      bitmap = frame._rmbgBitmap;
    } else {
      if (placeholder) placeholder.style.display = 'flex';
      try {
        const base = window.location.origin;
        const url = frame.rmbgImageUrl.startsWith('http') ? frame.rmbgImageUrl : base + frame.rmbgImageUrl;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to load');
        const blob = await res.blob();
        bitmap = await createImageBitmap(blob);
        frame._rmbgBitmap = bitmap;
      } catch (e) {
        frame.rmbgImageUrl = null;
        bitmap = null;
      }
      if (placeholder) placeholder.style.display = 'none';
      if (!bitmap) {
        bitmap = frameExtractor.getFrameFromCache(frame.index);
        if (!bitmap) bitmap = await frameExtractor.extractFrame(frame.index);
      }
    }
  }
  if (!bitmap) {
    bitmap = frameExtractor.getFrameFromCache(frame.index);
    if (!bitmap) {
      if (placeholder) placeholder.style.display = 'flex';
      bitmap = await frameExtractor.extractFrame(frame.index);
      if (placeholder) placeholder.style.display = 'none';
    }
  }

  if (!bitmap) {
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#666';
    ctx.textAlign = 'center';
    ctx.fillText('Failed to load frame', canvas.width / 2, canvas.height / 2);
    return;
  }

  // Store in frame if not already
  frame.imageData = bitmap;

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // If using RMBG image, draw it scaled to fit; otherwise apply edits and draw
  if (frame.rmbgImageUrl) {
    drawFrameWithEdits(ctx, bitmap, createDefaultEdits(), canvas.width, canvas.height);
  } else {
    drawFrameWithEdits(ctx, bitmap, frame.edits, canvas.width, canvas.height);
  }

  // Show deleted overlay if needed
  const deletedOverlay = document.getElementById('frame-deleted-overlay');
  if (deletedOverlay) {
    deletedOverlay.style.display = frame.isDeleted ? 'flex' : 'none';
  }
}

function drawFrameWithEdits(ctx, bitmap, edits, canvasWidth, canvasHeight) {
  ctx.save();

  // Calculate scale to fit
  const scale = Math.min(canvasWidth / bitmap.width, canvasHeight / bitmap.height);
  const scaledWidth = bitmap.width * scale;
  const scaledHeight = bitmap.height * scale;
  const offsetX = (canvasWidth - scaledWidth) / 2;
  const offsetY = (canvasHeight - scaledHeight) / 2;

  // Move to center
  ctx.translate(canvasWidth / 2, canvasHeight / 2);

  // Apply transforms (flip and rotation only; filters/zoom/pan removed)
  ctx.rotate((edits.transform.rotation * Math.PI) / 180);
  ctx.scale(
    edits.transform.flipX ? -1 : 1,
    edits.transform.flipY ? -1 : 1
  );

  // Draw frame centered
  ctx.drawImage(bitmap, -scaledWidth / 2, -scaledHeight / 2, scaledWidth, scaledHeight);

  ctx.restore();
}

function updateFrameCounter() {
  const counter = document.getElementById('frame-counter');
  if (!counter || !editorState) return;

  const current = editorState.currentFrameIndex + 1;
  const deleted = editorState.frames.filter(f => f.isDeleted).length;
  const exportableCount = editorState.totalFrames - deleted;

  counter.textContent = `Frame ${current} / ${exportableCount}`;

  const deletedCounter = document.getElementById('deleted-frame-counter');
  if (deletedCounter) {
    deletedCounter.textContent = deleted > 0 ? `(${deleted} deleted)` : '';
  }
}

function renderTimeline() {
  const timeline = document.getElementById('frame-timeline');
  if (!timeline || !editorState) return;

  timeline.innerHTML = '';

  const containerWidth = timeline.offsetWidth;
  const frameWidth = Math.max(4, Math.min(TIMELINE_FRAME_WIDTH, containerWidth / editorState.totalFrames));

  editorState.frames.forEach((frame, index) => {
    const marker = document.createElement('div');
    let cls = 'timeline-frame';
    if (frame.isDeleted) cls += ' deleted';
    else if (frame.rmbgImageUrl) cls += ' rmbg';
    marker.className = cls;
    marker.style.width = frameWidth + 'px';
    marker.dataset.frameIndex = index;
    const parts = [`Frame ${index + 1}`];
    if (frame.isDeleted) parts.push('deleted');
    if (frame.rmbgImageUrl && !frame.isDeleted) parts.push('RMBG');
    marker.title = parts.join(' · ');

    marker.addEventListener('click', () => {
      pausePlayback();
      goToFrame(index);
    });

    timeline.appendChild(marker);
  });

  updateTimelinePosition();
}

function updateTimelinePosition() {
  const timeline = document.getElementById('frame-timeline');
  if (!timeline || !editorState) return;

  // Remove previous position indicator
  const existing = timeline.querySelector('.timeline-position');
  if (existing) existing.remove();

  // Add position indicator
  const markers = timeline.querySelectorAll('.timeline-frame');
  if (markers[editorState.currentFrameIndex]) {
    markers[editorState.currentFrameIndex].classList.add('current');

    // Remove current class from others
    markers.forEach((m, i) => {
      if (i !== editorState.currentFrameIndex) {
        m.classList.remove('current');
      }
    });
  }
}

function toggleDeleteCurrentFrame() {
  if (!editorState) return;

  const frame = editorState.frames[editorState.currentFrameIndex];
  frame.isDeleted = !frame.isDeleted;

  renderCurrentFrame();
  renderTimeline();
  updateFrameCounter();
  updateDeleteButton();
  updateExportPreview();
}

function updateDeleteButton() {
  const btn = document.getElementById('frame-delete-btn');
  if (!btn || !editorState) return;

  const frame = editorState.frames[editorState.currentFrameIndex];
  btn.textContent = frame.isDeleted ? 'Restore Frame' : 'Delete Frame';
  btn.classList.toggle('btn-danger', !frame.isDeleted);
  btn.classList.toggle('btn-secondary', frame.isDeleted);
}

function updateFrameEdit(property, value) {
  if (!editorState) return;

  const frame = editorState.frames[editorState.currentFrameIndex];

  // Navigate to the property (e.g., 'filters.brightness' -> frame.edits.filters.brightness)
  const parts = property.split('.');
  let target = frame.edits;
  for (let i = 0; i < parts.length - 1; i++) {
    target = target[parts[i]];
  }
  target[parts[parts.length - 1]] = value;

  renderCurrentFrame();
}

function syncEditControlsToCurrentFrame() {
  if (!editorState) return;

  const frame = editorState.frames[editorState.currentFrameIndex];
  const edits = frame.edits;

  const flipXBtn = document.getElementById('edit-flip-x');
  const flipYBtn = document.getElementById('edit-flip-y');
  if (flipXBtn) flipXBtn.classList.toggle('active', edits.transform.flipX);
  if (flipYBtn) flipYBtn.classList.toggle('active', edits.transform.flipY);

  const rotationSelect = document.getElementById('edit-rotation');
  if (rotationSelect) rotationSelect.value = edits.transform.rotation;
}

function updateExportSetting(key, value) {
  if (!editorState) return;
  editorState.exportSettings[key] = value;

  if (key === 'columns' || key === 'padding') {
    updateExportPreview();
  }
}

function updateExportPreview() {
  const preview = document.getElementById('spritesheet-preview');
  if (!preview || !editorState) return;

  const nonDeleted = editorState.frames.filter(f => !f.isDeleted);
  const { columns, padding } = editorState.exportSettings;
  const rows = Math.ceil(nonDeleted.length / columns);

  const rowsDisplay = document.getElementById('export-rows-display');
  if (rowsDisplay) rowsDisplay.textContent = rows;

  // Show preview info
  preview.innerHTML = `
    <div class="preview-info">
      <p><strong>${nonDeleted.length}</strong> frames</p>
      <p><strong>${columns}</strong> columns × <strong>${rows}</strong> rows</p>
      <p>Padding: <strong>${padding}px</strong></p>
    </div>
  `;
}

async function getEditedFrameDataUrls(nonDeletedFrames) {
  const out = [];
  for (let i = 0; i < nonDeletedFrames.length; i++) {
    const frame = nonDeletedFrames[i];
    let bitmap = frameExtractor.getFrameFromCache(frame.index);
    if (!bitmap) bitmap = await frameExtractor.extractFrame(frame.index);
    const editedBitmap = await applyEditsToImage(bitmap, frame.edits);
    const canvas = document.createElement('canvas');
    canvas.width = editedBitmap.width;
    canvas.height = editedBitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(editedBitmap, 0, 0);
    out.push(canvas.toDataURL('image/png'));
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

/** Returns a bitmap for export: uses rmbg image if set, otherwise extracted frame + edits. */
async function getFrameBitmapForExport(frame) {
  if (frame.rmbgImageUrl) {
    const base = window.location.origin;
    const url = frame.rmbgImageUrl.startsWith('http') ? frame.rmbgImageUrl : base + frame.rmbgImageUrl;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch frame image');
    const blob = await res.blob();
    return createImageBitmap(blob);
  }
  let bitmap = frameExtractor.getFrameFromCache(frame.index);
  if (!bitmap) bitmap = await frameExtractor.extractFrame(frame.index);
  return applyEditsToImage(bitmap, frame.edits);
}

async function pollRmbgUntilComplete(promptId, progressBar, progressText) {
  const pollMs = 800;
  for (; ;) {
    const status = await getGenerationStatus(promptId);
    if (!status) {
      await new Promise((r) => setTimeout(r, pollMs));
      continue;
    }
    if (status.type === 'complete' && status.images?.length) {
      const urls = status.images.filter(Boolean);
      urls.sort((a, b) => (a.split('/').pop() || '').localeCompare(b.split('/').pop() || ''));
      return urls;
    }
    if (progressText) progressText.textContent = status.type === 'progress' ? 'RMBG processing...' : 'Waiting for RMBG...';
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

async function exportAsPictures(nonDeletedFrames, progressBar, progressText, options = {}) {
  const JSZip = typeof window !== 'undefined' ? window.JSZip : null;
  if (!JSZip) {
    alert('JSZip is required to export pictures as zip. Please refresh the page.');
    return;
  }

  const { backgroundColor, format, quality, includeMetadata, outputFilename } = editorState.exportSettings;
  const backgroundColorForMetadata = options.backgroundColorForMetadata ?? null;
  const ext = format === 'webp' ? 'webp' : 'png';
  const padLen = Math.max(3, String(nonDeletedFrames.length).length);
  const baseName = (outputFilename || 'frames').replace(/\.[^.]+$/, '');
  const zip = new JSZip();

  const metadata = {
    version: '1.0',
    exportType: 'pictures',
    fps: editorState.fps,
    frameCount: nonDeletedFrames.length,
    sourceVideo: {
      id: editorState.videoId,
      name: editorState.spriteName,
    },
    format: ext,
    frames: [],
    generatedAt: new Date().toISOString(),
  };
  if (backgroundColorForMetadata != null) {
    metadata.backgroundColor = backgroundColorForMetadata;
  }

  let frameWidth = 0;
  let frameHeight = 0;

  for (let i = 0; i < nonDeletedFrames.length; i++) {
    const frame = nonDeletedFrames[i];
    if (progressBar) progressBar.style.width = ((i + 1) / nonDeletedFrames.length * 100) + '%';
    if (progressText) progressText.textContent = `Exporting frame ${i + 1} of ${nonDeletedFrames.length}...`;

    const editedBitmap = await getFrameBitmapForExport(frame);
    frameWidth = editedBitmap.width;
    frameHeight = editedBitmap.height;

    const canvas = document.createElement('canvas');
    canvas.width = frameWidth;
    canvas.height = frameHeight;
    const ctx = canvas.getContext('2d');
    if (backgroundColor === 'transparent') {
      ctx.clearRect(0, 0, frameWidth, frameHeight);
    } else {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, frameWidth, frameHeight);
    }
    ctx.drawImage(editedBitmap, 0, 0);

    const mimeType = format === 'webp' ? 'image/webp' : 'image/png';
    const qualityValue = format === 'webp' ? quality / 100 : undefined;
    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, mimeType, qualityValue);
    });

    const frameNum = String(i).padStart(padLen, '0');
    const filename = `${baseName}_frame_${frameNum}.${ext}`;
    zip.file(filename, blob);

    metadata.frames.push({
      index: i,
      originalIndex: frame.index,
      filename,
      width: frameWidth,
      height: frameHeight,
    });

    await new Promise((r) => setTimeout(r, 0));
  }

  if (includeMetadata) {
    zip.file(`${baseName}.json`, JSON.stringify(metadata, null, 2));
  }

  if (progressText) progressText.textContent = 'Creating zip...';
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(zipBlob, `${baseName}.zip`);
}

async function generateSpriteSheet() {
  if (!editorState || !frameExtractor) return;

  const nonDeletedFrames = editorState.frames.filter(f => !f.isDeleted);
  const exportMode = editorState.exportSettings.exportMode || 'spriteSheet';

  if (nonDeletedFrames.length === 0) {
    alert('No frames to export. All frames are deleted.');
    return;
  }

  const progressModal = document.getElementById('export-progress-modal');
  const progressBar = document.getElementById('export-progress-bar');
  const progressBarWrap = document.getElementById('export-progress-bar-wrap');
  const progressSpinnerWrap = document.getElementById('export-progress-spinner-wrap');
  const progressText = document.getElementById('export-progress-text');
  const progressTitle = document.getElementById('export-progress-title');

  if (progressModal) progressModal.style.display = 'flex';
  if (progressBarWrap) progressBarWrap.style.display = '';
  if (progressSpinnerWrap) progressSpinnerWrap.style.display = 'none';
  if (progressTitle) progressTitle.textContent = exportMode === 'pictures' ? 'Exporting pictures' : 'Exporting sprite sheet';
  if (progressText) progressText.textContent = 'Preparing export...';

  try {
    if (exportMode === 'pictures') {
      await exportAsPictures(nonDeletedFrames, progressBar, progressText, { backgroundColorForMetadata: null });
      if (progressText) progressText.textContent = 'Export complete!';
      setTimeout(() => { if (progressModal) progressModal.style.display = 'none'; }, 1000);
      return;
    }
  } catch (err) {
    console.error('Export failed:', err);
    alert('Export failed: ' + err.message);
    if (progressModal) progressModal.style.display = 'none';
    return;
  }

  try {
    if (progressText) progressText.textContent = 'Preparing frames...';
    const { columns, padding, backgroundColor, format, quality, includeMetadata, outputFilename } = editorState.exportSettings;
    const rows = Math.ceil(nonDeletedFrames.length / columns);

    const firstBitmap = await getFrameBitmapForExport(nonDeletedFrames[0]);
    const frameWidth = firstBitmap.width;
    const frameHeight = firstBitmap.height;
    firstBitmap.close();

    const totalWidth = columns * frameWidth + (columns - 1) * padding;
    const totalHeight = rows * frameHeight + (rows - 1) * padding;

    const canvas = document.createElement('canvas');
    canvas.width = totalWidth;
    canvas.height = totalHeight;
    const ctx = canvas.getContext('2d');

    if (backgroundColor === 'transparent') {
      ctx.clearRect(0, 0, totalWidth, totalHeight);
    } else {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, totalWidth, totalHeight);
    }

    const metadata = {
      version: '1.0',
      fps: editorState.fps,
      frameCount: nonDeletedFrames.length,
      sourceVideo: {
        id: editorState.videoId,
        name: editorState.spriteName,
      },
      spriteSheet: {
        width: totalWidth,
        height: totalHeight,
        format,
        frameWidth,
        frameHeight,
        columns,
        rows,
        padding,
      },
      frames: [],
      generatedAt: new Date().toISOString(),
    };

    for (let i = 0; i < nonDeletedFrames.length; i++) {
      const frame = nonDeletedFrames[i];

      // Update progress
      if (progressBar) progressBar.style.width = ((i + 1) / nonDeletedFrames.length * 100) + '%';
      if (progressText) progressText.textContent = `Processing frame ${i + 1} of ${nonDeletedFrames.length}...`;

      const editedBitmap = await getFrameBitmapForExport(frame);
      const col = i % columns;
      const row = Math.floor(i / columns);
      const x = col * (frameWidth + padding);
      const y = row * (frameHeight + padding);
      ctx.drawImage(editedBitmap, x, y, frameWidth, frameHeight);
      editedBitmap.close();

      // Record metadata (no duration per frame)
      metadata.frames.push({
        index: i,
        originalIndex: frame.index,
        x,
        y,
        width: frameWidth,
        height: frameHeight,
      });

      // Yield to UI
      await new Promise(r => setTimeout(r, 0));
    }

    if (progressText) progressText.textContent = 'Generating output files...';

    // Convert to blob
    const mimeType = format === 'webp' ? 'image/webp' : 'image/png';
    const qualityValue = format === 'webp' ? quality / 100 : undefined;

    const blob = await new Promise(resolve => {
      canvas.toBlob(resolve, mimeType, qualityValue);
    });

    downloadBlob(blob, `${outputFilename}.${format}`);

    if (includeMetadata) {
      const metadataBlob = new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' });
      downloadBlob(metadataBlob, `${outputFilename}.json`);
    }

    if (progressText) progressText.textContent = 'Export complete!';
    setTimeout(() => {
      if (progressModal) progressModal.style.display = 'none';
    }, 1000);

  } catch (err) {
    console.error('Export failed:', err);
    alert('Export failed: ' + err.message);
    if (progressModal) progressModal.style.display = 'none';
  }
}

async function applyEditsToImage(bitmap, edits) {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((edits.transform.rotation * Math.PI) / 180);
  ctx.scale(
    edits.transform.flipX ? -1 : 1,
    edits.transform.flipY ? -1 : 1
  );
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  ctx.restore();

  return await createImageBitmap(canvas);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function renderFrameEditorUI() {
  const container = editorEl();
  if (!container) return;

  container.innerHTML = `
    <div class="frame-editor-layout">
      <div class="frame-editor-header">
        <button type="button" class="btn btn-ghost btn-icon" id="editor-back-btn" title="Back to videos">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5"></path><path d="M12 19l-7-7 7-7"></path></svg>
        </button>
        <h2 id="editor-title">Frame Editor</h2>
      </div>

      <div class="frame-editor-main">
        <div class="frame-preview-section">
          <div class="frame-canvas-container">
            <canvas id="frame-canvas" width="768" height="768"></canvas>
            <div id="frame-canvas-placeholder" class="frame-canvas-placeholder" style="display: none;">
              <div class="spinner"></div>
              <span>Loading frame...</span>
            </div>
            <div id="frame-deleted-overlay" class="frame-deleted-overlay" style="display: none;">
              <span>DELETED</span>
            </div>
          </div>

          <div class="timeline-section">
            <div id="frame-timeline" class="frame-timeline"></div>
          </div>

          <div class="playback-controls">
            <button type="button" class="btn btn-secondary btn-icon" id="frame-first-btn" title="First frame (Home)">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h2v16H6z"/><path d="M18 12L10 6v12z"/></svg>
            </button>
            <button type="button" class="btn btn-secondary btn-icon" id="frame-prev-btn" title="Previous frame (←)">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M15 19l-7-7 7-7z"/></svg>
            </button>
            <button type="button" class="btn btn-primary btn-icon" id="frame-play-btn" title="Play/Pause (Space)">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"></polygon></svg>
            </button>
            <button type="button" class="btn btn-secondary btn-icon" id="frame-next-btn" title="Next frame (→)">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M9 5l7 7-7 7z"/></svg>
            </button>
            <button type="button" class="btn btn-secondary btn-icon" id="frame-last-btn" title="Last frame (End)">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M16 4h2v16h-2z"/><path d="M6 12l8-6v12z"/></svg>
            </button>
            <div class="frame-counter-group">
              <span id="frame-counter">Frame 1 / 1</span>
              <span id="deleted-frame-counter" class="deleted-counter"></span>
            </div>
          </div>
        </div>

        <div class="frame-editor-sidebar">
          <div class="editor-panel">
            <h3 class="panel-title">Frame Actions</h3>
            <button type="button" class="btn btn-danger btn-full" id="frame-delete-btn">Delete Frame</button>
          </div>

          <div class="editor-panel">
            <h3 class="panel-title">Transform</h3>
            <div class="transform-buttons">
              <button type="button" class="btn btn-secondary btn-toggle" id="edit-flip-x" title="Flip Horizontal">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v18"></path><path d="M16 7l4 5-4 5"></path><path d="M8 7l-4 5 4 5"></path></svg>
                Flip X
              </button>
              <button type="button" class="btn btn-secondary btn-toggle" id="edit-flip-y" title="Flip Vertical">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18"></path><path d="M7 8l5-4 5 4"></path><path d="M7 16l5 4 5-4"></path></svg>
                Flip Y
              </button>
            </div>
            <label>
              <span class="label-text">Rotation</span>
              <select id="edit-rotation" class="input-select">
                <option value="0">0°</option>
                <option value="90">90°</option>
                <option value="180">180°</option>
                <option value="270">270°</option>
              </select>
            </label>
          </div>

          <div class="editor-panel">
            <h3 class="panel-title">RMBG</h3>
            <div class="setting-item">
              <span class="label-text">Background</span>
              <div class="color-picker-row">
                <div class="segmented-control segmented-control-small">
                  <label class="segment">
                    <input type="radio" name="rmbg-bg" value="transparent" checked>
                    <span class="segment-label">Transparent</span>
                  </label>
                  <label class="segment">
                    <input type="radio" name="rmbg-bg" value="solid">
                    <span class="segment-label">Solid</span>
                  </label>
                </div>
                <div class="color-picker-container">
                  <input type="color" id="rmbg-bg-color" value="#000000" disabled>
                  <span class="color-value" id="rmbg-bg-color-value">#000000</span>
                </div>
              </div>
            </div>
            <div class="rmbg-actions">
              <button type="button" class="btn btn-secondary btn-small" id="rmbg-current-frame-btn" title="Remove background from the selected frame only">RMBG frame</button>
              <button type="button" class="btn btn-secondary btn-small" id="rmbg-all-frames-btn" title="Remove background from all frames">RMBG all</button>
              <button type="button" class="btn btn-ghost btn-small" id="rmbg-revert-current-btn" title="Revert the selected frame to before RMBG">Revert frame</button>
              <button type="button" class="btn btn-ghost btn-small" id="rmbg-revert-all-btn" title="Revert all frames to before RMBG">Revert all</button>
            </div>
          </div>

          <div class="editor-panel">
            <h3 class="panel-title">Sprite Sheet Export</h3>
            <div class="columns-rows-row">
              <label class="columns-rows-group">
                <span class="label-text">Columns</span>
                <input type="number" id="export-columns" min="1" max="20" value="4">
              </label>
              <label class="columns-rows-group">
                <span class="label-text">Rows</span>
                <span id="export-rows-display" class="rows-value">–</span>
              </label>
            </div>
            <label>
              <span class="label-text">Padding (px)</span>
              <input type="number" id="export-padding" min="0" max="50" value="2">
            </label>
            <div class="setting-item">
              <span class="label-text">Background</span>
              <div class="color-picker-row">
                <div class="segmented-control segmented-control-small">
                  <label class="segment">
                    <input type="radio" name="export-bg" value="transparent" checked>
                    <span class="segment-label">Transparent</span>
                  </label>
                  <label class="segment">
                    <input type="radio" name="export-bg" value="solid">
                    <span class="segment-label">Solid</span>
                  </label>
                </div>
                <div class="color-picker-container">
                  <input type="color" id="export-bg-color" value="#000000" disabled>
                  <span class="color-value" id="export-bg-color-value">#000000</span>
                </div>
              </div>
            </div>
            <label>
              <span class="label-text">Format</span>
              <select id="export-format" class="input-select">
                <option value="png">PNG</option>
                <option value="webp">WebP</option>
              </select>
            </label>
            <label>
              <span class="label-text">Filename</span>
              <input type="text" id="export-filename" placeholder="filename">
            </label>
            <div class="setting-item">
              <span class="label-text">Export as</span>
              <div class="segmented-control">
                <label class="segment">
                  <input type="radio" name="export-mode" value="spriteSheet" checked>
                  <span class="segment-label">Sprite sheet</span>
                </label>
                <label class="segment">
                  <input type="radio" name="export-mode" value="pictures">
                  <span class="segment-label">Pictures</span>
                </label>
              </div>
            </div>
            <label class="checkbox-label">
              <input type="checkbox" id="export-metadata" checked>
              <span class="label-text">Include JSON metadata</span>
            </label>
            <div id="spritesheet-preview" class="spritesheet-preview"></div>
            <button type="button" class="btn btn-primary btn-full" id="export-btn">Export</button>
          </div>
        </div>
      </div>
    </div>

    <div id="export-progress-modal" class="progress-modal" style="display: none;">
      <div class="progress-content">
        <h3 id="export-progress-title">Exporting</h3>
        <div id="export-progress-bar-wrap" class="progress-bar-container">
          <div id="export-progress-bar" class="progress-bar"></div>
        </div>
        <div id="export-progress-spinner-wrap" class="export-progress-spinner-wrap" style="display: none;">
          <div class="spinner"></div>
        </div>
        <p id="export-progress-text">Preparing...</p>
      </div>
    </div>
  `;
}

function getRmbgBackgroundColor() {
  const radio = document.querySelector('input[name="rmbg-bg"]:checked');
  if (radio?.value === 'transparent') return 'transparent';
  const colorInput = document.getElementById('rmbg-bg-color');
  return colorInput?.value || '#000000';
}

function setupRmbgButtons() {
  const rmbgCurrentBtn = document.getElementById('rmbg-current-frame-btn');
  const rmbgAllBtn = document.getElementById('rmbg-all-frames-btn');
  const revertCurrentBtn = document.getElementById('rmbg-revert-current-btn');
  const revertAllBtn = document.getElementById('rmbg-revert-all-btn');
  const progressModal = document.getElementById('export-progress-modal');
  const progressText = document.getElementById('export-progress-text');
  const progressSpinnerWrap = document.getElementById('export-progress-spinner-wrap');
  const progressBarWrap = document.getElementById('export-progress-bar-wrap');

  const rmbgBgRadios = document.querySelectorAll('input[name="rmbg-bg"]');
  const rmbgBgColorInput = document.getElementById('rmbg-bg-color');
  const rmbgBgColorValue = document.getElementById('rmbg-bg-color-value');
  const rmbgBgColorContainer = rmbgBgColorInput?.closest('.color-picker-container');
  if (rmbgBgRadios.length && rmbgBgColorInput && rmbgBgColorContainer) {
    rmbgBgRadios.forEach((radio) => {
      radio.addEventListener('change', () => {
        if (radio.value === 'transparent') {
          rmbgBgColorInput.disabled = true;
          rmbgBgColorContainer.style.opacity = '0.5';
        } else {
          rmbgBgColorInput.disabled = false;
          rmbgBgColorContainer.style.opacity = '1';
        }
      });
    });
    if (document.querySelector('input[name="rmbg-bg"]:checked')?.value === 'transparent') {
      rmbgBgColorInput.disabled = true;
      rmbgBgColorContainer.style.opacity = '0.5';
    }
  }
  if (rmbgBgColorInput && rmbgBgColorValue) {
    rmbgBgColorInput.addEventListener('input', (e) => {
      rmbgBgColorValue.textContent = (e.target.value || '#000000').toUpperCase();
    });
  }

  async function runRmbgCurrentFrame() {
    if (!editorState || !frameExtractor) return;
    const frame = editorState.frames[editorState.currentFrameIndex];
    if (frame.isDeleted) {
      alert('Cannot RMBG a deleted frame. Restore it first.');
      return;
    }
    if (progressModal) progressModal.style.display = 'flex';
    if (progressBarWrap) progressBarWrap.style.display = 'none';
    if (progressSpinnerWrap) progressSpinnerWrap.style.display = 'flex';
    if (progressText) progressText.textContent = 'Preparing frame...';
    try {
      const dataUrls = await getEditedFrameDataUrls([frame]);
      if (progressText) progressText.textContent = 'Running RMBG...';
      const backgroundColor = getRmbgBackgroundColor();
      const { promptId } = await exportRmbg(dataUrls, backgroundColor);
      if (progressText) progressText.textContent = 'Processing...';
      const urls = await pollRmbgUntilComplete(promptId, null, progressText);
      if (urls.length > 0) {
        if (frame._rmbgBitmap) {
          frame._rmbgBitmap.close();
          frame._rmbgBitmap = null;
        }
        frame.rmbgImageUrl = urls[0];
        renderCurrentFrame();
      }
    } catch (err) {
      alert('RMBG failed: ' + (err.message || 'Unknown error'));
    } finally {
      if (progressModal) progressModal.style.display = 'none';
      if (progressSpinnerWrap) progressSpinnerWrap.style.display = 'none';
      if (progressBarWrap) progressBarWrap.style.display = '';
    }
  }

  async function runRmbgAllFrames() {
    if (!editorState || !frameExtractor) return;
    const nonDeleted = editorState.frames.filter(f => !f.isDeleted);
    if (nonDeleted.length === 0) {
      alert('No frames to process. Restore at least one frame.');
      return;
    }
    if (progressModal) progressModal.style.display = 'flex';
    if (progressBarWrap) progressBarWrap.style.display = 'none';
    if (progressSpinnerWrap) progressSpinnerWrap.style.display = 'flex';
    if (progressText) progressText.textContent = 'Preparing frames...';
    try {
      const dataUrls = await getEditedFrameDataUrls(nonDeleted);
      if (progressText) progressText.textContent = 'Uploading and running RMBG...';
      const backgroundColor = getRmbgBackgroundColor();
      const { promptId } = await exportRmbg(dataUrls, backgroundColor);
      if (progressText) progressText.textContent = 'Processing RMBG...';
      const urls = await pollRmbgUntilComplete(promptId, null, progressText);
      for (let i = 0; i < nonDeleted.length && i < urls.length; i++) {
        const f = nonDeleted[i];
        if (f._rmbgBitmap) {
          f._rmbgBitmap.close();
          f._rmbgBitmap = null;
        }
        f.rmbgImageUrl = urls[i];
      }
      renderCurrentFrame();
      renderTimeline();
    } catch (err) {
      alert('RMBG failed: ' + (err.message || 'Unknown error'));
    } finally {
      if (progressModal) progressModal.style.display = 'none';
      if (progressSpinnerWrap) progressSpinnerWrap.style.display = 'none';
      if (progressBarWrap) progressBarWrap.style.display = '';
    }
  }

  function runRevertCurrentFrame() {
    if (!editorState) return;
    const frame = editorState.frames[editorState.currentFrameIndex];
    if (frame._rmbgBitmap) {
      frame._rmbgBitmap.close();
      frame._rmbgBitmap = null;
    }
    frame.rmbgImageUrl = null;
    renderCurrentFrame();
  }

  function runRevertAll() {
    if (!editorState) return;
    editorState.frames.forEach((f) => {
      if (f._rmbgBitmap) {
        f._rmbgBitmap.close();
        f._rmbgBitmap = null;
      }
      f.rmbgImageUrl = null;
    });
    renderCurrentFrame();
    renderTimeline();
  }

  if (rmbgCurrentBtn) rmbgCurrentBtn.addEventListener('click', runRmbgCurrentFrame);
  if (rmbgAllBtn) rmbgAllBtn.addEventListener('click', runRmbgAllFrames);
  if (revertCurrentBtn) revertCurrentBtn.addEventListener('click', runRevertCurrentFrame);
  if (revertAllBtn) revertAllBtn.addEventListener('click', runRevertAll);
}

function setupEditorEventListeners() {
  document.getElementById('editor-back-btn')?.addEventListener('click', closeFrameEditor);
  document.getElementById('frame-play-btn')?.addEventListener('click', togglePlayback);
  document.getElementById('frame-prev-btn')?.addEventListener('click', prevFrame);
  document.getElementById('frame-next-btn')?.addEventListener('click', nextFrame);
  document.getElementById('frame-first-btn')?.addEventListener('click', goToFirstFrame);
  document.getElementById('frame-last-btn')?.addEventListener('click', goToLastFrame);

  document.getElementById('frame-delete-btn')?.addEventListener('click', toggleDeleteCurrentFrame);

  document.getElementById('edit-flip-x')?.addEventListener('click', () => {
    const frame = editorState?.frames[editorState.currentFrameIndex];
    if (frame) {
      updateFrameEdit('transform.flipX', !frame.edits.transform.flipX);
      document.getElementById('edit-flip-x')?.classList.toggle('active');
    }
  });

  document.getElementById('edit-flip-y')?.addEventListener('click', () => {
    const frame = editorState?.frames[editorState.currentFrameIndex];
    if (frame) {
      updateFrameEdit('transform.flipY', !frame.edits.transform.flipY);
      document.getElementById('edit-flip-y')?.classList.toggle('active');
    }
  });

  document.getElementById('edit-rotation')?.addEventListener('change', (e) => {
    updateFrameEdit('transform.rotation', parseInt(e.target.value, 10));
  });

  document.getElementById('export-columns')?.addEventListener('input', (e) => {
    updateExportSetting('columns', parseInt(e.target.value, 10) || 4);
  });

  document.getElementById('export-padding')?.addEventListener('input', (e) => {
    updateExportSetting('padding', parseInt(e.target.value, 10) || 0);
  });

  document.querySelectorAll('input[name="export-bg"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const colorInput = document.getElementById('export-bg-color');
      const colorContainer = colorInput?.closest('.color-picker-container');
      if (e.target.value === 'transparent') {
        updateExportSetting('backgroundColor', 'transparent');
        if (colorInput) colorInput.disabled = true;
        if (colorContainer) colorContainer.style.opacity = '0.5';
      } else {
        const color = colorInput?.value || '#000000';
        updateExportSetting('backgroundColor', color);
        if (colorInput) colorInput.disabled = false;
        if (colorContainer) colorContainer.style.opacity = '1';
      }
    });
  });

  document.getElementById('export-bg-color')?.addEventListener('input', (e) => {
    updateExportSetting('backgroundColor', e.target.value);
    const colorValue = document.getElementById('export-bg-color-value');
    if (colorValue) colorValue.textContent = e.target.value.toUpperCase();
  });

  document.getElementById('export-format')?.addEventListener('change', (e) => {
    updateExportSetting('format', e.target.value);
  });

  document.getElementById('export-filename')?.addEventListener('input', (e) => {
    updateExportSetting('outputFilename', e.target.value || 'spritesheet');
  });

  document.getElementById('export-metadata')?.addEventListener('change', (e) => {
    updateExportSetting('includeMetadata', e.target.checked);
  });

  document.querySelectorAll('input[name="export-mode"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      updateExportSetting('exportMode', e.target.value);
    });
  });

  document.getElementById('export-btn')?.addEventListener('click', generateSpriteSheet);

  setupRmbgButtons();

  document.addEventListener('keydown', handleKeydown);
}

function handleKeydown(e) {
  if (!editorState) return;

  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  switch (e.key) {
    case ' ':
      e.preventDefault();
      togglePlayback();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      pausePlayback();
      prevFrame();
      break;
    case 'ArrowRight':
      e.preventDefault();
      pausePlayback();
      nextFrame();
      break;
    case 'Home':
      e.preventDefault();
      pausePlayback();
      goToFirstFrame();
      break;
    case 'End':
      e.preventDefault();
      pausePlayback();
      goToLastFrame();
      break;
    case 'Delete':
    case 'Backspace':
      e.preventDefault();
      toggleDeleteCurrentFrame();
      break;
    case '[':
      e.preventDefault();
      pausePlayback();
      prevFrame();
      break;
    case ']':
      e.preventDefault();
      pausePlayback();
      nextFrame();
      break;
    case 'Escape':
      e.preventDefault();
      closeFrameEditor();
      break;
  }
}

async function openFrameEditor(video) {
  videoElement = document.createElement('video');
  videoElement.src = video.videoUrl;
  videoElement.muted = true;
  videoElement.playsInline = true;
  videoElement.crossOrigin = 'anonymous';

  await new Promise((resolve, reject) => {
    videoElement.onloadedmetadata = resolve;
    videoElement.onerror = () => reject(new Error('Failed to load video'));
  });

  const fps = video.fps || 16;
  const totalFrames = Math.ceil(videoElement.duration * fps);

  editorState = createEditorState(video, totalFrames);
  frameExtractor = new FrameExtractor(videoElement, fps, totalFrames);

  renderFrameEditorUI();
  setupEditorEventListeners();

  const list = listEl();
  const editor = editorEl();
  if (list) list.style.display = 'none';
  if (editor) editor.style.display = 'block';

  const title = document.getElementById('editor-title');
  if (title) title.textContent = `${video.spriteName || 'Video'} - Frame Editor`;

  await goToFrame(0);
  renderTimeline();
  updateExportPreview();
  updateDeleteButton();
  syncEditControlsToCurrentFrame();

  const filenameInput = document.getElementById('export-filename');
  if (filenameInput) {
    filenameInput.value = editorState.exportSettings.outputFilename;
  }
  const exportMode = editorState.exportSettings.exportMode || 'spriteSheet';
  const modeRadio = document.querySelector(`input[name="export-mode"][value="${exportMode}"]`);
  if (modeRadio) modeRadio.checked = true;
  const colorContainer = document.getElementById('export-bg-color')?.closest('.color-picker-container');
  if (colorContainer) {
    colorContainer.style.opacity = '0.5';
  }
}

function closeFrameEditor() {
  pausePlayback();

  if (frameExtractor) {
    frameExtractor.dispose();
    frameExtractor = null;
  }

  if (videoElement) {
    videoElement.pause();
    videoElement.src = '';
    videoElement = null;
  }

  editorState = null;

  document.removeEventListener('keydown', handleKeydown);
  const list = listEl();
  const editor = editorEl();
  if (list) list.style.display = '';
  if (editor) {
    editor.style.display = 'none';
    editor.innerHTML = '';
  }
}

export async function renderSavedVideosList() {
  const container = listEl();
  if (!container) return;

  let list;
  try {
    list = await getSavedVideos();
  } catch {
    container.innerHTML = '<p class="empty-state">Could not load exported videos.</p>';
    return;
  }

  if (list.length === 0) {
    container.innerHTML = '<p class="empty-state">No exported videos yet. Generate a video in the Animate tab and click "Save video".</p>';
    return;
  }

  container.innerHTML = list
    .map(
      (v) => `
    <article class="video-card card" data-video-id="${escapeHtml(v.id)}">
      <div class="card-overlay-top">
        <button type="button" class="btn-icon-small delete-video" data-video-id="${escapeHtml(v.id)}" aria-label="Delete video" title="Delete video">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
        </button>
      </div>
      <div class="card-image video-card-video">
        <video src="${escapeHtml(v.videoUrl)}" muted loop playsinline preload="metadata"></video>
      </div>
      <div class="card-overlay-bottom">
        <h3 class="card-name">${escapeHtml(v.name || v.spriteName || v.characterName || 'Character')}</h3>
        ${v.prompt ? `<p class="video-card-prompt">${escapeHtml(v.prompt.length > 60 ? v.prompt.slice(0, 57) + '…' : v.prompt)}</p>` : ''}
        <span class="video-card-date">${escapeHtml(formatDate(v.createdAt))}</span>
      </div>
    </article>`
    )
    .join('');

  container.querySelectorAll('.video-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      // Ignore if clicking delete button
      if (e.target.closest('.delete-video')) return;

      const videoId = card.dataset.videoId;
      const video = list.find(v => v.id === videoId);
      if (video) {
        openFrameEditor(video);
      }
    });
  });

  container.onclick = async (e) => {
    const btn = e.target.closest('.delete-video');
    if (!btn) return;
    e.stopPropagation();
    const id = btn.dataset.videoId;
    if (!id || !confirm('Delete this video?')) return;
    try {
      await deleteVideo(id);
      await renderSavedVideosList();
    } catch (err) {
      alert('Failed to delete video: ' + err.message);
    }
  };

  container.querySelectorAll('.video-card video').forEach((video) => {
    video.addEventListener('mouseenter', () => video.play().catch(() => { }));
    video.addEventListener('mouseleave', () => {
      video.pause();
      video.currentTime = 0;
    });
  });
}

export function setupVideosTab() { }