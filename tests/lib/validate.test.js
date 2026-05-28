'use strict';
const { validateConfigValues, parseBool } = require('../../src/lib/validate');

// デフォルト設定の最小構成（全バリデーションが通るベースライン）
const base = {
  BOT_PLATFORM: 'misskey',
  POST_VISIBILITY: 'home',
  POST_NIGHT_START: '23',
  POST_NIGHT_END: '6',
  POST_INTERVAL_MIN_MINUTES: '30',
  POST_CHANCE: '40',
  POST_DUPLICATE_SIMILARITY: '0.8',
  POST_DUPLICATE_RECENT_COUNT: '100',
  POST_SENTENCES_MIN: '3',
  POST_SENTENCES_MAX: '5',
  MARKOV_MIN_LENGTH: '8',
  MARKOV_MAX_LENGTH: '140',
  MARKOV_MAX_RETRY: '5',
  MARKOV_EMOJI_RATE: '20',
  NGRAM_MAX_ROWS: '50000',
  NGRAM_PRUNE_THRESHOLD: '45000',
  NGRAM_PRUNE_DECAY: '0.05',
  LEARN_TL_TYPE: 'local',
  LEARN_NOTES_PER_TRIGGER: '50',
  LEARN_RAW_RETENTION_DAYS: '7',
  MORPH_URLFETCH_FALLBACK_THRESHOLD: '15000',
  MENTION_MAX_PER_USER_PER_DAY: '10',
  MENTION_GLOBAL_MAX_PER_HOUR: '20',
  EMOJI_REFRESH_INTERVAL_DAYS: '7',
  EMOJI_MAX_COUNT: '500',
  MAINTENANCE_CLEANUP_DAYS: '30',
  PROCESSED_ID_RETENTION_DAYS: '14',
};

const cfg = (overrides = {}) => ({ ...base, ...overrides });
const valid = (overrides = {}) => expect(validateConfigValues(cfg(overrides))).toHaveLength(0);
const invalid = (overrides = {}) => expect(validateConfigValues(cfg(overrides)).length).toBeGreaterThan(0);

describe('validateConfigValues', () => {
  test('デフォルト設定は全PASS', () => valid());

  describe('BOT_PLATFORM', () => {
    test('mastodon → OK', () => valid({ BOT_PLATFORM: 'mastodon' }));
    test('both → NG', () => invalid({ BOT_PLATFORM: 'both' }));
    test('unknown → NG', () => invalid({ BOT_PLATFORM: 'twitter' }));
  });

  describe('POST_VISIBILITY', () => {
    test('public → OK', () => valid({ POST_VISIBILITY: 'public' }));
    test('unlisted → NG', () => invalid({ POST_VISIBILITY: 'unlisted' }));
  });

  describe('POST_CHANCE', () => {
    test('0 → OK', () => valid({ POST_CHANCE: '0' }));
    test('100 → OK', () => valid({ POST_CHANCE: '100' }));
    test('101 → NG', () => invalid({ POST_CHANCE: '101' }));
    test('-1 → NG', () => invalid({ POST_CHANCE: '-1' }));
  });

  describe('POST_SENTENCES', () => {
    test('MIN > MAX → NG', () => invalid({ POST_SENTENCES_MIN: '5', POST_SENTENCES_MAX: '3' }));
    test('MIN = MAX → OK', () => valid({ POST_SENTENCES_MIN: '3', POST_SENTENCES_MAX: '3' }));
    test('MIN=0 → NG', () => invalid({ POST_SENTENCES_MIN: '0' }));
  });

  describe('MARKOV', () => {
    test('MIN_LENGTH > MAX_LENGTH → NG', () =>
      invalid({ MARKOV_MIN_LENGTH: '200', MARKOV_MAX_LENGTH: '100' }));
    test('EMOJI_RATE=100 → OK', () => valid({ MARKOV_EMOJI_RATE: '100' }));
    test('EMOJI_RATE=101 → NG', () => invalid({ MARKOV_EMOJI_RATE: '101' }));
  });

  describe('NGRAM', () => {
    test('PRUNE_THRESHOLD >= MAX_ROWS → NG', () =>
      invalid({ NGRAM_MAX_ROWS: '50000', NGRAM_PRUNE_THRESHOLD: '50000' }));
    test('PRUNE_THRESHOLD < MAX_ROWS → OK', () =>
      valid({ NGRAM_MAX_ROWS: '50000', NGRAM_PRUNE_THRESHOLD: '49999' }));
    test('PRUNE_DECAY=1 → OK', () => valid({ NGRAM_PRUNE_DECAY: '1' }));
    test('PRUNE_DECAY=1.1 → NG', () => invalid({ NGRAM_PRUNE_DECAY: '1.1' }));
  });

  describe('LEARN_TL_TYPE', () => {
    test('hybrid → OK', () => valid({ LEARN_TL_TYPE: 'hybrid' }));
    test('timeline → NG', () => invalid({ LEARN_TL_TYPE: 'timeline' }));
  });

  describe('MASTODON_INSTANCE URL (platform=mastodon)', () => {
    test('valid URL → OK', () =>
      valid({ BOT_PLATFORM: 'mastodon', MASTODON_INSTANCE: 'https://mastodon.social' }));
    test('trailing slash → NG', () =>
      invalid({ BOT_PLATFORM: 'mastodon', MASTODON_INSTANCE: 'https://mastodon.social/' }));
    test('not URL → NG', () =>
      invalid({ BOT_PLATFORM: 'mastodon', MASTODON_INSTANCE: 'not-a-url' }));
  });

  describe('MASTODON_POLLING_INTERVAL_MIN (platform=mastodon)', () => {
    test('15 → OK', () =>
      valid({ BOT_PLATFORM: 'mastodon', MASTODON_POLLING_INTERVAL_MIN: '15' }));
    test('30 → NG(enum外)', () =>
      invalid({ BOT_PLATFORM: 'mastodon', MASTODON_POLLING_INTERVAL_MIN: '30' }));
  });
});

describe('parseBool', () => {
  test("'TRUE' → true", () => expect(parseBool('TRUE')).toBe(true));
  test("'true' → true", () => expect(parseBool('true')).toBe(true));
  test("'True' → true", () => expect(parseBool('True')).toBe(true));
  test("'TRUE ' (末尾空白) → true", () => expect(parseBool('TRUE ')).toBe(true));
  test("' true' (先頭空白) → true", () => expect(parseBool(' true')).toBe(true));
  test("'FALSE' → false", () => expect(parseBool('FALSE')).toBe(false));
  test("'false' → false", () => expect(parseBool('false')).toBe(false));
  test("'' → defaultBool", () => {
    expect(parseBool('', true)).toBe(true);
    expect(parseBool('', false)).toBe(false);
  });
  test('undefined → defaultBool', () => {
    expect(parseBool(undefined, true)).toBe(true);
    expect(parseBool(undefined, false)).toBe(false);
    expect(parseBool(undefined)).toBe(false);
  });
  test('null → defaultBool', () => expect(parseBool(null, true)).toBe(true));
  test("'1' → false (TRUE のみ真)", () => expect(parseBool('1')).toBe(false));
});
