const VALID_PLATFORMS = ['misskey', 'mastodon'];
const VALID_VISIBILITIES = ['public', 'home', 'followers'];
const VALID_TL_TYPES = ['local', 'home', 'hybrid', 'global'];
const VALID_POLLING_INTERVALS = [5, 15, 60];

/**
 * 設定マップを検証してエラーメッセージ配列を返す純粋関数。
 * @param {Object} configMap - key: 設定キー, value: 設定値(文字列)
 * @returns {string[]} エラーメッセージの配列。空なら検証OK
 */
function validateConfigValues(configMap) {
  const errors = [];
  const get = (key) => configMap[key];

  // --- helpers ---
  const checkEnum = (key, values) => {
    const v = get(key);
    if (v !== undefined && !values.includes(v)) {
      errors.push(`${key} は ${values.join(' / ')} のいずれかにしてください (現在: ${v})`);
    }
  };
  const checkInt = (key, min, max) => {
    const raw = get(key);
    if (raw === undefined) return;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      errors.push(`${key} は ${min}〜${max} の整数にしてください (現在: ${raw})`);
    }
  };
  const checkPositiveInt = (key) => {
    const raw = get(key);
    if (raw === undefined) return;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) {
      errors.push(`${key} は 1 以上の整数にしてください (現在: ${raw})`);
    }
  };
  const checkFloat = (key, min, max) => {
    const raw = get(key);
    if (raw === undefined) return;
    const n = Number(raw);
    if (isNaN(n) || n < min || n > max) {
      errors.push(`${key} は ${min}〜${max} の数値にしてください (現在: ${raw})`);
    }
  };
  const checkUrl = (key) => {
    const v = get(key);
    if (!v) {
      errors.push(`${key} は必須です`);
      return;
    }
    if (!/^https?:\/\/.+/.test(v)) {
      errors.push(`${key} が正しい URL 形式ではありません (現在: ${v})`);
      return;
    }
    if (v.endsWith('/')) {
      errors.push(`${key} の末尾スラッシュを取り除いてください`);
    }
  };

  // === BOT ===
  checkEnum('BOT_PLATFORM', VALID_PLATFORMS);

  // === MISSKEY / MASTODON ===
  const platform = get('BOT_PLATFORM');
  if (platform === 'misskey' && get('MISSKEY_INSTANCE')) checkUrl('MISSKEY_INSTANCE');
  if (platform === 'mastodon') {
    if (get('MASTODON_INSTANCE')) checkUrl('MASTODON_INSTANCE');
    const pi = get('MASTODON_POLLING_INTERVAL_MIN');
    if (pi !== undefined && !VALID_POLLING_INTERVALS.includes(Number(pi))) {
      errors.push(
        `MASTODON_POLLING_INTERVAL_MIN は ${VALID_POLLING_INTERVALS.join(' / ')} のいずれかにしてください (現在: ${pi})`
      );
    }
  }

  // === POST ===
  checkEnum('POST_VISIBILITY', VALID_VISIBILITIES);
  checkInt('POST_NIGHT_START', 0, 23);
  checkInt('POST_NIGHT_END', 0, 23);
  checkInt('POST_INTERVAL_MIN_MINUTES', 1, 1440);
  checkInt('POST_CHANCE', 0, 100);
  checkFloat('POST_DUPLICATE_SIMILARITY', 0, 1);
  checkPositiveInt('POST_DUPLICATE_RECENT_COUNT');

  // POST_SENTENCES_MIN <= MAX
  const sMin = Number(get('POST_SENTENCES_MIN'));
  const sMax = Number(get('POST_SENTENCES_MAX'));
  if (get('POST_SENTENCES_MIN') !== undefined) checkPositiveInt('POST_SENTENCES_MIN');
  if (get('POST_SENTENCES_MAX') !== undefined) checkPositiveInt('POST_SENTENCES_MAX');
  if (get('POST_SENTENCES_MIN') !== undefined && get('POST_SENTENCES_MAX') !== undefined) {
    if (Number.isInteger(sMin) && Number.isInteger(sMax) && sMin > sMax) {
      errors.push(`POST_SENTENCES_MIN (${sMin}) は POST_SENTENCES_MAX (${sMax}) 以下にしてください`);
    }
  }

  // === MARKOV ===
  checkPositiveInt('MARKOV_MIN_LENGTH');
  checkPositiveInt('MARKOV_MAX_LENGTH');
  const mMin = Number(get('MARKOV_MIN_LENGTH'));
  const mMax = Number(get('MARKOV_MAX_LENGTH'));
  if (get('MARKOV_MIN_LENGTH') !== undefined && get('MARKOV_MAX_LENGTH') !== undefined) {
    if (Number.isInteger(mMin) && Number.isInteger(mMax) && mMin > mMax) {
      errors.push(`MARKOV_MIN_LENGTH (${mMin}) は MARKOV_MAX_LENGTH (${mMax}) 以下にしてください`);
    }
  }
  checkPositiveInt('MARKOV_MAX_RETRY');
  checkInt('MARKOV_EMOJI_RATE', 0, 100);
  checkEnum('MARKOV_EMOJI_POSITION', ['mixed', 'end']);
  checkInt('MARKOV_EMOJI_MAX_PER_POST', 1, 20);

  // === NGRAM ===
  checkPositiveInt('NGRAM_MAX_ROWS');
  checkPositiveInt('NGRAM_PRUNE_THRESHOLD');
  const ngMax = Number(get('NGRAM_MAX_ROWS'));
  const ngPrune = Number(get('NGRAM_PRUNE_THRESHOLD'));
  if (get('NGRAM_MAX_ROWS') !== undefined && get('NGRAM_PRUNE_THRESHOLD') !== undefined) {
    if (Number.isInteger(ngMax) && Number.isInteger(ngPrune) && ngPrune >= ngMax) {
      errors.push(
        `NGRAM_PRUNE_THRESHOLD (${ngPrune}) は NGRAM_MAX_ROWS (${ngMax}) より小さくしてください`
      );
    }
  }
  checkFloat('NGRAM_PRUNE_DECAY', 0, 1);

  // === LEARN ===
  checkEnum('LEARN_TL_TYPE', VALID_TL_TYPES);
  checkPositiveInt('LEARN_NOTES_PER_TRIGGER');
  checkInt('LEARN_RAW_RETENTION_DAYS', 0, 365);

  // === MORPH ===
  checkPositiveInt('MORPH_URLFETCH_FALLBACK_THRESHOLD');

  // === MENTION ===
  checkPositiveInt('MENTION_MAX_PER_USER_PER_DAY');
  checkPositiveInt('MENTION_GLOBAL_MAX_PER_HOUR');

  // === EMOJI ===
  checkPositiveInt('EMOJI_REFRESH_INTERVAL_DAYS');
  checkPositiveInt('EMOJI_MAX_COUNT');

  // === MAINTENANCE ===
  checkPositiveInt('MAINTENANCE_CLEANUP_DAYS');
  checkPositiveInt('PROCESSED_ID_RETENTION_DAYS');

  return errors;
}

/**
 * 設定値の文字列をブール値に変換する純粋関数。
 * 大文字小文字・前後空白を無視して 'TRUE' と一致すれば true。
 * @param {*} value
 * @param {boolean} [defaultBool=false]
 * @returns {boolean}
 */
function parseBool(value, defaultBool) {
  if (value === undefined || value === null || value === '') return !!defaultBool;
  return String(value).trim().toUpperCase() === 'TRUE';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { validateConfigValues, parseBool };
}
