'use strict';

// Yahoo MA API V2 の品詞フィルタ α: 記号・特殊を除去
var EXCLUDED_POS = ['特殊', '記号'];

/**
 * Yahoo 形態素解析 API V2 のレスポンス JSON からトークン配列を返す。
 * 品詞フィルタ α: 「特殊」「記号」は除去し、それ以外はすべて保持。
 * @param {object} responseJson
 * @returns {string[]}
 */
function parseYahooResponse(responseJson) {
  try {
    var tokens = responseJson &&
      responseJson.result &&
      responseJson.result.tokens;
    if (!Array.isArray(tokens)) return [];
    var result = [];
    for (var i = 0; i < tokens.length; i++) {
      var tok = tokens[i];
      if (!Array.isArray(tok) || tok.length < 4) continue;
      var surface = String(tok[0]);
      var pos = String(tok[3]);
      if (EXCLUDED_POS.indexOf(pos) !== -1) continue;
      if (surface.length === 0) continue;
      // 不可視文字のみのトークンは除去(Yahoo MA が U+200B 等を品詞判定する場合の防衛)
      if (/^[­​-‏⁠-⁤﻿]+$/.test(surface)) continue;
      result.push(surface);
    }
    return result;
  } catch (_) {
    return [];
  }
}

// 文字種の判定: ひらがな/カタカナ/漢字(CJK)/英数字/その他
var _RE_HIRAGANA = /[ぁ-ゖ]/;
var _RE_KATAKANA = /[ァ-ヶ]/;
var _RE_KANJI = /[一-鿿㐀-䶿]/;
var _RE_ALNUM = /[a-zA-Z0-9]/;

function _charType(ch) {
  if (_RE_HIRAGANA.test(ch)) return 'hiragana';
  if (_RE_KATAKANA.test(ch)) return 'katakana';
  if (_RE_KANJI.test(ch)) return 'kanji';
  if (_RE_ALNUM.test(ch)) return 'alnum';
  return 'other';
}

/**
 * F4 粗トークナイズ: 文字種（ひらがな/カタカナ/漢字/英数字/その他）の遷移境界で分割。
 * F1 フラグ付き（isNewPairAllowed: false）で返す。
 * @param {string} text
 * @returns {{ tokens: string[], isNewPairAllowed: boolean }}
 */
function fallbackTokenize(text) {
  if (!text) return { tokens: [], isNewPairAllowed: false };
  var tokens = [];
  var current = '';
  var currentType = null;

  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    var type = _charType(ch);
    if (type !== currentType) {
      if (current.length > 0) tokens.push(current);
      current = ch;
      currentType = type;
    } else {
      current += ch;
    }
  }
  if (current.length > 0) tokens.push(current);

  // other（記号・空白等）のトークンは除去
  tokens = tokens.filter(function (t) {
    return _charType(t[0]) !== 'other';
  });

  return { tokens: tokens, isNewPairAllowed: false };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseYahooResponse, fallbackTokenize };
}
