const fs = require('fs');
const path = require('path');

function moveImageToPermanent(sourceRelativePath, destinationDir, filename) {
  if (!sourceRelativePath?.startsWith('/outputs/')) return sourceRelativePath;
  const ext = path.extname(sourceRelativePath) || '.png';
  const finalFilename = filename.endsWith(ext) ? filename : `${filename}${ext}`;
  const rootDir = path.join(__dirname, '../..');
  const tempPath = path.join(rootDir, sourceRelativePath.replace(/^\//, ''));
  const permanentPath = path.join(destinationDir, finalFilename);
  try {
    if (fs.existsSync(tempPath)) {
      if (!fs.existsSync(destinationDir)) fs.mkdirSync(destinationDir, { recursive: true });
      fs.renameSync(tempPath, permanentPath);
      return `/data/sprites/${finalFilename}`;
    }
  } catch (err) {
    console.error('Error moving image:', err);
  }
  return sourceRelativePath;
}

/**
 * Moves a video from outputs/ to destinationDir and renames it to {filename}.mp4.
 * Returns the new URL path (e.g. /data/videos/{uuid}.mp4) or the original path if move fails.
 */
function moveVideoToPermanent(sourceRelativePath, destinationDir, filename) {
  if (!sourceRelativePath?.startsWith('/outputs/')) return sourceRelativePath;
  const ext = path.extname(sourceRelativePath) || '.mp4';
  const finalFilename = filename.endsWith(ext) ? filename : `${filename}${ext}`;
  const rootDir = path.join(__dirname, '../..');
  const tempPath = path.join(rootDir, sourceRelativePath.replace(/^\//, ''));
  const permanentPath = path.join(destinationDir, finalFilename);
  try {
    if (fs.existsSync(tempPath)) {
      if (!fs.existsSync(destinationDir)) fs.mkdirSync(destinationDir, { recursive: true });
      fs.renameSync(tempPath, permanentPath);
      return `/data/videos/${finalFilename}`;
    }
  } catch (err) {
    console.error('Error moving video:', err);
  }
  return sourceRelativePath;
}

module.exports = { moveImageToPermanent, moveVideoToPermanent };
