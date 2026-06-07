// ===================================================================
// Maintenance.gs — 日次メンテナンス・フォロー同期・各種ローテーション
// ===================================================================

// ===================================================================
// 日次メンテナンス
// ===================================================================

/**
 * 0時台のトリガーから mainDispatcher 経由で呼ばれる。
 * LAST_MAINTENANCE_DATE で1日1回だけ実行する。
 */
function runDailyMaintenance() {
  var tz = 'Asia/Tokyo';
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  if (getProp_('LAST_MAINTENANCE_DATE') === today) return;

  // 前日のダッシュボード行を追記
  var yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  try { writeDashboard_(yesterday); } catch (e) {
    logError('runDailyMaintenance:writeDashboard_', String(e), 'system');
  }

  // 各ローテーション（時間ガード付き）
  if (isTimeSafe(240000)) {
    try { rotateErrorLog(); } catch (e) {
      logError('runDailyMaintenance:rotateErrorLog', String(e), 'system');
    }
  }

  if (isTimeSafe(210000)) {
    try { rotatePostHistory(); } catch (e) {
      logError('runDailyMaintenance:rotatePostHistory', String(e), 'system');
    }
  }

  if (isTimeSafe(180000)) {
    try {
      rotateProcessedIds('misskey');
      rotateProcessedIds('mastodon');
    } catch (e) {
      logError('runDailyMaintenance:rotateProcessedIds', String(e), 'system');
    }
  }

  if (isTimeSafe(150000)) {
    try { rotateRawLearnData(); } catch (e) {
      logError('runDailyMaintenance:rotateRawLearnData', String(e), 'system');
    }
  }

  if (isTimeSafe(120000)) {
    try { runFollowSync(); } catch (e) {
      logError('runDailyMaintenance:runFollowSync', String(e), 'system');
    }
  }

  if (isTimeSafe(90000)) {
    try { executeAutoDelete(); } catch (e) {
      logError('runDailyMaintenance:executeAutoDelete', String(e), 'system');
    }
  }

  if (isTimeSafe(60000)) {
    try { refreshCustomEmojis(); } catch (e) {
      logError('runDailyMaintenance:refreshCustomEmojis', String(e), 'system');
    }
  }

  try { cleanupProperties_(); } catch (e) {
    logError('runDailyMaintenance:cleanupProperties_', String(e), 'system');
  }

  if (isTimeSafe(30000)) {
    try { cleanNgramInvisibleTokens_(); } catch (e) {
      logError('runDailyMaintenance:cleanNgramInvisibleTokens_', String(e), 'system');
    }
  }

  setProp_('LAST_MAINTENANCE_DATE', today);
}

// ===================================================================
// フォロー同期
// ===================================================================

/**
 * フォロワー/フォロー一覧を API から取得してフォロー管理シートを更新する。
 */
function runFollowSync() {
  var platform = getConfig('BOT_PLATFORM', 'misskey');
  var adapter = createAdapter(platform);
  var autoFollowBack = parseBool(getConfig('FOLLOW_AUTO_FOLLOW_BACK', 'TRUE'), true);
  var graceCycles    = parseInt(getConfig('FOLLOW_UNFOLLOW_GRACE_CYCLES', '2'), 10);

  // フォロワー/フォロー中を取得
  var followers = [];
  var following = [];
  try {
    followers = adapter.getFollowers({ max_pages: 10 });
  } catch (e) {
    logError('runFollowSync:getFollowers', String(e), platform);
  }
  try {
    following = adapter.getFollowing({ max_pages: 10 });
  } catch (e) {
    logError('runFollowSync:getFollowing', String(e), platform);
  }

  var sheet = getSheet_(SHEET.FOLLOWS);
  if (!sheet) return;

  var now = new Date().toISOString();

  // 既存レコードをMap<userId, rowIndex>で管理
  var lastRow = sheet.getLastRow();
  var existingData = [];
  if (lastRow >= 2) {
    existingData = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  }
  var rowMap = {}; // "platform:userId" → rowIndex
  for (var i = 0; i < existingData.length; i++) {
    var key = String(existingData[i][0]) + ':' + String(existingData[i][1]);
    rowMap[key] = i;
  }

  // フォロワーセット構築
  var followerSet = {};
  for (var f = 0; f < followers.length; f++) {
    var fu = followers[f];
    if (fu && fu.id) followerSet[String(fu.id)] = fu;
  }
  // フォロー中セット構築
  var followingSet = {};
  for (var g = 0; g < following.length; g++) {
    var gu = following[g];
    if (gu && gu.id) followingSet[String(gu.id)] = gu;
  }

  // 全ユーザーをマージ
  var allIds = {};
  for (var fid in followerSet) allIds[fid] = true;
  for (var gid in followingSet) allIds[gid] = true;

  for (var uid in allIds) {
    var isFollower  = !!followerSet[uid];
    var iFollowing  = !!followingSet[uid];
    var userInfo    = followerSet[uid] || followingSet[uid];
    var acct        = (userInfo && userInfo.acct) ? userInfo.acct : '';
    var rKey        = platform + ':' + uid;

    if (rowMap.hasOwnProperty(rKey)) {
      var ri = rowMap[rKey];
      var prevFollowing = existingData[ri][4];
      var missingCount  = parseInt(existingData[ri][5] || '0', 10);

      // フォロバ解除判定: 前回フォロワーだったが今回いない
      if (prevFollowing && !isFollower) {
        missingCount++;
        if (missingCount >= graceCycles) {
          try {
            adapter.unfollow(uid);
            incrementCounter('UNFOLLOW', platform);
            missingCount = 0;
            iFollowing = false;
          } catch (e) {
            logError('runFollowSync:unfollow', String(e), platform);
          }
        }
      } else if (isFollower) {
        missingCount = 0;
      }

      existingData[ri][3] = isFollower;
      existingData[ri][4] = iFollowing;
      existingData[ri][5] = missingCount;
      existingData[ri][7] = now;
    } else {
      // 新規ユーザー
      var isBot = userInfo && userInfo.is_bot;
      var followedBackAt = '';

      if (isFollower && autoFollowBack && !iFollowing && !isBot) {
        try {
          adapter.follow(uid);
          incrementCounter('FOLLOW_BACK', platform);
          iFollowing = true;
          followedBackAt = now;
        } catch (e) {
          logError('runFollowSync:follow', String(e), platform);
        }
      }

      var newRow = [platform, uid, acct, isFollower, iFollowing, 0, followedBackAt, now];
      existingData.push(newRow);
      rowMap[rKey] = existingData.length - 1;
    }
  }

  // フォロー管理シートを書き戻す
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 8).clearContent();
  }
  if (existingData.length > 0) {
    sheet.getRange(2, 1, existingData.length, 8).setValues(existingData);
  }
}

