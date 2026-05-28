// ===================================================================
// Core.gs — 設定読込・NGワード・カウンタ・ログ・共通ユーティリティ
// ===================================================================

// グローバル定数 —— スクリプト起動時に1回だけ評価される
var SHEET = {
  CONFIG:            '設定',
  BLACKLIST:         '学習除外ブラックリスト',
  NG_WORDS:          'NGワード',
  EMOJIS:            'カスタム絵文字',
  NGRAM:             'N-gram本体',
  RAW_LEARN:         '生学習データ',
  PROCESSED_MISSKEY: '処理済みID_Misskey',
  PROCESSED_MASTODON:'処理済みID_Mastodon',
  POST_HISTORY:      '投稿履歴ハッシュ',
  FOLLOWS:           'フォロー管理',
  DASHBOARD:         'ダッシュボード',
  ERROR_LOG:         'エラーログ',
};

var SS = SpreadsheetApp.getActiveSpreadsheet();

var SCRIPT_START = Date.now();

// ===================================================================
// 設定読込
// ===================================================================

/**
 * 設定シートから指定キーの値を返す。CacheService でキャッシュ(5分)。
 * @param {string} key
 * @param {*} [defaultValue]
 * @returns {string|*}
 */
function getConfig(key, defaultValue) {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('cfg_' + key);
  if (cached !== null) return cached;

  var sheet = getSheet_(SHEET.CONFIG);
  if (!sheet) return defaultValue !== undefined ? defaultValue : '';

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === key) {
      var val = String(data[i][1]).trim();
      try { cache.put('cfg_' + key, val, 300); } catch (_) {}
      return val;
    }
  }
  return defaultValue !== undefined ? defaultValue : '';
}

/**
 * 設定キャッシュを全消去する(setupSpreadsheet/manageApiTokens 後に呼ぶ)。
 */
function clearConfigCache_() {
  try { CacheService.getScriptCache().removeAll([]); } catch (_) {}
}

// ===================================================================
// NGワード
// ===================================================================

/**
 * NGワードリストを3層構成で読み込む。
 * 1. 設定シート「NGワード」シート
 * 2. NG_WORDS_EXTERNAL_URL から取得
 * 3. PropertiesService キャッシュ(前回取得値)
 * @returns {string[]}
 */
function loadNGWords() {
  var words = [];

  // 1. シートから
  var sheet = getSheet_(SHEET.NG_WORDS);
  if (sheet) {
    var vals = sheet.getDataRange().getValues();
    for (var i = 1; i < vals.length; i++) {
      var w = String(vals[i][0]).trim();
      if (w) words.push(w);
    }
  }

  // 2. 外部 URL から
  var url = getConfig('NG_WORDS_EXTERNAL_URL');
  if (url) {
    try {
      var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      incrementCounter('URL_FETCH', 'system');
      if (res.getResponseCode() === 200) {
        var lines = res.getContentText().split('\n');
        for (var j = 0; j < lines.length; j++) {
          var line = lines[j].trim();
          if (line && line.charAt(0) !== '#') words.push(line);
        }
        // 3層: 成功したら PropertiesService に保存
        try {
          PropertiesService.getScriptProperties().setProperty(
            'NG_WORDS_CACHE', JSON.stringify(words)
          );
        } catch (_) {}
      }
    } catch (e) {
      // 取得失敗 → PropertiesService フォールバック
      try {
        var cached = PropertiesService.getScriptProperties().getProperty('NG_WORDS_CACHE');
        if (cached) {
          var parsed = JSON.parse(cached);
          for (var k = 0; k < parsed.length; k++) words.push(parsed[k]);
        }
      } catch (_) {}
    }
  }

  // 重複除去
  return Array.from(new Set(words));
}

// ===================================================================
// カウンタ
// ===================================================================

/**
 * PropertiesService に COUNT_{TYPE}_{PLATFORM}_{YYYY-MM-DD} キーでインクリメント。
 * @param {string} type     - 'POST' / 'REPLY' / 'FOLLOW_BACK' / 'UNFOLLOW' / 'LEARN' / 'ERROR' / 'URL_FETCH' 等
 * @param {string} platform - 'misskey' / 'mastodon' / 'system'
 */
