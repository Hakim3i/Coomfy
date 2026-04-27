const express = require('express');
const fs = require('fs');
const path = require('path');
const { getEffectiveConfig, readUserConfig } = require('../utils/configLoader');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '../../data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function writeUserConfig(data) {
  ensureDataDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf8');
}

router.get('/', (req, res) => {
  res.json(getEffectiveConfig());
});

const EDITABLE_KEYS = [
  'defaultBackgroundColor', 'defaultGender', 'defaultSize', 'defaultSpriteType',
  'sizePresets', 'defaultPromptTags', 'defaultPromptTagsObject', 'defaultNegativePrompt',
  'genderPrompts',
];

router.put('/', (req, res) => {
  const body = req.body || {};
  const user = readUserConfig();
  for (const key of EDITABLE_KEYS) {
    if (body[key] !== undefined) user[key] = body[key];
  }
  try {
    writeUserConfig(user);
    const effective = getEffectiveConfig();
    res.json(effective);
  } catch (err) {
    console.error('Error writing config:', err);
    res.status(500).json({ error: err.message || 'Failed to save config' });
  }
});

module.exports = router;