// ===================================================================
// 自動削除
// ===================================================================

/**
 * 投稿履歴の古い投稿を API 経由で削除する。MAINTENANCE_ENABLED ガード付き。
 */
function executeAutoDelete() {
  if (!parseBool(getConfig('MAINTENANCE_ENABLED', 'TRUE'), true)) return;

  var retentionDays = parseInt(getConfig('MAINTENANCE_CLEANUP_DAYS', '30'), 10);
  var sheet = getSheet_(SHEET.POST_HISTORY);
  if (!sheet) return;

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  var cutoffStr = cutoff.toISOString();

  var rows = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  var toDelete = []; // 削除対象の行インデックス（0始まり）

  for (var i = 0; i < rows.length; i++) {
    var postedAt = String(rows[i][1]).trim();
    if (postedAt && postedAt < cutoffStr) {
      toDelete.push(i);
    }
  }

  if (toDelete.length === 0) return;

  // 削除は逆順（インデックスずれ防止）
  for (var d = toDelete.length - 1; d >= 0; d--) {
    if (!isTimeSafe(30000)) break;
    // 削除（失敗は無視）
    sheet.deleteRow(toDelete[d] + 2); // 1行目=ヘッダ、2行目からデータ
  }
}

// ===================================================================
// ローテーション
// ===================================================================

/**
 * 処理済み投稿 ID シートの保持期間超過行を削除する。
 * @param {string} platform 'misskey' または 'mastodon'
 */
function rotateProcessedIds(platform) {
  var sheetName = platform === 'mastodon'
    ? SHEET.PROCESSED_MASTODON
    : SHEET.PROCESSED_MISSKEY;
  var sheet = getSheet_(sheetName);
  if (!sheet) return;

  var retentionDays = parseInt(getConfig('PROCESSED_ID_RETENTION_DAYS', '14'), 10);
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  var cutoffStr = cutoff.toISOString();

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var rows = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  var retained = rows.filter(function (r) {
    return String(r[1]).trim() >= cutoffStr;
  });

  sheet.getRange(2, 1, lastRow - 1, 3).clearContent();
  if (retained.length > 0) {
    sheet.getRange(2, 1, retained.length, 3).setValues(retained);
  }
}

/**
 * 投稿履歴ハッシュシートが 10,000 行を超えたら古い順に削除する。
 */
function rotatePostHistory() {
  var limit = 10000;
  var sheet = getSheet_(SHEET.POST_HISTORY);
  if (!sheet) return;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var dataRows = lastRow - 1;
  if (dataRows <= limit) return;

  var excess = dataRows - limit;
  // 古い行（上から）を一括削除
  sheet.deleteRows(2, excess);
}

/**
 * 生学習データシートの保持日数超過行を削除する。
 */
