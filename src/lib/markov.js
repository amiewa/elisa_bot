'use strict';

var BOS = '__BOS__';
var EOS = '__EOS__';

// =====================================================================
// NGramStore クラス
// =====================================================================

/**
 * N-gram チェーンを保持するストア。
 * 内部構造: Map<prevToken, Map<nextToken, {count, lastUsedAt}>>
 */
function NGramStore() {
  // Map<prevToken, Map<nextToken, {count, lastUsedAt}>>
  this._data = new Map();
  // dirty セット: 変更されたペアのキー "prev\tnext"
  this._dirty = new Map(); // key -> [prevToken, nextToken, count, lastUsedAt]
}

/**
 * スプレッドシート行配列からロードする（ヘッダ行を含まないこと）。
 * @param {Array<Array>} rows [[prevToken, nextToken, count, lastUsedAt], ...]
 */
NGramStore.prototype.load = function (rows) {
  this._data.clear();
  this._dirty.clear();
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (!row || row.length < 4) continue;
    var prev = String(row[0]);
    var next = String(row[1]);
    var count = parseInt(row[2], 10) || 0;
    var lastUsedAt = row[3] ? String(row[3]) : new Date().toISOString();
    if (!prev || !next) continue;
    // Google スプレッドシートのエラーリテラルを含む行はスキップ（#ERROR! 等）
    if (isSheetsError(prev) || isSheetsError(next)) continue;
    if (!this._data.has(prev)) this._data.set(prev, new Map());
    this._data.get(prev).set(next, { count: count, lastUsedAt: lastUsedAt });
  }
};

/**
 * ペアを追加または count を増やす。
 * isNew=false の場合、既存ペアが存在しないなら何もしない（F1 制御）。
 * @param {string} prevToken
 * @param {string} nextToken
 * @param {boolean} [isNew=true]
 */
NGramStore.prototype.add = function (prevToken, nextToken, isNew) {
  if (isNew === undefined) isNew = true;
  var now = new Date().toISOString();
  if (!this._data.has(prevToken)) {
    if (!isNew) return;
    this._data.set(prevToken, new Map());
  }
  var innerMap = this._data.get(prevToken);
  if (!innerMap.has(nextToken)) {
    if (!isNew) return;
    innerMap.set(nextToken, { count: 0, lastUsedAt: now });
  }
  var entry = innerMap.get(nextToken);
  entry.count += 1;
  entry.lastUsedAt = now;
  var key = prevToken + '\t' + nextToken;
  this._dirty.set(key, [prevToken, nextToken, entry.count, entry.lastUsedAt]);
};

/**
 * 次トークン候補リストを返す。
 * @param {string} prevToken
 * @returns {Array<{token: string, count: number}>}
 */
NGramStore.prototype.getNextCandidates = function (prevToken) {
  if (!this._data.has(prevToken)) return [];
  var result = [];
  this._data.get(prevToken).forEach(function (entry, token) {
    if (entry.count > 0) {
      result.push({ token: token, count: entry.count });
    }
  });
  return result;
};

/**
 * スコアが低い順に超過分を削除する（LFU+LRU ハイブリッド）。
 * @param {number} maxRows
 * @param {number} decayFactor
 */
NGramStore.prototype.prune = function (maxRows, decayFactor) {
  // 全ペアをフラットリストに変換
  var entries = [];
  var now = Date.now();
  this._data.forEach(function (innerMap, prev) {
    innerMap.forEach(function (entry, next) {
      var days = (now - new Date(entry.lastUsedAt).getTime()) / 86400000;
      var score = calculateScore(entry.count, days, decayFactor);
      entries.push({ prev: prev, next: next, score: score });
    });
  });

  if (entries.length <= maxRows) return;

  // スコア昇順でソートし、超過分を削除
  entries.sort(function (a, b) { return a.score - b.score; });
  var toDelete = entries.slice(0, entries.length - maxRows);
  for (var i = 0; i < toDelete.length; i++) {
    var item = toDelete[i];
    var innerMap = this._data.get(item.prev);
    if (innerMap) {
      innerMap.delete(item.next);
      if (innerMap.size === 0) this._data.delete(item.prev);
    }
    // count=0 で dirty マークすることでフラッシュ時に削除される
    var key = item.prev + '\t' + item.next;
    this._dirty.set(key, [item.prev, item.next, 0, new Date().toISOString()]);
  }
};

/**
 * dirty エントリをすべて返す（count=0 は削除済みを意味する）。
 * @returns {Array<Array>} [[prevToken, nextToken, count, lastUsedAt], ...]
 */
NGramStore.prototype.getDirtyEntries = function () {
  var result = [];
  this._dirty.forEach(function (row) {
    result.push(row);
  });
  return result;
};

/**
 * 全ペア数を返す。
 */
Object.defineProperty(NGramStore.prototype, 'size', {
  get: function () {
    var total = 0;
    this._data.forEach(function (innerMap) {
      total += innerMap.size;
    });
    return total;
  }
});

// =====================================================================
// 純粋関数
// =====================================================================

/**
 * Google スプレッドシートのエラーリテラル（#ERROR! 等）かどうかを判定する。
 * NGramStore.load でエラーセルをトークンとして取り込まないためのガード。
 * @param {string} token
 * @returns {boolean}
 */
