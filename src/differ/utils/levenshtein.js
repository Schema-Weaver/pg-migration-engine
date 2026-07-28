/**
 * Schema Weaver Migration Engine - Schema Differ - Utilities
 * https://schemaweaver.vivekmind.com/
 */

/**
 * Calculate the Levenshtein distance between two strings.
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} - Minimum number of edits to transform a into b
 */
export function levenshtein(a, b) {
  if (!a) return b ? b.length : 0;
  if (!b) return a.length;

  const aLen = a.length;
  const bLen = b.length;

  // Use the shorter string for the outer loop to minimize memory
  if (aLen > bLen) {
    return levenshtein(b, a);
  }

  // Initialize row
  let prevRow = Array.from({ length: aLen + 1 }, (_, i) => i);

  for (let j = 1; j <= bLen; j++) {
    const currRow = [j];
    const bChar = b.charCodeAt(j - 1);

    for (let i = 1; i <= aLen; i++) {
      const aChar = a.charCodeAt(i - 1);
      const cost = aChar === bChar ? 0 : 1;

      currRow[i] = Math.min(
        prevRow[i] + 1,      // deletion
        currRow[i - 1] + 1,  // insertion
        prevRow[i - 1] + cost // substitution
      );
    }

    prevRow = currRow;
  }

  return prevRow[aLen];
}

/**
 * Calculate similarity score between two strings (0-1).
 * Higher values mean more similar.
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} - Similarity score between 0 and 1
 */
export function similarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;

  const distance = levenshtein(a.toLowerCase(), b.toLowerCase());
  const maxLen = Math.max(a.length, b.length);

  return maxLen === 0 ? 1 : 1 - (distance / maxLen);
}

/**
 * Check if two strings are similar enough to be rename candidates.
 * @param {string} a - First string
 * @param {string} b - Second string
 * @param {number} threshold - Minimum similarity threshold (default 0.4)
 * @returns {boolean}
 */
export function isSimilarEnough(a, b, threshold = 0.4) {
  return similarity(a, b) >= threshold;
}

/**
 * Calculate Damerau-Levenshtein distance (includes transpositions).
 * More accurate for detecting typos like "teh" vs "the".
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number}
 */
export function damerauLevenshtein(a, b) {
  if (!a) return b ? b.length : 0;
  if (!b) return a.length;

  const aLen = a.length;
  const bLen = b.length;

  const matrix = Array.from({ length: aLen + 1 }, () =>
    Array.from({ length: bLen + 1 }, (_, j) => j)
  );

  for (let i = 0; i <= aLen; i++) {
    matrix[i][0] = i;
  }

  for (let j = 0; j <= bLen; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= aLen; i++) {
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );

      // Transposition
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + cost);
      }
    }
  }

  return matrix[aLen][bLen];
}

/**
 * Find the best matching string from a list.
 * @param {string} target - String to match
 * @param {string[]} candidates - List of candidate strings
 * @param {number} threshold - Minimum similarity (default 0.4)
 * @returns {{match: string|null, similarity: number}}
 */
export function findBestMatch(target, candidates, threshold = 0.4) {
  let bestMatch = null;
  let bestScore = threshold - 1; // Start below threshold

  for (const candidate of candidates) {
    const score = similarity(target, candidate);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = candidate;
    }
  }

  return { match: bestMatch, similarity: bestMatch };
}

/**
 * Calculate Jaro-Winkler similarity (better for name matching).
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} - Similarity score between 0 and 1
 */
export function jaroWinkler(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;

  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  const aLen = aLower.length;
  const bLen = bLower.length;

  const matchDistance = Math.floor(Math.max(aLen, bLen) / 2) - 1;
  if (matchDistance < 0) return 0;

  const aMatches = new Array(aLen).fill(false);
  const bMatches = new Array(bLen).fill(false);

  let matches = 0;
  let transpositions = 0;

  // Find matches
  for (let i = 0; i < aLen; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, bLen);

    for (let j = start; j < end; j++) {
      if (bMatches[j] || aLower[i] !== bLower[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  // Count transpositions
  let k = 0;
  for (let i = 0; i < aLen; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (aLower[i] !== bLower[k]) transpositions++;
    k++;
  }

  // Jaro similarity
  const jaro = (
    matches / aLen +
    matches / bLen +
    (matches - transpositions / 2) / matches
  ) / 3;

  // Winkler modification (boost for common prefix)
  let prefix = 0;
  const maxPrefix = Math.min(4, aLen, bLen);
  for (let i = 0; i < maxPrefix && aLower[i] === bLower[i]; i++) {
    prefix++;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}