function rotateRawLearnData() {
  var sheet = getSheet_(SHEET.RAW_LEARN);
  if (!sheet) return;

  var retentionDays = parseInt(getConfig('LEARN_RAW_RETENTION_DAYS', '7'), 10);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  if (retentionDays <= 0) {
    sheet.getRange(2, 1, lastRow - 1, 6).clearContent();
    return;
  }

  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  var cutoffStr = cutoff.toISOString();

  var rows = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  var retained = rows.filter(function (r) {
    return String(r[4]).trim() >= cutoffStr;
  });

  sheet.getRange(2, 1, lastRow - 1, 6).clearContent();
  if (retained.length > 0) {
    sheet.getRange(2, 1, retained.length, 6).setValues(retained);
  }
}

/**
 * エラーログシートが 3,000 行を超えたら古い順に削除する（時間ガード付き）。
 */
function rotateErrorLog() {
  var limit = 3000;
  var sheet = getSheet_(SHEET.ERROR_LOG);
  if (!sheet) return;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var dataRows = lastRow - 1;
  if (dataRows <= limit) return;

  if (!isTimeSafe(120000)) return;

  var excess = dataRows - limit;
  sheet.deleteRows(2, excess);
}

// ===================================================================
// カスタム絵文字更新
// ===================================================================

/**
 * EMOJI_REFRESH_INTERVAL_DAYS 間隔で自鯖カスタム絵文字リストを更新する。
 */
function refreshCustomEmojis() {
  var intervalDays = parseInt(getConfig('EMOJI_REFRESH_INTERVAL_DAYS', '7'), 10);
  var lastRefresh  = getProp_('LAST_EMOJI_REFRESH_AT', '');
  if (lastRefresh) {
    var elapsed = (Date.now() - new Date(lastRefresh).getTime()) / 86400000;
    if (elapsed < intervalDays) return;
  }

  var platform = getConfig('BOT_PLATFORM', 'misskey');
  var adapter = createAdapter(platform);
  var emojis;
  try {
    emojis = adapter.getCustomEmojis();
  } catch (e) {
    logError('refreshCustomEmojis:getCustomEmojis', String(e), platform);
    return;
  }

  if (!emojis || emojis.length === 0) return;

  // NGカスタム絵文字をシート登録前に除外
  var ngEmojis = loadNgEmojis_();
  if (ngEmojis.length > 0) {
    emojis = emojis.filter(function (e) {
      return !isNgEmoji(e && e.name, ngEmojis);
    });
  }

  // EMOJI_MAX_COUNT を超える場合はランダムサンプリング
  var maxCount = parseInt(getConfig('EMOJI_MAX_COUNT', '500'), 10);
  if (emojis.length > maxCount) {
    emojis = _sampleArray_(emojis, maxCount);
  }

  var sheet = getSheet_(SHEET.EMOJIS);
  if (!sheet) return;

  var now = new Date().toISOString();
  var rows = emojis.map(function (e) {
    return [
      e.name || '',
      e.category || '',
      Array.isArray(e.aliases) ? e.aliases.join(',') : '',
      e.url || '',
      now
    ];
  });

  // 全洗い替え
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 5).clearContent();
  }
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 5).setValues(rows);
  }

  setProp_('LAST_EMOJI_REFRESH_AT', now);
  Logger.log('refreshCustomEmojis: ' + rows.length + ' 件更新');
}

/**
 * 配列からランダムに n 件サンプリングする。
 */
function _sampleArray_(arr, n) {
  var copy = arr.slice();
  var result = [];
  for (var i = 0; i < n && copy.length > 0; i++) {
    var idx = Math.floor(Math.random() * copy.length);
    result.push(copy.splice(idx, 1)[0]);
  }
  return result;
}

// ===================================================================
// PropertiesService クリーンアップ
// ===================================================================

/**
 * 30日以上前の日次カウンタキーを削除する（Core.gs の cleanupOldCounters_ を呼ぶ）。
 */
function cleanupProperties_() {
  cleanupOldCounters_();
}

// ===================================================================
// N-gram 不可視文字クリーンアップ
// ===================================================================

/**
 * N-gram シートから不可視文字(U+200B 等)を含む行を削除する。
 * ゼロ幅スペース混入投稿を学習してしまった際の汚染トークンを除去する。
 */
function cleanNgramInvisibleTokens_() {
  var sheet = getSheet_(SHEET.NGRAM);
  if (!sheet) return;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  var toDelete = [];
  var i;
  for (i = 0; i < data.length; i++) {
    var prev = String(data[i][0]);
    var next = String(data[i][1]);
    if (/[­​-‏⁠-⁤﻿]/.test(prev) || /[­​-‏⁠-⁤﻿]/.test(next)) {
      toDelete.push(i + 2);
    }
  }

  for (var d = toDelete.length - 1; d >= 0; d--) {
    if (!isTimeSafe(10000)) break;
    sheet.deleteRow(toDelete[d]);
  }
}
