'use strict';
const { cleanNoteText, splitIntoSentences, stripDecorations, balanceBrackets, sanitizeGeneratedText, containsExcludedScript } = require('../../src/lib/text');

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

    test('<plain> タグを除去する', () => {
      expect(cleanNoteText('<plain>もちもちマンゴー</plain>')).toBe('もちもちマンゴー');
    });

    test('<center> タグを除去する', () => {
      expect(cleanNoteText('<center>テスト</center>')).toBe('テスト');
    });

    test('MFM アングルタグと $[...] が混在する場合', () => {
      const result = cleanNoteText('<plain>$[tada 🎉]</plain>');
      expect(result).toBe('🎉');
    });
  });

  describe('罫線・装飾文字除去', () => {
    test('罫線文字（U+2500-257F）を除去する', () => {
      expect(cleanNoteText('┏━━┓ にて')).toBe('にて');
    });

    test('ブロック要素（U+2580-259F）を除去する', () => {
      expect(cleanNoteText('▓▒░ 装飾')).toBe('装飾');
    });

    test('罫線と通常テキストが混在する場合', () => {
      expect(cleanNoteText('┏━━┓ タイトル ┗━━┛')).toBe('タイトル');
    });
  });

  describe('引用マーカー除去', () => {
    test('行頭の > を除去する', () => {
      expect(cleanNoteText('> 引用テキスト')).toBe('引用テキスト');
    });

    test('テキスト内のスペース後の > を除去する', () => {
      expect(cleanNoteText('🙏️ > 希死念慮 でけた')).toBe('🙏️ 希死念慮 でけた');
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

  describe('不可視文字除去', () => {
    test('U+200B(ゼロ幅スペース)のみの文字列は空になる', () => {
      expect(cleanNoteText('​​​')).toBe('');
    });

    test('通常テキスト末尾のU+200Bを除去する', () => {
      expect(cleanNoteText('疲れた​​')).toBe('疲れた');
    });

    test('テキスト内部のU+200Bを除去する', () => {
      expect(cleanNoteText('テス​ト')).toBe('テスト');
    });

    test('U+FEFF(BOM)を除去する', () => {
      expect(cleanNoteText('﻿テスト')).toBe('テスト');
    });

    test('U+200C/U+200D/U+200E/U+200Fを除去する', () => {
      expect(cleanNoteText('a‌b‍c‎d‏f')).toBe('abcdf');
    });

    test('U+00AD(ソフトハイフン)を除去する', () => {
      expect(cleanNoteText('テ­スト')).toBe('テスト');
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

// =====================================================================
// stripDecorations
// =====================================================================

describe('stripDecorations', () => {
  test('<plain> タグを除去し中身を保持する', () => {
    expect(stripDecorations('<plain>もちもちマンゴー</plain>')).toBe('もちもちマンゴー');
  });

  test('<center> タグを除去する', () => {
    expect(stripDecorations('<center>テキスト</center>')).toBe('テキスト');
  });

  test('属性付きタグを除去する', () => {
    expect(stripDecorations('<small>小さい</small>')).toBe('小さい');
  });

  test('顔文字 <(^o^)> は除去しない', () => {
    // 先頭が英字でないため除去対象外
    expect(stripDecorations('<(^o^)>')).toBe('<(^o^)>');
  });

  test('罫線文字（U+2500-257F）を除去する', () => {
    // 罫線は除去されるがスペースは残る（空白正規化はパイプライン末尾で行う）
    expect(stripDecorations('┏━━┓ タイトル ┗━━┛')).toBe(' タイトル ');
  });

  test('ブロック要素（U+2580-259F）を除去する', () => {
    expect(stripDecorations('▓▒░ デコ ▓')).toBe(' デコ ');
  });

  test('行頭の引用マーカー > を除去する', () => {
    expect(stripDecorations('> 引用テキスト')).toBe('引用テキスト');
  });

  test('文中スペース後の > を除去する', () => {
    expect(stripDecorations('🙏️ > 希死念慮 でけた')).toBe('🙏️ 希死念慮 でけた');
  });

  test('空文字列は空文字列を返す', () => {
    expect(stripDecorations('')).toBe('');
  });
});

// =====================================================================
// balanceBrackets
// =====================================================================

describe('balanceBrackets', () => {
  test('対応のない閉じ括弧を削除する（半角）', () => {
    expect(balanceBrackets('わたっしーとしてます )のまま')).toBe('わたっしーとしてます のまま');
  });

  test('対応のない閉じ括弧を削除する（全角）', () => {
    expect(balanceBrackets('テスト）です')).toBe('テストです');
  });

  test('未閉じの開き括弧を末尾で閉じる', () => {
    expect(balanceBrackets('（あいうえお')).toBe('（あいうえお）');
  });

  test('正しく対応している括弧はそのまま保持する', () => {
    expect(balanceBrackets('（テスト）です')).toBe('（テスト）です');
  });

  test('「」 の対応はそのまま保持する', () => {
    expect(balanceBrackets('「こんにちは」と言った')).toBe('「こんにちは」と言った');
  });

  test('対応のない 」 を削除する', () => {
    expect(balanceBrackets('こんにちは」と言った')).toBe('こんにちはと言った');
  });

  test('複数の対応括弧を処理する', () => {
    expect(balanceBrackets('（あ）（い）')).toBe('（あ）（い）');
  });

  test('ネストした括弧を処理する', () => {
    expect(balanceBrackets('（ああ（いい）うう）')).toBe('（ああ（いい）うう）');
  });

  test('空文字列は空文字列を返す', () => {
    expect(balanceBrackets('')).toBe('');
  });
});

// =====================================================================
// sanitizeGeneratedText
// =====================================================================

describe('sanitizeGeneratedText', () => {
  describe('MFM タグ除去', () => {
    test('<plain> タグを除去する', () => {
      expect(sanitizeGeneratedText('<plain>もちもちマンゴー<center>雨だから')).toBe('もちもちマンゴー雨だから');
    });
  });

  describe('罫線・装飾除去', () => {
    test('罫線文字を除去する', () => {
      expect(sanitizeGeneratedText('┏━━┓ にて🙌️')).toBe('にて🙌️');
    });
  });

  describe('ハッシュタグ除去', () => {
    test('Google スプレッドシートのエラーリテラルを除去する', () => {
      expect(sanitizeGeneratedText('雨だからのとか#ERROR!#ERROR! あと')).toBe('雨だからのとか あと');
    });

    test('#REF! を除去する', () => {
      expect(sanitizeGeneratedText('テスト#REF!です')).toBe('テストです');
    });

    test('通常のハッシュタグ（語ごと）を除去する', () => {
      expect(sanitizeGeneratedText('#JavaScript と #日本語タグ')).toBe('と');
    });

    test('ハッシュタグがないテキストはそのまま', () => {
      expect(sanitizeGeneratedText('普通のテキストです')).toBe('普通のテキストです');
    });
  });

  describe('括弧の釣り合わせ', () => {
    test('対応のない閉じ括弧を削除する', () => {
      expect(sanitizeGeneratedText('わたっしーとしてます )のままと千カラット')).toBe('わたっしーとしてます のままと千カラット');
    });

    test('未閉じの開き括弧を補完する', () => {
      expect(sanitizeGeneratedText('（あいうえお')).toBe('（あいうえお）');
    });
  });

  describe('カスタム絵文字スペース挿入', () => {
    test('絵文字直後の半角英数の前にスペースを挿入する', () => {
      expect(sanitizeGeneratedText(':minna_watashi_no_hazukashii_toukou_surutoko_mitete:meme作り中')).toBe(':minna_watashi_no_hazukashii_toukou_surutoko_mitete: meme作り中');
    });

    test('絵文字直後が日本語の場合はスペースを挿入しない', () => {
      expect(sanitizeGeneratedText(':blobzzz_itsumoarigato:何故か')).toBe(':blobzzz_itsumoarigato:何故か');
    });

    test('絵文字直後がスペースの場合は変化なし', () => {
      expect(sanitizeGeneratedText(':emoji: テスト')).toBe(':emoji: テスト');
    });

    test(':emoji@host: 形式でも半角英数前にスペースを挿入する', () => {
      expect(sanitizeGeneratedText(':ayaka@misskey.io:test')).toBe(':ayaka@misskey.io: test');
    });
  });

  describe('引用マーカー除去', () => {
    test('スペース後の > を除去する', () => {
      expect(sanitizeGeneratedText('🙏️ > 希死念慮 でけた')).toBe('🙏️ 希死念慮 でけた');
    });
  });

  describe('実投稿ケース', () => {
    test('投稿例1: 複合不具合', () => {
      const input = 'わたっしーとしてます )のままと千カラット <plain>もちもちマンゴー<center>雨だからのとか#ERROR!#ERROR! ┏━━┓ にて🙌️';
      const result = sanitizeGeneratedText(input);
      expect(result).not.toContain(')のまま');
      expect(result).not.toContain('<plain>');
      expect(result).not.toContain('<center>');
      expect(result).not.toContain('#ERROR!');
      expect(result).not.toContain('┏');
      expect(result).toContain('もちもちマンゴー');
      expect(result).toContain('にて🙌️');
    });
  });

  describe('エッジケース', () => {
    test('null は空文字列を返す', () => {
      expect(sanitizeGeneratedText(null)).toBe('');
    });

    test('空文字列は空文字列を返す', () => {
      expect(sanitizeGeneratedText('')).toBe('');
    });

    test('通常テキストはそのまま返す', () => {
      expect(sanitizeGeneratedText('普通のテキストです。'));
    });
  });
});

// =====================================================================
// cleanNoteText — 半角記号除去（追加ステップ 7b）
// =====================================================================

describe('cleanNoteText 半角記号除去', () => {
  test('ASCII 記号（! ?）を除去しスペースに変換する', () => {
    expect(cleanNoteText('猫!?犬')).toBe('猫 犬');
  });

  test('スラッシュを除去する', () => {
    expect(cleanNoteText('and/or')).toBe('and or');
  });

  test('ASCII 英数字は保持される', () => {
    expect(cleanNoteText('abc 123')).toBe('abc 123');
  });

  test('全角句読点（、。）は保持される', () => {
    expect(cleanNoteText('猫、犬。ねこ')).toBe('猫、犬。ねこ');
  });

  test('半角句読点（｡ ､）を除去する', () => {
    expect(cleanNoteText('テスト｡半角')).toBe('テスト 半角');
  });

  test('記号のみの文字列は空になる', () => {
    expect(cleanNoteText('!!??')).toBe('');
  });

  test('算術演算子（+=-）を除去する', () => {
    // +, =, - はいずれも ASCII 記号範囲内
    const result = cleanNoteText('1+2=3-0');
    expect(result).not.toContain('+');
    expect(result).not.toContain('=');
    expect(result).not.toContain('-');
    // 数字は保持される
    expect(result).toContain('1');
  });
});

// =====================================================================
// containsExcludedScript
// =====================================================================

describe('containsExcludedScript', () => {
  test('キリル文字（ロシア語）を含む場合は true', () => {
    expect(containsExcludedScript('Привет')).toBe(true);
  });

  test('ハングル音節を含む場合は true', () => {
    expect(containsExcludedScript('안녕하세요')).toBe(true);
  });

  test('日本語テキストは false', () => {
    expect(containsExcludedScript('普通の日本語です。')).toBe(false);
  });

  test('ひらがな・カタカナは false', () => {
    expect(containsExcludedScript('ひらがなとカタカナ')).toBe(false);
  });

  test('ASCII のみは false', () => {
    expect(containsExcludedScript('Hello World 123')).toBe(false);
  });

  test('空文字列は false', () => {
    expect(containsExcludedScript('')).toBe(false);
  });

  test('日本語とキリル文字の混在は true', () => {
    expect(containsExcludedScript('こんにちはПривет')).toBe(true);
  });

  test('日本語とハングルの混在は true', () => {
    expect(containsExcludedScript('テスト한국어です')).toBe(true);
  });
});
