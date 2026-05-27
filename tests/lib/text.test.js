'use strict';
const { cleanNoteText, splitIntoSentences } = require('../../src/lib/text');

describe('cleanNoteText', () => {
  describe('URL 除去', () => {
    test('https URL を除去する', () => {
      expect(cleanNoteText('今日は https://example.com を見た')).toBe('今日は  を見た'.replace('  ', ' '));
    });

    test('http URL を除去する', () => {
      expect(cleanNoteText('参考 http://example.com です')).toBe('参考  です'.replace('  ', ' '));
    });

    test('Markdown リンクはラベルのみ残す', () => {
      expect(cleanNoteText('[詳細はこちら](https://example.com)')).toBe('詳細はこちら');
    });

    test('Markdown リンクと裸の URL が混在する場合', () => {
      const result = cleanNoteText('[リンク](https://a.com) と https://b.com があります');
      expect(result).toBe('リンク と  があります'.replace('  ', ' '));
    });
  });

  describe('メンション除去', () => {
    test('@user を除去する', () => {
      expect(cleanNoteText('@alice こんにちは')).toBe('こんにちは');
    });

    test('@user@host 形式を除去する', () => {
      expect(cleanNoteText('@alice@example.com こんにちは')).toBe('こんにちは');
    });

    test('文中のメンションを除去する', () => {
      expect(cleanNoteText('こんにちは @bob@host.social さん')).toBe('こんにちは  さん'.replace('  ', ' '));
    });
  });

  describe('MFM 除去', () => {
    test('$[fn content] の関数部分のみ除去し中身を保持する', () => {
      expect(cleanNoteText('$[tada 🎉]')).toBe('🎉');
    });

    test('$[spin テキスト] のテキストを保持する', () => {
      expect(cleanNoteText('$[spin 回転します]')).toBe('回転します');
    });
  });

  describe('太字/斜体マークアップ除去', () => {
    test('**太字** の中身を保持する', () => {
      expect(cleanNoteText('**重要な**お知らせ')).toBe('重要なお知らせ');
    });

    test('*斜体* の中身を保持する', () => {
      expect(cleanNoteText('*斜体テキスト*')).toBe('斜体テキスト');
    });

    test('***太字斜体*** の中身を保持する', () => {
      expect(cleanNoteText('***強調***')).toBe('強調');
    });
  });

  describe('カスタム絵文字除去', () => {
    test(':emoji: を除去する', () => {
      expect(cleanNoteText('楽しい :party: 日だ')).toBe('楽しい  日だ'.replace('  ', ' '));
    });

    test(':emoji@host: を除去する', () => {
      expect(cleanNoteText(':ayaka@misskey.io: こんにちは')).toBe('こんにちは');
    });

    test('複数の絵文字を除去する', () => {
      const result = cleanNoteText(':a: テスト :b: です');
      expect(result).toBe('テスト  です'.replace('  ', ' '));
    });
  });

  describe('ハッシュタグ処理', () => {
    test('# のみ除去し語を保持する', () => {
      expect(cleanNoteText('#JavaScript が好き')).toBe('JavaScript が好き');
    });

    test('日本語ハッシュタグの # を除去する', () => {
      expect(cleanNoteText('#日本語タグ のテスト')).toBe('日本語タグ のテスト');
    });

    test('複数のハッシュタグを処理する', () => {
      expect(cleanNoteText('#tag1 と #tag2')).toBe('tag1 と tag2');
    });
  });

  describe('空白・改行正規化', () => {
    test('改行をスペースに変換する', () => {
      expect(cleanNoteText('一行目\n二行目')).toBe('一行目 二行目');
    });

    test('連続空白を1スペースにする', () => {
      expect(cleanNoteText('テスト   です')).toBe('テスト です');
    });

    test('前後の空白を trim する', () => {
      expect(cleanNoteText('  テスト  ')).toBe('テスト');
    });
  });

  describe('複合パターン', () => {
    test('複数のパターンが混在する場合', () => {
      const input = '@alice こんにちは！ #挨拶 :wave: https://example.com';
      const result = cleanNoteText(input);
      expect(result).toContain('こんにちは！');
      expect(result).toContain('挨拶');
      expect(result).not.toContain('@alice');
      expect(result).not.toContain(':wave:');
      expect(result).not.toContain('https://');
      expect(result).not.toContain('#');
    });
  });

  describe('エッジケース', () => {
    test('空文字列を返す（null 入力）', () => {
      expect(cleanNoteText(null)).toBe('');
    });

    test('空文字列を返す（undefined 入力）', () => {
      expect(cleanNoteText(undefined)).toBe('');
    });

    test('空文字列をそのまま返す', () => {
      expect(cleanNoteText('')).toBe('');
    });

    test('通常テキストはそのまま返す', () => {
      expect(cleanNoteText('普通のテキストです。')).toBe('普通のテキストです。');
    });
  });
});

describe('splitIntoSentences', () => {
  test('句点で分割する', () => {
    expect(splitIntoSentences('一文目。二文目。三文目。')).toEqual(['一文目', '二文目', '三文目']);
  });

  test('末尾の句点後が空文字なら除去する', () => {
    expect(splitIntoSentences('一文目。二文目。')).toEqual(['一文目', '二文目']);
  });

  test('句点なしの文はそのまま配列1要素として返す', () => {
    expect(splitIntoSentences('句点がない文')).toEqual(['句点がない文']);
  });

  test('空文字列で空配列を返す', () => {
    expect(splitIntoSentences('')).toEqual([]);
  });

  test('null で空配列を返す', () => {
    expect(splitIntoSentences(null)).toEqual([]);
  });

  test('句点のみの入力で空配列を返す', () => {
    expect(splitIntoSentences('。')).toEqual([]);
  });

  test('前後の空白を trim する', () => {
    const result = splitIntoSentences(' 一文目 。 二文目 。');
    expect(result).toEqual(['一文目', '二文目']);
  });
});
