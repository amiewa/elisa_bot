/**
 * @param {string} text
 * @param {string[]} ngwords
 * @returns {boolean}
 */
function containsNGWord(text, ngwords) {
  if (!text || !ngwords || ngwords.length === 0) return false;
  const lower = text.toLowerCase();
  return ngwords.some((w) => lower.includes(w.toLowerCase()));
}

/**
 * 文字 bigram 集合のジャッカード類似度
 * @param {string} a
 * @param {string} b
 * @returns {number} 0.0 – 1.0
 */
function jaccardSimilarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;

  const toBigrams = (s) => {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };

  const sa = toBigrams(a);
  const sb = toBigrams(b);
  let intersect = 0;
  for (const g of sa) {
    if (sb.has(g)) intersect++;
  }
  const union = sa.size + sb.size - intersect;
  // bigram が生成できない短い文字列(長さ0-1)はそのまま等値比較
  if (union === 0) return a === b ? 1 : 0;
  return intersect / union;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { containsNGWord, jaccardSimilarity };
}
