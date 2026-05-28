// ===================================================================
// Markov.gs — N-gram ストア管理・形態素解析呼び分け・マルコフ投稿生成
// ===================================================================

// ===================================================================
// N-gram ストアのロード / フラッシュ
// ===================================================================

/**
 * N-gram 本体シートから全件読み込んで NGramStore インスタンスを返す。
 * @returns {NGramStore}
 */
function loadNgramStore_() {
  var store = new NGramStore();
  var sheet = getSheet_(SHEET.NGRAM);
  if (!sheet) return store;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return store;

  var rows = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  store.load(rows);
  return store;
}

/**
 * NGramStore の dirty エントリをシートに差分フラッシュする。
 * count=0 は削除、それ以外は更新または追記。パフォーマンスのため全件 setValues で書き戻す。
 * @param {NGramStore} ngramStore
 */
function flushNgramStore_(ngramStore) {
  var dirty = ngramStore.getDirtyEntries();
  if (!dirty || dirty.length === 0) return;

  var sheet = getSheet_(SHEET.NGRAM);
  if (!sheet) return;

  var lastRow = sheet.getLastRow();
  var existingData = [];
  if (lastRow >= 2) {
    existingData = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  }

  // インデックスマップ構築 Map<"prev\tnext", rowIndex(0始まり)>
  var indexMap = {};
  for (var i = 0; i < existingData.length; i++) {
    var row = existingData[i];
    if (row[0] && row[1]) indexMap[row[0] + '\t' + row[1]] = i;
  }

  var deleteSet = {};
  var toAppend = [];

  for (var j = 0; j < dirty.length; j++) {
    var entry = dirty[j];
    var key = entry[0] + '\t' + entry[1];
    var idx = indexMap.hasOwnProperty(key) ? indexMap[key] : -1;

    if (entry[2] === 0) {
      if (idx >= 0) deleteSet[idx] = true;
    } else if (idx >= 0) {
      existingData[idx][2] = entry[2];
      existingData[idx][3] = entry[3];
    } else {
      toAppend.push(entry);
    }
  }

  // 削除行を除外してまとめる
  var retained = [];
  for (var k = 0; k < existingData.length; k++) {
    if (!deleteSet[k]) retained.push(existingData[k]);
  }
  for (var a = 0; a < toAppend.length; a++) retained.push(toAppend[a]);

  // シートに書き戻す
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 4).clearContent();
  }
  if (retained.length > 0) {
    sheet.getRange(2, 1, retained.length, 4).setValues(retained);
  }
}

// ===================================================================
// 形態素解析
// ===================================================================

/**
 * テキストをトークン化する。
 * UrlFetch 当日累計が閾値を超えていたら F4 フォールバックへ切り替える。
 * @param {string} text
 * @returns {{ tokens: string[], isNewPairAllowed: boolean }}
 */
function tokenizeNote_(text) {
  var threshold = parseInt(
    getConfig('MORPH_URLFETCH_FALLBACK_THRESHOLD', '15000'), 10
  );
  var date = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  var fetchCount = parseInt(
    getProp_('COUNT_URL_FETCH_system_' + date, '0'), 10
  );

  if (fetchCount >= threshold) return fallbackTokenize(text);

  var clientId = getProp_('YAHOO_CLIENT_ID', '');
  if (!clientId) return fallbackTokenize(text);

  var yahooTokens = callYahooMA_(text, clientId);
  if (yahooTokens === null) return fallbackTokenize(text);

  return { tokens: yahooTokens, isNewPairAllowed: true };
}

/**
 * Yahoo 形態素解析 API V2 を呼び出す。成功時はトークン配列、失敗時は null。
 * @param {string} text
 * @param {string} clientId
 * @returns {string[]|null}
 */
