const fs = require('fs');
const path = require('path');
const config = require('../config');

const DATA_DIR = path.join(__dirname, '../../data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

function readUserConfig() {
  try {
    if (!fs.existsSync(DATA_DIR)) return {};
    if (!fs.existsSync(CONFIG_FILE)) return {};
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function labelsFromPresets(presets) {
  if (!presets || typeof presets !== 'object') return null;
  return {
    small: `${presets.small?.width ?? 0} × ${presets.small?.height ?? 0}`,
    medium: `${presets.medium?.width ?? 0} × ${presets.medium?.height ?? 0}`,
    large: `${presets.large?.width ?? 0} × ${presets.large?.height ?? 0}`,
  };
}

function getEffectiveConfig() {
  const user = readUserConfig();
  const presets = user.sizePresets ?? config.sizePresets;
  const sizeLabels = labelsFromPresets(presets) ?? config.sizeLabels;
  const sizeLabelLandscape = presets && typeof presets === 'object'
    ? { small: `${presets.small?.height ?? 0} × ${presets.small?.width ?? 0}`, medium: `${presets.medium?.height ?? 0} × ${presets.medium?.width ?? 0}`, large: `${presets.large?.height ?? 0} × ${presets.large?.width ?? 0}` }
    : config.sizeLabelLandscape;
  return {
    defaultBackgroundColor: user.defaultBackgroundColor ?? config.defaultBackgroundColor,
    defaultGender: user.defaultGender ?? config.defaultGender,
    defaultSize: user.defaultSize ?? config.defaultSize,
    defaultSpriteType: user.defaultSpriteType ?? config.defaultSpriteType,
    spriteTypes: config.spriteTypes,
    genderPrompts: { ...config.genderPrompts, ...user.genderPrompts },
    sizePresets: presets,
    sizeLabels,
    sizeLabelLandscape,
    defaultPromptTags: user.defaultPromptTags ?? config.defaultPromptTags,
    defaultPromptTagsObject: user.defaultPromptTagsObject ?? config.defaultPromptTagsObject,
    defaultNegativePrompt: user.defaultNegativePrompt ?? config.defaultNegativePrompt,
  };
}

module.exports = { getEffectiveConfig, readUserConfig };
