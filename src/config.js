const path = require('path');

const rootDir = path.join(__dirname, '..');

const sizePresets = {
  small: { width: 640, height: 1024 },
  medium: { width: 704, height: 1152 },
  large: { width: 768, height: 1280 },
};

const sizeLabels = {
  small: `${sizePresets.small.width} × ${sizePresets.small.height}`,
  medium: `${sizePresets.medium.width} × ${sizePresets.medium.height}`,
  large: `${sizePresets.large.width} × ${sizePresets.large.height}`,
};

const sizeLabelLandscape = {
  small: `${sizePresets.small.height} × ${sizePresets.small.width}`,
  medium: `${sizePresets.medium.height} × ${sizePresets.medium.width}`,
  large: `${sizePresets.large.height} × ${sizePresets.large.width}`,
};

const genderPrompts = {
  male: process.env.DEFAULT_GENDER_PROMPT_MALE || 'solo, 1boy',
  female: process.env.DEFAULT_GENDER_PROMPT_FEMALE || 'solo, 1girl',
};

const defaultPromptTags =
  process.env.DEFAULT_PROMPT_TAGS ||
  'standing, full_body, side_view, looking_away, simple_background';

const defaultPromptTagsObject =
  process.env.DEFAULT_PROMPT_TAGS_OBJECT ||
  'no_humans, simple_background, centered, game_assets';

const defaultNegativePrompt =
  process.env.DEFAULT_NEGATIVE_PROMPT ||
  'lowres, (worst quality, low quality, bad anatomy, bad hands:1.3), abstract, signature';

/** Available sprite types */
const spriteTypes = [
  { value: 'character', label: 'Character' },
];

const defaultSpriteType = 'character';

module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  /** Bind address. Use 0.0.0.0 for Docker/RunPod so the reverse proxy can reach the app. */
  HOST: process.env.HOST !== undefined && process.env.HOST !== '' ? process.env.HOST : '0.0.0.0',
  COMFY_URL: process.env.COMFY_URL || 'http://127.0.0.1:8188',
  outputsDir: path.join(rootDir, 'outputs'),
  spritesDir: path.join(rootDir, 'data', 'sprites'),
  videosDir: path.join(rootDir, 'data', 'videos'),
  makeWorkflowPath: path.join(rootDir, 'workflows', 'Make.json'),
  editWorkflowPath: path.join(rootDir, 'workflows', 'Edit.json'),
  animateWorkflowPath: path.join(rootDir, 'workflows', 'Animate.json'),
  animateFFLFWorkflowPath: path.join(rootDir, 'workflows', 'AnimateFFLF.json'),
  animatePPWorkflowPath: path.join(rootDir, 'workflows', 'AnimatePP.json'),
  rmbgWorkflowPath: path.join(rootDir, 'workflows', 'RMBG.json'),
  rmbgImagesWorkflowPath: path.join(rootDir, 'workflows', 'RMBG_IMAGES.json'),
  rmbgVideoWorkflowPath: path.join(rootDir, 'workflows', 'RMBG_VIDEO.json'),
  tempExportDir: path.join(rootDir, 'temp_export'),
  defaultAnimateFrames: 81,
  generationTtlMs: 10 * 60 * 1000,
  cleanupIntervalMs: 60 * 1000,

  defaultBackgroundColor: process.env.DEFAULT_BACKGROUND_COLOR || '#000000',
  defaultGender: process.env.DEFAULT_GENDER || 'female',
  defaultSize: process.env.DEFAULT_SIZE || 'large',
  defaultSpriteType,
  spriteTypes,
  genderPrompts,
  sizePresets,
  sizeLabels,
  sizeLabelLandscape,
  defaultPromptTags,
  defaultPromptTagsObject,
  defaultNegativePrompt,
};
