const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { readSavedVideos, writeSavedVideos } = require('../utils/dataHandler');
const { moveVideoToPermanent } = require('../utils/fileUtils');

const rootDir = path.join(__dirname, '../..');

function getSavedVideos(req, res) {
  try {
    const list = readSavedVideos();
    res.json(list);
  } catch (err) {
    console.error('getSavedVideos:', err);
    res.status(500).json({ error: 'Failed to load saved videos' });
  }
}

function saveVideo(req, res) {
  try {
    const body = req.body || {};
    const { videoUrl, prompt, fps, frames, name } = body;
    // Support both sprite* and legacy character* field names
    const spriteId = body.spriteId ?? body.characterId ?? null;
    const spriteName = body.spriteName ?? body.characterName ?? '';

    if (!videoUrl || typeof videoUrl !== 'string') {
      return res.status(400).json({ error: 'videoUrl is required' });
    }

    const list = readSavedVideos();
    const id = crypto.randomUUID();
    const permanentVideoUrl = moveVideoToPermanent(
      videoUrl.trim(),
      config.videosDir,
      id
    );

    if (permanentVideoUrl.startsWith('/outputs/')) {
      return res.status(400).json({ error: 'Video file not found. It may have been cleared. Generate the video again and save immediately.' });
    }

    const entry = {
      id,
      videoUrl: permanentVideoUrl,
      spriteId: spriteId || null,
      spriteName: spriteName || '',
      name: typeof name === 'string' ? name.trim() : '',
      prompt: prompt || '',
      fps: typeof fps === 'number' && fps >= 1 && fps <= 60 ? fps : (Number(fps) || 16),
      frames: typeof frames === 'number' && frames >= 1 ? frames : (Number(frames) || null),
      createdAt: new Date().toISOString(),
    };

    list.unshift(entry);

    if (!writeSavedVideos(list)) {
      return res.status(500).json({ error: 'Failed to save video' });
    }

    res.status(201).json(entry);
  } catch (err) {
    console.error('saveVideo:', err);
    res.status(500).json({ error: err.message || 'Failed to save video' });
  }
}

function deleteVideo(req, res) {
  try {
    const { id } = req.params;
    const list = readSavedVideos();
    const index = list.findIndex((v) => v.id === id);
    if (index === -1) {
      return res.status(404).json({ error: 'Video not found' });
    }
    const entry = list[index];
    const videoPath = entry.videoUrl && typeof entry.videoUrl === 'string'
      ? path.join(rootDir, entry.videoUrl.replace(/^\//, ''))
      : path.join(config.videosDir, `${id}.mp4`);
    if (fs.existsSync(videoPath)) {
      fs.unlinkSync(videoPath);
    }
    list.splice(index, 1);
    if (!writeSavedVideos(list)) {
      return res.status(500).json({ error: 'Failed to update list' });
    }
    res.status(204).send();
  } catch (err) {
    console.error('deleteVideo:', err);
    res.status(500).json({ error: err.message || 'Failed to delete video' });
  }
}

module.exports = {
  getSavedVideos,
  saveVideo,
  deleteVideo,
};