function callYahooMA_(text, clientId) {
  try {
    var body = JSON.stringify({
      id: '1',
      jsonrpc: '2.0',
      method: 'jlp.maservice.parse',
      params: { q: text }
    });
    // GAS は User-Agent ヘッダを正しく送れない場合があるため
    // ?appid= クエリパラメータも併用する(Yahoo JLP V2 は両方を受け付ける)
    var res = UrlFetchApp.fetch(
      'https://jlp.yahooapis.jp/MAService/V2/parse?appid=' + encodeURIComponent(clientId),
      {
        method: 'post',
        contentType: 'application/json',
        headers: { 'User-Agent': 'Yahoo AppID: ' + clientId },
        payload: body,
        muteHttpExceptions: true
      }
    );
    incrementCounter('URL_FETCH', 'system');

    if (res.getResponseCode() !== 200) {
      logError('callYahooMA_', 'HTTP ' + res.getResponseCode() + ': ' + res.getContentText().substring(0, 300), 'system');
      return null;
    }
    return parseYahooResponse(JSON.parse(res.getContentText()));
  } catch (e) {
    logError('callYahooMA_', String(e), 'system');
    return null;
  }
}

// ===================================================================
// 学習
// ===================================================================

/**
 * UnifiedNote 配列から N-gram ストアに学習させる。
 * @param {Array} notes    UnifiedNote の配列
 * @param {NGramStore} ngramStore
 */
function learnFromNotes_(notes, ngramStore) {
  if (!notes || notes.length === 0) return;

  var excludeBots = parseBool(getConfig('LEARN_EXCLUDE_BOTS', 'TRUE'), true);
  var saveRaw     = parseInt(getConfig('LEARN_RAW_RETENTION_DAYS', '7'), 10) > 0;
  var platform    = getConfig('BOT_PLATFORM', 'misskey');
  var processedSheet = platform === 'mastodon'
    ? getSheet_(SHEET.PROCESSED_MASTODON)
    : getSheet_(SHEET.PROCESSED_MISSKEY);
  var rawSheet = saveRaw ? getSheet_(SHEET.RAW_LEARN) : null;

  var blacklist = _loadBlacklist_();
  var now = new Date().toISOString();

  for (var i = 0; i < notes.length; i++) {
    var note = notes[i];
    if (!note || !note.id) continue;
    if (excludeBots && note.author && note.author.is_bot) continue;
    if (note.author && note.author.is_self) continue;
    if (_isBlacklisted_(note, blacklist)) continue;

    var raw = note.text_clean || note.text_raw || '';
    var cleaned = cleanNoteText(raw);
    if (!cleaned || cleaned.length < 2) continue;

    var sentences = splitIntoSentences(cleaned);
    if (sentences.length === 0) continue;

    // 文ごとにトークン化して学習
    var sentenceTokens = [];
    var isNewPairAllowed = true;
    for (var s = 0; s < sentences.length; s++) {
      var result = tokenizeNote_(sentences[s]);
      if (result.tokens.length > 0) {
        sentenceTokens.push(result.tokens);
        // いずれか1文でも F1 フォールバックなら新規追加禁止
        if (!result.isNewPairAllowed) isNewPairAllowed = false;
      }
    }
    if (sentenceTokens.length === 0) continue;

    learn(sentenceTokens, ngramStore, isNewPairAllowed);

    // 処理済み ID 登録
    if (processedSheet) {
      try { processedSheet.appendRow([note.id, now, 'learn']); } catch (_) {}
    }

    // 生学習データ保存
    if (rawSheet) {
      try {
        rawSheet.appendRow([
          note.id,
          platform,
          (note.author && note.author.acct) || '',
          cleaned,
          now,
          sentenceTokens.map(function (t) { return t.join(' '); }).join(' | ')
        ]);
      } catch (_) {}
    }

    incrementCounter('LEARN', platform);
  }
}

/**
 * ブラックリストシートからユーザー/インスタンス除外リストを読み込む。
 */
