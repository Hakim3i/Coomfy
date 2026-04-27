const fs = require('fs');
const path = require('path');
const { stripIsFlipped } = require('./helpers');

const DATA_DIR = path.join(__dirname, '../../data');
const SPRITES_FILE = path.join(DATA_DIR, 'sprites.json');
const SAVED_VIDEOS_FILE = path.join(DATA_DIR, 'savedVideos.json');

const ensureDataDir = () => {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
};

const readSprites = () => {
    try {
        ensureDataDir();
        if (!fs.existsSync(SPRITES_FILE)) return [];
        const raw = fs.readFileSync(SPRITES_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (error) {
        console.error('Error reading sprites:', error);
        return [];
    }
};

const writeSprites = (list) => {
    try {
        ensureDataDir();
        const cleaned = list.map(stripIsFlipped);
        fs.writeFileSync(SPRITES_FILE, JSON.stringify(cleaned, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('Error writing sprites:', error);
        return false;
    }
};

const readSavedVideos = () => {
    try {
        ensureDataDir();
        if (!fs.existsSync(SAVED_VIDEOS_FILE)) return [];
        const raw = fs.readFileSync(SAVED_VIDEOS_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (error) {
        console.error('Error reading saved videos:', error);
        return [];
    }
};

const writeSavedVideos = (list) => {
    try {
        ensureDataDir();
        fs.writeFileSync(SAVED_VIDEOS_FILE, JSON.stringify(list, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('Error writing saved videos:', error);
        return false;
    }
};

module.exports = {
    readSprites,
    writeSprites,
    readSavedVideos,
    writeSavedVideos,
};
