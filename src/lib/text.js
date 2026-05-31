'use strict';

/**
 * MFM/HTML アングルタグ・罫線/ブロック要素（U+2500–259F）・引用マーカー（> ＞）を除去する。
 * cleanNoteText（学習入力）と sanitizeGeneratedText（出力後処理）の両方から呼ぶ共通ヘルパ。
 * @param {string} s
 * @returns {string}
 */
function stripDecorations(s) {
  // 1. MFM/HTML アングルタグ: <plain> <center> </center> <small> 等
  //    先頭が英字または / のみ対象 → <(^o^)> 等の顔文字は誤除去しない
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, '');
  // 2. 罫線・ブロック要素 U+2500–U+259F（┏━┓│╭ … ░▒▓█）
  s = s.replace(/[─-▟]/g, '');
  // 3. 引用マーカー > / ＞（単語境界前後に隣接するもの。(>_<) 等は保持）
  s = s.replace(/(^|(?<=\s))[>＞]+\s?/gm, '');
  return s;
}

/**
 * 括弧の対応を整える。
 * 対応のない閉じ括弧は削除し、未閉じの開き括弧は末尾に閉じ括弧を補う。
 * @param {string} s
 * @returns {string}
 */
function balanceBrackets(s) {
  var pairs = {
    '(': ')', '（': '）',
    '「': '」', '『': '』',
    '[': ']', '［': '］',
    '【': '】', '〔': '〕',
    '《': '》', '〈': '〉',
    '｛': '｝', '{': '}'
  };
  var closers = {};
  Object.keys(pairs).forEach(function (o) { closers[pairs[o]] = o; });
  var stack = [];
  var out = [];
  for (var i = 0; i < s.length; i++) {
    var c = s[i];
    if (pairs[c]) {
      // 開き括弧: スタックに積んで出力
      stack.push(c);
      out.push(c);
    } else if (closers[c]) {
      // 閉じ括弧: スタック先頭と対応するなら出力、しないなら破棄
      if (stack.length > 0 && pairs[stack[stack.length - 1]] === c) {
        stack.pop();
        out.push(c);
      }
      // 対応しない閉じ括弧は push しない（削除）
    } else {
      out.push(c);
    }
  }
  // 未閉じの開き括弧を末尾で閉じる
  while (stack.length > 0) {
    out.push(pairs[stack.pop()]);
  }
  return out.join('');
}

/**
 * 生成テキストの出力後処理（サニタイズ）。
 * generatePost_ から呼び出す。学習入力用の cleanNoteText とは異なり、
 * ハッシュタグは語ごと削除し、括弧の釣り合わせ・絵文字スペース挿入を行う。
 * @param {string} text
 * @returns {string}
 */
function sanitizeGeneratedText(text) {
  if (!text) return '';
  var s = stripDecorations(text);
  // Google スプレッドシートのエラーリテラルを除去（#ERROR! #REF! 等）
  s = s.replace(/[#＃](ERROR!|REF!|NAME\?|VALUE!|DIV\/0!|N\/A|NUM!|NULL!|SPILL!|CALC!|GETTING_DATA)/g, '');
  // ハッシュタグは # と語をまとめて削除（生成投稿にはハッシュタグを含まない方針）
  s = s.replace(/[#＃][\p{L}\p{N}_]+/gu, '');
  // 括弧の釣り合わせ
  s = balanceBrackets(s);
  // カスタム絵文字（:name: または :name@host:）直後の半角英数の前にスペースを挿入
  s = s.replace(/(:[a-zA-Z0-9_]+(?:@[\w.-]+)?:)(?=[A-Za-z0-9])/g, '$1 ');
  // 連続空白・前後空白の正規化
  s = s.replace(/[ \t]{2,}/g, ' ').trim();
  return s;
}

/**
 * テキスト前処理パイプライン（学習入力用）。
 * 適用順序は設計仕様書 §6.1 に従う（Mastodon HTML 除去はアダプタ層で実施済み前提）。
 * @param {string} text
 * @returns {string}
 */
function cleanNoteText(text) {
  if (!text) return '';
  var s = text;
  // 0. 不可視文字を除去: U+00AD ソフトハイフン / U+200B-200F ZWS 等 / U+2060-2064 / U+FEFF BOM
  s = s.replace(/[­​-‏⁠-⁤﻿]/g, '');
  // 0b. MFM/HTML アングルタグ・罫線・引用マーカーを除去（コーパス汚染防止）
  s = stripDecorations(s);
  // 1. Markdown リンク [label](url) → ラベルのみ残す
  s = s.replace(/\[([^\]]+)\]\(https?:\/\/\S+?\)/g, '$1');
  // 2. URL 除去
  s = s.replace(/https?:\/\/\S+/g, '');
  // 3. メンション除去
  s = s.replace(/@[\w.-]+(@[\w.-]+)?/g, '');
  // 4. MFM $[fn content] → content
  s = s.replace(/\$\[[^\]\s]+\s([^\]]+)\]/g, '$1');
  // 5. **太字** / *斜体* マークアップ除去（中身保持）
  s = s.replace(/\*{1,3}(.+?)\*{1,3}/g, '$1');
  // 6. カスタム絵文字完全除去 :name: または :name@host:
  s = s.replace(/:[a-zA-Z0-9_]+(@[\w.-]+)?:/g, '');
  // 7. ハッシュタグ # のみ除去、語は保持（Unicode 文字クラス）
  s = s.replace(/#([\p{L}\p{N}_]+)/gu, '$1');
  // 8. 改行・連続空白 → 半角スペース1個
  s = s.replace(/[\r\n]+/g, ' ').replace(/[ \t]+/g, ' ').trim();
  return s;
}

/**
 * 句点「。」でテキストを文に分割する。空文字は除去する。
 * @param {string} text
 * @returns {string[]}
 */
function splitIntoSentences(text) {
  if (!text) return [];
  return text
    .split('。')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { cleanNoteText, splitIntoSentences, stripDecorations, balanceBrackets, sanitizeGeneratedText };
}