function _loadBlacklist_() {
  var sheet = getSheet_(SHEET.BLACKLIST);
  if (!sheet) return { users: [], instances: [] };
  var rows = sheet.getDataRange().getValues();
  var users = [];
  var instances = [];
  for (var i = 1; i < rows.length; i++) {
    var type = String(rows[i][0]).trim();
    var id = String(rows[i][1]).trim().toLowerCase();
    if (!id) continue;
    if (type === 'user') users.push(id);
    else if (type === 'instance') instances.push(id);
  }
  return { users: users, instances: instances };
}

/**
 * ノートがブラックリストに該当するか判定する。
 */
function _isBlacklisted_(note, blacklist) {
  if (!note.author) return false;
  var acct = (note.author.acct || '').toLowerCase();
  if (blacklist.users.indexOf(acct) !== -1) return true;
  var parts = acct.split('@');
  var host = parts.length >= 2 ? parts[parts.length - 1] : '';
  if (host && blacklist.instances.indexOf(host) !== -1) return true;
  return false;
}

// ===================================================================
// 投稿生成
// ===================================================================

/**
 * マルコフ連鎖で投稿テキストを生成する（NG・重複チェック込み）。
 * 全試行失敗時は null を返す。
 * @param {NGramStore} ngramStore
 * @returns {string|null}
 */
function generatePost_(ngramStore) {
  var maxRetry = parseInt(getConfig('MARKOV_MAX_RETRY', '5'), 10);
  var config = {
    sentences_min: parseInt(getConfig('POST_SENTENCES_MIN', '3'), 10),
    sentences_max: parseInt(getConfig('POST_SENTENCES_MAX', '5'), 10),
    min_length:    parseInt(getConfig('MARKOV_MIN_LENGTH',  '8'), 10),
    max_length:    parseInt(getConfig('MARKOV_MAX_LENGTH',  '140'), 10),
    emoji_rate:    parseInt(getConfig('MARKOV_EMOJI_RATE',  '20'), 10)
  };

  var emojis = _loadEmojiNames_();
  var ngwords = loadNGWords();
  var history = _loadRecentPostHistory_();
  var dupThreshold = parseFloat(getConfig('POST_DUPLICATE_SIMILARITY', '0.8'));

  for (var attempt = 0; attempt < maxRetry; attempt++) {
    var text = generate(ngramStore, config, emojis, Math.random);
    if (!text) continue;
    if (containsNGWord(text, ngwords)) continue;
    if (_isDuplicate_(text, history, dupThreshold)) continue;
    return text;
  }
  return null;
}

/**
 * 自鯖カスタム絵文字シートから絵文字名（:name: 形式）のリストを返す。
 */
function _loadEmojiNames_() {
  var sheet = getSheet_(SHEET.EMOJIS);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var rows = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var names = [];
  for (var i = 0; i < rows.length; i++) {
    var name = String(rows[i][0]).trim();
    if (name) names.push(':' + name + ':');
  }
  return names;
}

/**
 * 投稿履歴ハッシュシートから直近 N 件のテキストを返す（列4: original_text）。
 */
function _loadRecentPostHistory_() {
  var recentCount = parseInt(getConfig('POST_DUPLICATE_RECENT_COUNT', '100'), 10);
  var sheet = getSheet_(SHEET.POST_HISTORY);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var startRow = Math.max(2, lastRow - recentCount + 1);
  var rows = sheet.getRange(startRow, 4, lastRow - startRow + 1, 1).getValues();
  var texts = [];
  for (var i = 0; i < rows.length; i++) {
    var t = String(rows[i][0]).trim();
    if (t) texts.push(t);
  }
  return texts;
}

/**
 * 生成テキストが既存投稿と重複しているか判定する（完全一致 + Jaccard）。
 */
function _isDuplicate_(text, history, threshold) {
  for (var i = 0; i < history.length; i++) {
    if (history[i] === text) return true;
    if (threshold > 0 && jaccardSimilarity(text, history[i]) > threshold) return true;
  }
  return false;
}
