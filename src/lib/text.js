'use strict';

/**
 * テキスト前処理パイプライン。
 * 適用順序は設計仕様書 §6.1 に従う（Mastodon HTML 除去はアダプタ層で実施済み前提）。
 * @param {string} text
 * @returns {string}
 */
function cleanNoteText(text) {
  if (!text) return '';
  var s = text;
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
  module.exports = { cleanNoteText, splitIntoSentences };
}
