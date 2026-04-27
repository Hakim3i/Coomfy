const express = require('express');
const router = express.Router();
const videoController = require('../controllers/videoController');

router.get('/', videoController.getSavedVideos);
router.post('/save', videoController.saveVideo);
router.delete('/:id', videoController.deleteVideo);

module.exports = router;