function incrementCounter(type, platform) {
  var p = platform || 'system';
  var date = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  var key = 'COUNT_' + type + '_' + p + '_' + date;
  try {
    var props = PropertiesService.getScriptProperties();
    var cur = parseInt(props.getProperty(key) || '0', 10);
    props.setProperty(key, String(cur + 1));
  } catch (_) {}
}

/**
 * 30日より前の日次カウンタキーを PropertiesService から削除する。
 */
function cleanupOldCounters_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var allProps = props.getProperties();
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    var cutoffStr = Utilities.formatDate(cutoff, 'Asia/Tokyo', 'yyyy-MM-dd');

    for (var key in allProps) {
      if (key.indexOf('COUNT_') === 0) {
        var parts = key.split('_');
        var dateStr = parts[parts.length - 1];
        if (dateStr < cutoffStr) props.deleteProperty(key);
      }
    }
  } catch (_) {}
}

// ===================================================================
// エラーログ
// ===================================================================

/**
 * エラーログシートに記録 + カウンタ更新 + メール通知。
 * @param {string} functionName
 * @param {string} message
 * @param {string} [platform='system']
 */
function logError(functionName, message, platform) {
  var p = platform || 'system';
  incrementCounter('ERROR', p);

  try {
    var sheet = getSheet_(SHEET.ERROR_LOG);
    if (sheet) {
      var ts = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
      sheet.appendRow([ts, p, functionName, message]);
    }
  } catch (_) {}

  // メール通知
  try {
    var enabled = getConfig('ERROR_NOTIFY_ENABLED');
    if (parseBool(enabled, false)) {
      var email = getConfig('ERROR_NOTIFY_EMAIL');
      if (email && MailApp.getRemainingDailyQuota() > 0) {
        MailApp.sendEmail(
          email,
          '[elisa_bot] エラー: ' + functionName,
          '[' + p + '] ' + functionName + '\n' + message
        );
      }
    }
  } catch (_) {}
}

// ===================================================================
// 時刻ユーティリティ (lib/time.js のラッパー)
// ===================================================================

/**
 * GAS スクリプト実行時間が予算内かどうか。
 * @param {number} budgetMs - 残り許容時間(ms)
 * @returns {boolean}
 */
function isTimeSafe(budgetMs) {
  return now_() - SCRIPT_START < budgetMs;
}

/**
 * 現在が夜間帯かどうか。
 * @returns {boolean}
 */
function isNightTime() {
  var start = parseInt(getConfig('POST_NIGHT_START', '23'), 10);
  var end   = parseInt(getConfig('POST_NIGHT_END',   '6'),  10);
  var h = new Date().getHours();
  if (start > end) return h >= start || h < end;
  return h >= start && h < end;
}

/**
 * Date.now() のラッパー(テスト差し替え用)
 */
function now_() {
  return Date.now();
}

// ===================================================================
// PropertiesService ヘルパー
// ===================================================================

function getProp_(key, defaultVal) {
  try {
    var val = PropertiesService.getScriptProperties().getProperty(key);
    return val !== null ? val : (defaultVal !== undefined ? defaultVal : null);
  } catch (_) {
    return defaultVal !== undefined ? defaultVal : null;
  }
}

function setProp_(key, value) {
  try {
    PropertiesService.getScriptProperties().setProperty(key, String(value));
  } catch (_) {}
}

function deleteProp_(key) {
  try {
    PropertiesService.getScriptProperties().deleteProperty(key);
  } catch (_) {}
}

// ===================================================================
// シートヘルパー
// ===================================================================

/**
 * 論理名からシートオブジェクトを返す。存在しない場合は null。
 * @param {string} name - SHEET.* の値
 * @returns {GoogleAppsScript.Spreadsheet.Sheet|null}
 */
function getSheet_(name) {
  try {
    return SS.getSheetByName(name) || null;
  } catch (_) {
    return null;
  }
}