function isSheetsError(token) {
  return /^[#＃](ERROR!|REF!|NAME\?|VALUE!|DIV\/0!|N\/A|NUM!|NULL!|SPILL!|CALC!|GETTING_DATA)$/.test(token);
}

/**
 * LFU+LRU ハイブリッドスコアを計算する。
 * @param {number} count
 * @param {number} lastUsedDays
 * @param {number} decayFactor
 * @returns {number}
 */
function calculateScore(count, lastUsedDays, decayFactor) {
  if (!count || count <= 0) return -Infinity;
  return Math.log(count) - lastUsedDays * decayFactor;
}

/**
 * count 重みの重み付きランダム選択。
 * @param {Array<{token: string, count: number}>} candidates
 * @param {Function} [rng=Math.random]
 * @returns {string|null}
 */
function pickNextToken(candidates, rng) {
  if (!rng) rng = Math.random;
  if (!candidates || candidates.length === 0) return null;
  var total = 0;
  for (var i = 0; i < candidates.length; i++) total += candidates[i].count;
  var r = rng() * total;
  var cumulative = 0;
  for (var j = 0; j < candidates.length; j++) {
    cumulative += candidates[j].count;
    if (r < cumulative) return candidates[j].token;
  }
  return candidates[candidates.length - 1].token;
}

/**
 * トークン化済み文配列を N-gram ストアに学習させる（BOS/EOS 付き bigram）。
 * @param {Array<string[]>} sentencesOfTokens
 * @param {NGramStore} ngramStore
 * @param {boolean} [isNewPairAllowed=true]
 */
function learn(sentencesOfTokens, ngramStore, isNewPairAllowed) {
  if (isNewPairAllowed === undefined) isNewPairAllowed = true;
  for (var i = 0; i < sentencesOfTokens.length; i++) {
    var tokens = sentencesOfTokens[i];
    if (!tokens || tokens.length === 0) continue;
    var chain = [BOS].concat(tokens).concat([EOS]);
    for (var j = 0; j < chain.length - 1; j++) {
      ngramStore.add(chain[j], chain[j + 1], isNewPairAllowed);
    }
  }
}

/**
 * マルコフ連鎖で投稿テキストを生成する。
 * 長さ制御 A1/B1/C1/D2/E2 を適用。
 * @param {NGramStore} ngramStore
 * @param {{sentences_min: number, sentences_max: number, min_length: number, max_length: number, emoji_rate: number}} config
 * @param {string[]} emojis
 * @param {Function} [rng=Math.random]
 * @returns {string|null}
 */
function generate(ngramStore, config, emojis, rng) {
  if (!rng) rng = Math.random;
  var sentences_min = config.sentences_min || 1;
  var sentences_max = config.sentences_max || 5;
  var min_length = config.min_length || 1;
  var max_length = config.max_length || 140;
  var emoji_rate = config.emoji_rate !== undefined ? config.emoji_rate : 20;

  var targetCount = Math.floor(rng() * (sentences_max - sentences_min + 1)) + sentences_min;
  var sentences = [];
  var totalLen = 0;

  for (var s = 0; s < targetCount; s++) {
    var sentence = _generateOneSentence(ngramStore, min_length, max_length - totalLen, rng);
    if (sentence === null) continue; // C1/D2: 生成失敗は skip
    // A1: 最短文字数チェック
    if (sentence.length < min_length) continue;
    // B1: 投稿全体の最大長チェック
    if (totalLen + sentence.length > max_length) break;
    sentences.push(sentence);
    totalLen += sentence.length;
  }

  if (sentences.length === 0) return null;
  return injectEmojis(sentences, emojis, emoji_rate, rng);
}

/**
 * 1文を生成する内部関数。
 * C1: 行き詰まり時は null。D2: 同一トークン3連続で null。
 * @param {NGramStore} ngramStore
 * @param {number} minLen
 * @param {number} maxLen
 * @param {Function} rng
 * @returns {string|null}
 */
function _generateOneSentence(ngramStore, minLen, maxLen, rng) {
  var MAX_TOKENS = 200;
  var tokens = [];
  var current = BOS;
  var retries = 0;
  var MAX_RETRIES = 10;

  while (retries < MAX_RETRIES) {
    var candidates = ngramStore.getNextCandidates(current);
    // C1: 候補なし
    if (candidates.length === 0) return null;

    var next = pickNextToken(candidates, rng);
    if (next === EOS) break;

    // D2: 同一トークン3連続チェック
    if (
      tokens.length >= 2 &&
      tokens[tokens.length - 1] === next &&
      tokens[tokens.length - 2] === next
    ) {
      retries++;
      continue;
    }

    tokens.push(next);
    current = next;

    if (tokens.length >= MAX_TOKENS) break;
  }

  if (tokens.length === 0) return null;
  var text = tokens.join('');
  if (text.length > maxLen) return null;
  return text;
}

/**
 * γ方式絵文字注入: 各文末に独立判定で絵文字を注入し結合した文字列を返す。
 * 文間: 当選=絵文字（区切りなし）、非当選=句点。最終文末: 当選=絵文字、非当選=なし。
 * @param {string[]} sentences
 * @param {string[]} emojis
 * @param {number} rate  0〜100（%）
 * @param {Function} [rng=Math.random]
 * @returns {string}
 */
function injectEmojis(sentences, emojis, rate, rng) {
  if (!rng) rng = Math.random;
  if (!sentences || sentences.length === 0) return '';
  var hasEmojis = emojis && emojis.length > 0;
  var result = '';
  for (var i = 0; i < sentences.length; i++) {
    result += sentences[i];
    var hit = hasEmojis && rng() * 100 < rate;
    if (i < sentences.length - 1) {
      // 文間: 当選=絵文字、非当選=句点
      result += hit ? emojis[Math.floor(rng() * emojis.length)] : '。';
    } else {
      // 最終文末: 当選=絵文字、非当選=なし
      if (hit) result += emojis[Math.floor(rng() * emojis.length)];
    }
  }
  return result;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    NGramStore,
    BOS,
    EOS,
    isSheetsError,
    calculateScore,
    pickNextToken,
    learn,
    generate,
    injectEmojis
  };
}
