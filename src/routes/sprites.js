const express = require('express');
const router = express.Router();
const spriteController = require('../controllers/spriteController');

router.get('/', spriteController.getSprites);
router.post('/', spriteController.createSprite);
router.post('/make', spriteController.makeSprite);
router.get('/status/:promptId', spriteController.getGenerationStatus);
router.delete('/:id', spriteController.deleteSprite);
router.put('/:id', spriteController.updateSprite);
router.post('/:id/flip', spriteController.flipSprite);

router.post('/:id/edits/generate', spriteController.generateEdit);
router.post('/:id/animate/generate', spriteController.generateAnimate);
router.post('/:id/edits', spriteController.addEdit);
router.put('/:id/edits/:editId', spriteController.updateEdit);
router.delete('/:id/edits/:editId', spriteController.deleteEdit);

module.exports = router;
