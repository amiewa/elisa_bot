'use strict';
const { containsNGWord, jaccardSimilarity } = require('../../src/lib/ngwords');

describe('containsNGWord', () => {
  test('一致あり(完全一致)', () => expect(containsNGWord('bad word here', ['bad'])).toBe(true));
  test('一致あり(部分一致)', () => expect(containsNGWord('テスト文章', ['スト'])).toBe(true));
  test('大小文字無視', () => expect(containsNGWord('Hello World', ['hello'])).toBe(true));
  test('一致なし', () => expect(containsNGWord('normal text', ['ng1', 'ng2'])).toBe(false));
  test('空テキスト → false', () => expect(containsNGWord('', ['bad'])).toBe(false));
  test('空リスト → false', () => expect(containsNGWord('bad', [])).toBe(false));
  test('null テキスト → false', () => expect(containsNGWord(null, ['bad'])).toBe(false));
});

describe('jaccardSimilarity', () => {
  test('同一文字列 → 1', () => expect(jaccardSimilarity('abcde', 'abcde')).toBe(1));
  test('完全不一致 → 0', () => expect(jaccardSimilarity('abc', 'xyz')).toBe(0));
  test('両方空文字列 → 1', () => expect(jaccardSimilarity('', '')).toBe(1));
  test('片方空文字列 → 0', () => expect(jaccardSimilarity('abc', '')).toBe(0));
  test('0〜1 の範囲に収まる', () => {
    const s = jaccardSimilarity('今日はいい天気', '今日もいい天気ですね');
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
  test('1文字同士は bigram なし → 0', () => expect(jaccardSimilarity('a', 'b')).toBe(0));
});
