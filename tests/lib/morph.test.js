'use strict';
const { parseYahooResponse, fallbackTokenize } = require('../../src/lib/morph');

describe('parseYahooResponse', () => {
  const makeResponse = (tokens) => ({
    result: { tokens }
  });

  test('正常レスポンスから表層形の配列を返す', () => {
    const resp = makeResponse([
      ['今日', 'キョウ', '今日', '名詞', '普通名詞'],
      ['は', 'ハ', 'は', '助詞', '副助詞'],
      ['いい', 'イイ', 'いい', '形容詞', ''],
    ]);
    expect(parseYahooResponse(resp)).toEqual(['今日', 'は', 'いい']);
  });

  test('品詞「記号」のトークンを除去する', () => {
    const resp = makeResponse([
      ['こんにちは', 'コンニチハ', 'こんにちは', '感動詞', ''],
      ['！', '！', '！', '記号', ''],
    ]);
    expect(parseYahooResponse(resp)).toEqual(['こんにちは']);
  });

  test('品詞「特殊」のトークンを除去する', () => {
    const resp = makeResponse([
      ['。', '。', '。', '特殊', '句点'],
      ['テスト', 'テスト', 'テスト', '名詞', ''],
    ]);
    expect(parseYahooResponse(resp)).toEqual(['テスト']);
  });

  test('複数の除外品詞が混在する場合', () => {
    const resp = makeResponse([
      ['猫', 'ネコ', '猫', '名詞', ''],
      ['、', '、', '、', '記号', ''],
      ['犬', 'イヌ', '犬', '名詞', ''],
      ['。', '。', '。', '特殊', ''],
    ]);
    expect(parseYahooResponse(resp)).toEqual(['猫', '犬']);
  });

  test('result.tokens が存在しない場合は空配列', () => {
    expect(parseYahooResponse({})).toEqual([]);
    expect(parseYahooResponse({ result: {} })).toEqual([]);
  });

  test('null 入力で空配列', () => {
    expect(parseYahooResponse(null)).toEqual([]);
  });

  test('undefined 入力で空配列', () => {
    expect(parseYahooResponse(undefined)).toEqual([]);
  });

  test('tokens が空配列の場合は空配列', () => {
    expect(parseYahooResponse(makeResponse([]))).toEqual([]);
  });

  test('不正な形式のトークン要素をスキップする', () => {
    const resp = makeResponse([
      null,
      ['猫', 'ネコ', '猫', '名詞', ''],
      'invalid',
      ['犬', 'イヌ', '犬', '名詞', ''],
    ]);
    expect(parseYahooResponse(resp)).toEqual(['猫', '犬']);
  });
});

describe('fallbackTokenize', () => {
  test('ひらがなをひとまとめにする', () => {
    const { tokens } = fallbackTokenize('あいうえお');
    expect(tokens).toEqual(['あいうえお']);
  });

  test('文字種の遷移で分割する（ひらがな→カタカナ）', () => {
    const { tokens } = fallbackTokenize('あいうアイウ');
    expect(tokens).toEqual(['あいう', 'アイウ']);
  });

  test('漢字が独立したトークンになる', () => {
    const { tokens } = fallbackTokenize('今日はいい天気');
    expect(tokens.length).toBeGreaterThanOrEqual(3);
    expect(tokens).toContain('今日');
    expect(tokens).toContain('天気');
  });

  test('英数字が独立したトークンになる', () => {
    const { tokens } = fallbackTokenize('Hello世界');
    expect(tokens).toEqual(['Hello', '世界']);
  });

  test('記号・空白は除去される', () => {
    const { tokens } = fallbackTokenize('猫 犬');
    // 空白は other → 除去
    expect(tokens).not.toContain(' ');
    expect(tokens).toContain('猫');
    expect(tokens).toContain('犬');
  });

  test('空文字入力で空トークン配列を返す', () => {
    const result = fallbackTokenize('');
    expect(result.tokens).toEqual([]);
    expect(result.isNewPairAllowed).toBe(false);
  });

  test('null 入力で空トークン配列を返す', () => {
    const result = fallbackTokenize(null);
    expect(result.tokens).toEqual([]);
    expect(result.isNewPairAllowed).toBe(false);
  });

  test('allowNewPairs 省略時は isNewPairAllowed が false（既定・F1制御維持）', () => {
    const result = fallbackTokenize('テスト');
    expect(result.isNewPairAllowed).toBe(false);
  });

  test('allowNewPairs=false のとき isNewPairAllowed が false', () => {
    const result = fallbackTokenize('テスト', false);
    expect(result.isNewPairAllowed).toBe(false);
  });

  test('allowNewPairs=true のとき isNewPairAllowed が true', () => {
    const result = fallbackTokenize('テスト', true);
    expect(result.isNewPairAllowed).toBe(true);
  });

  test('allowNewPairs=true でも tokens の分割結果は不変', () => {
    const { tokens: t1 } = fallbackTokenize('今日はいい天気', false);
    const { tokens: t2 } = fallbackTokenize('今日はいい天気', true);
    expect(t2).toEqual(t1);
  });

  test('allowNewPairs=true で空入力でも isNewPairAllowed が true', () => {
    const result = fallbackTokenize('', true);
    expect(result.isNewPairAllowed).toBe(true);
  });

  test('isNewPairAllowed が空入力（省略）でも false', () => {
    const result = fallbackTokenize('');
    expect(result.isNewPairAllowed).toBe(false);
  });

  test('ひらがな・カタカナ・漢字・英数字が混在する文を適切に分割する', () => {
    const { tokens } = fallbackTokenize('今日はGoodな天気');
    // '今日' はあり, 'Good' はあり, '天気' はあり, 'な' はあり
    expect(tokens).toContain('今日');
    expect(tokens).toContain('Good');
    expect(tokens).toContain('天気');
  });
});
