/* Settings tab: load and save config via data/config.json */

import { putConfig } from './api.js';
import { reloadModels } from './app.js';

function get(id) {
  return document.getElementById(id);
}

function updateSizeSelectLabels(presets, labels) {
  const sel = get('settings-default-size');
  if (!sel) return;
  const lbl = labels || (presets ? { small: `${presets.small?.width ?? 0} × ${presets.small?.height ?? 0}`, medium: `${presets.medium?.width ?? 0} × ${presets.medium?.height ?? 0}`, large: `${presets.large?.width ?? 0} × ${presets.large?.height ?? 0}` } : {});
  ['small', 'medium', 'large'].forEach(k => {
    const opt = sel.querySelector(`option[value="${k}"]`);
    if (opt) opt.textContent = `${k.charAt(0).toUpperCase() + k.slice(1)} (${lbl[k] || '—'})`;
  });
}

export function loadSettingsForm(config) {
  const c = config || {};
  const color = c.defaultBackgroundColor || '#000000';
  const colorInput = get('settings-bg-color');
  const colorText = get('settings-bg-color-text');
  if (colorInput) colorInput.value = color;
  if (colorText) colorText.value = color;

  const genderSelect = get('settings-default-gender');
  if (genderSelect) genderSelect.value = c.defaultGender || 'female';

  const sizeSelect = get('settings-default-size');
  if (sizeSelect) sizeSelect.value = c.defaultSize || 'large';
  updateSizeSelectLabels(c.sizePresets, c.sizeLabels);

  const presets = c.sizePresets || { small: { width: 640, height: 1024 }, medium: { width: 704, height: 1152 }, large: { width: 768, height: 1280 } };
  const setNum = (id, val) => { const el = get(id); if (el) el.value = val != null ? String(val) : ''; };
  setNum('settings-size-small-w', presets.small?.width);
  setNum('settings-size-small-h', presets.small?.height);
  setNum('settings-size-medium-w', presets.medium?.width);
  setNum('settings-size-medium-h', presets.medium?.height);
  setNum('settings-size-large-w', presets.large?.width);
  setNum('settings-size-large-h', presets.large?.height);

  const typeSelect = get('settings-default-sprite-type');
  if (typeSelect) typeSelect.value = c.defaultSpriteType || 'character';

  const promptTags = get('settings-prompt-tags');
  if (promptTags) promptTags.value = c.defaultPromptTags || '';

  const promptTagsObject = get('settings-prompt-tags-object');
  if (promptTagsObject) promptTagsObject.value = c.defaultPromptTagsObject || '';

  const negativePrompt = get('settings-negative-prompt');
  if (negativePrompt) negativePrompt.value = c.defaultNegativePrompt || '';

  const gp = c.genderPrompts || {};
  const maleInput = get('settings-gender-prompt-male');
  if (maleInput) maleInput.value = gp.male || '';
  const femaleInput = get('settings-gender-prompt-female');
  if (femaleInput) femaleInput.value = gp.female || '';
}

function showStatus(message, isError = false) {
  const el = get('settings-status');
  if (!el) return;
  el.textContent = message;
  el.className = 'settings-status' + (isError ? ' settings-status-error' : '');
}

export async function setupSettingsTab(onConfigSaved) {
  const form = get('settings-form');
  const saveBtn = get('settings-save-btn');
  const rebootBtn = get('settings-reboot-btn');

  if (rebootBtn) {
    rebootBtn.addEventListener('click', async () => {
      try {
        rebootBtn.disabled = true;
        showStatus('Rebooting — reloading models from ComfyUI…');
        const { counts, comfyUrl } = await reloadModels();
        const total = counts.checkpoints + counts.diffusionModels + counts.loras;
        if (total === 0) {
          showStatus(`No models discovered from ${comfyUrl || 'ComfyUI'}. Check that it is running and reachable.`, true);
        } else {
          showStatus(`Reloaded: ${counts.checkpoints} checkpoints, ${counts.diffusionModels} diffusion models, ${counts.loras} LoRAs.`);
        }
      } catch (err) {
        showStatus(err?.message || 'Reboot failed.', true);
      } finally {
        rebootBtn.disabled = false;
      }
    });
  }

  const colorInput = get('settings-bg-color');
  const colorText = get('settings-bg-color-text');
  if (colorInput && colorText) {
    colorInput.addEventListener('input', () => { colorText.value = colorInput.value; });
    colorText.addEventListener('input', (e) => {
      const v = e.target.value?.trim();
      if (/^#[0-9A-Fa-f]{6}$/.test(v)) colorInput.value = v;
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const num = (id) => { const v = parseInt(get(id)?.value, 10); return Number.isFinite(v) ? v : undefined; };
      const sizePresets = {
        small: { width: num('settings-size-small-w') ?? 640, height: num('settings-size-small-h') ?? 1024 },
        medium: { width: num('settings-size-medium-w') ?? 704, height: num('settings-size-medium-h') ?? 1152 },
        large: { width: num('settings-size-large-w') ?? 768, height: num('settings-size-large-h') ?? 1280 },
      };

      const payload = {
        defaultBackgroundColor: get('settings-bg-color')?.value || '#000000',
        defaultGender: get('settings-default-gender')?.value || 'female',
        defaultSize: get('settings-default-size')?.value || 'large',
        defaultSpriteType: get('settings-default-sprite-type')?.value || 'character',
        sizePresets,
        defaultPromptTags: get('settings-prompt-tags')?.value?.trim() ?? '',
        defaultPromptTagsObject: get('settings-prompt-tags-object')?.value?.trim() ?? '',
        defaultNegativePrompt: get('settings-negative-prompt')?.value?.trim() ?? '',
        genderPrompts: {
          male: get('settings-gender-prompt-male')?.value?.trim() ?? '',
          female: get('settings-gender-prompt-female')?.value?.trim() ?? '',
        },
      };

      try {
        if (saveBtn) saveBtn.disabled = true;
        showStatus('Saving…');
        const updated = await putConfig(payload);
        showStatus('Saved. Settings applied.');
        if (typeof onConfigSaved === 'function') onConfigSaved(updated);
      } catch (err) {
        showStatus(err.message || 'Failed to save.', true);
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });
  }
}
