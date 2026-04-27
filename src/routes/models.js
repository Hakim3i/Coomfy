const express = require('express');
const { getModels } = require('../services/modelDiscovery');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const force = String(req.query.refresh || '').toLowerCase() === '1' || String(req.query.refresh || '').toLowerCase() === 'true';
    const data = await getModels({ force });
    res.json(data);
  } catch (err) {
    console.error('[Models] discovery error:', err);
    res.status(500).json({ error: err.message, checkpoints: [], diffusionModels: [], loras: [] });
  }
});

module.exports = router;
