/**
 * Common helper functions used across controllers and services.
 */

/**
 * Converts a value to a number, returning default if invalid.
 */
function toNum(val, def = -1) {
  if (val === undefined || val === null || isNaN(Number(val))) return def;
  return Number(val);
}

/**
 * Trims a string value or returns null.
 */
function trimOrNull(v) {
  return v && typeof v === 'string' ? v.trim() : null;
}

/**
 * Removes the transient isFlipped property from objects.
 */
function stripIsFlipped(obj) {
  const { isFlipped, ...rest } = obj;
  return rest;
}

/**
 * Normalizes seed input: invalid/empty becomes random to avoid -1 in API.
 */
function parseSeed(value, max = 1e15) {
  if (value === undefined || value === null || value === -1 || (typeof value === 'number' && isNaN(value))) {
    return Math.floor(Math.random() * max);
  }
  return Number(value);
}

module.exports = {
  toNum,
  trimOrNull,
  stripIsFlipped,
  parseSeed,
};
