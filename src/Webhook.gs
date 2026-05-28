// ===================================================================
// Webhook.gs — Misskey webhook エンドポイント・メンション返信・フォローバック
// ===================================================================

/**
 * GAS Web Apps エンドポイント（Misskey webhook 受信口）。
 * @param {object} e
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function doPost(e) {
  var MIME = ContentService.MimeType.TEXT;
  var platform = 'misskey';

  // webhook 無効時はスキップ
  if (!parseBool(getConfig('MISSKEY_WEBHOOK_ENABLED', 'TRUE'), true)) {
    return ContentService.createTextOutput('Disabled').setMimeType(MIME);
  }

  // raw body 取得
  var rawBody;
  try {
    rawBody = e.postData.getDataAsString();
  } catch (_) {
    return ContentService.createTextOutput('Bad Request').setMimeType(MIME);
  }

  // Misskey 署名検証
  var adapter;
  try {
    adapter = createAdapter(platform);
    var sigHeader = (e.parameter && e.parameter['X-Misskey-Hook-Secret']) || '';
    // GAS Web Apps ではヘッダが e.postData.headers に入る場合がある
    if (!sigHeader && e.postData && e.postData.headers) {
      sigHeader = e.postData.headers['X-Misskey-Hook-Secret'] || '';
    }
    var webhookSecret = getProp_('MISSKEY_WEBHOOK_SECRET', '');
    if (!adapter.verifyWebhookSignature(webhookSecret, sigHeader, rawBody)) {
      return ContentService.createTextOutput('Unauthorized').setMimeType(MIME);
    }
  } catch (err) {
    logError('doPost:verifySignature', String(err), platform);
    return ContentService.createTextOutput('Internal Error').setMimeType(MIME);
  }

  // 通知パース
  var unified;
  try {
    var parsed = JSON.parse(rawBody);
    unified = adapter.parseNotification(parsed);
  } catch (err) {
    logError('doPost:parseNotification', String(err), platform);
    return ContentService.createTextOutput('Parse Error').setMimeType(MIME);
  }

  if (unified && unified._notif_type === 'mention') {
    try {
      handleMention(unified);
    } catch (err) {
      logError('doPost:handleMention', String(err), platform);
    }
  } else if (unified && unified._notif_type === 'followed') {
    try {
      handleFollowed(unified, adapter, platform);
    } catch (err) {
      logError('doPost:handleFollowed', String(err), platform);
    }
  }

  return ContentService.createTextOutput('OK').setMimeType(MIME);
}

// ===================================================================
// メンション返信
// ===================================================================

/**
 * メンションを受け取り、3層重複防止チェック後にマルコフ返信を行う。
 * @param {object} note  UnifiedNote
 */
function handleMention(note) {
  if (!note || !note.id) return;

  var platform = note.platform || getConfig('BOT_PLATFORM', 'misskey');
  var noteId = String(note.id);

  // --- 各種有効判定 ---
  if (!parseBool(getConfig('MENTION_ENABLED', 'TRUE'), true)) return;

  var excludeBots = parseBool(getConfig('MENTION_EXCLUDE_BOTS', 'TRUE'), true);
  if (excludeBots && note.author && note.author.is_bot) return;

  // --- アダプタ生成（Layer 3 / MUTUAL_ONLY / postNote で共用）---
  var adapter;
  try {
    adapter = createAdapter(platform);
  } catch (err) {
    logError('handleMention:createAdapter', String(err), platform);
    return;
  }

  // --- 3層重複防止 ---
  var cacheKey = 'PM_' + noteId;

  // Layer 1: CacheService（6時間）
  try {
    if (CacheService.getScriptCache().get(cacheKey)) return;
  } catch (_) {}

  // Layer 2: PropertiesService（永続）
  if (getProp_(cacheKey)) return;

  // Layer 3: API（getRepliesTo）— コスト高いため最後に確認
  try {
    var replies = adapter.getRepliesTo(noteId);
    if (replies && replies.length > 0) {
      // 既返信済みをマーク
      _markProcessed_(cacheKey);
      return;
    }
  } catch (_) {}

  // --- フォロー関係を一度だけ取得（キーワードFB + MUTUAL_ONLY で共用）---
  var cachedRel = null;
  if (note.author) {
    try {
      cachedRel = adapter.getRelation(note.author.id);
      logError('handleMention:rel', 'id=' + note.author.id + ' rel=' + JSON.stringify(cachedRel), platform);
    } catch (e) {
      logError('handleMention:getRelation', String(e) + ' id=' + note.author.id, platform);
    }
  }

  // --- キーワードフォローバック（MUTUAL_ONLY より前に評価）---
  // MUTUAL_ONLY で返信をスキップする場合でもフォローバックは行う
  var textForCheck = note.text_clean || note.text_raw || '';
  if (checkKeywordFollowBack_(textForCheck) && note.author && !note.author.is_bot) {
    if (!cachedRel || !cachedRel.following) {
      try {
        adapter.follow(note.author.id);
        incrementCounter('FOLLOW_BACK', platform);
        logError('handleMention:follow:ok', 'キーワードFB完了 id=' + note.author.id, platform);
        // フォロー後は following=true として扱う
        if (cachedRel) cachedRel.following = true;
      } catch (err) {
        logError('handleMention:follow', String(err), platform);
      }
    } else {
      logError('handleMention:follow:skip', '既フォロー済み id=' + note.author.id, platform);
    }
  }

  // --- MENTION_MUTUAL_ONLY 判定 ---
  if (parseBool(getConfig('MENTION_MUTUAL_ONLY', 'TRUE'), true) && note.author) {
    if (!cachedRel || !cachedRel.following) return;
  }

  // --- レート制限 ---
  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  var hour  = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'HH');
  var userId = note.author ? String(note.author.id) : 'unknown';

  // ユーザー別返信上限
  var maxPerUser = parseInt(getConfig('MENTION_MAX_PER_USER_PER_DAY', '10'), 10);
  var userCountKey = 'REPLY_COUNT_' + userId + '_' + today;
  var userCount = parseInt(getProp_(userCountKey, '0'), 10);
  if (userCount >= maxPerUser) return;

  // 全体時間あたり返信上限
  var maxGlobal = parseInt(getConfig('MENTION_GLOBAL_MAX_PER_HOUR', '20'), 10);
  var globalKey = 'REPLY_COUNT_global_' + today + '_' + hour;
  var globalCount = parseInt(getProp_(globalKey, '0'), 10);
  if (globalCount >= maxGlobal) return;

  // --- マルコフ生成 ---
  var ngramStore = loadNgramStore_();
  var replyText = generatePost_(ngramStore);
  flushNgramStore_(ngramStore);

  if (!replyText) {
    replyText = getConfig('MENTION_FALLBACK_TEXT', '生成失敗しちゃった');
  }

  // --- 返信投稿 ---
  var visibility = note.visibility || 'home';
  try {
    adapter.postNote(replyText, { replyId: noteId, visibility: visibility });
  } catch (err) {
    logError('handleMention:postNote', String(err), platform);
    return;
  }

  // --- 処理済みマーク / カウンタ更新 ---
  _markProcessed_(cacheKey);
  setProp_(userCountKey, String(userCount + 1));
  setProp_(globalKey, String(globalCount + 1));
  incrementCounter('REPLY', platform);
}

// ===================================================================
// フォローバック処理
// ===================================================================

/**
 * followed イベントを受け取り、FOLLOW_AUTO_FOLLOW_BACK が有効ならフォローバックする。
 * @param {object} unified  parseNotification が返す unified オブジェクト
 * @param {object} adapter  createAdapter() で生成済みのアダプタ
 * @param {string} platform
 */
function handleFollowed(unified, adapter, platform) {
  if (!parseBool(getConfig('FOLLOW_AUTO_FOLLOW_BACK', 'TRUE'), true)) {
    logError('handleFollowed:skip', 'FOLLOW_AUTO_FOLLOW_BACK=FALSE', platform);
    return;
  }
  if (!unified.author || !unified.author.id) {
    logError('handleFollowed:skip', 'author.id なし unified=' + JSON.stringify(unified), platform);
    return;
  }
  if (unified.author.is_bot && parseBool(getConfig('MENTION_EXCLUDE_BOTS', 'TRUE'), true)) {
    logError('handleFollowed:skip', 'ボットアカウント id=' + unified.author.id, platform);
    return;
  }

  var userId = unified.author.id;

  // 既にフォロー中なら重複してフォローしない
  var relRaw;
  try {
    relRaw = adapter.getRelation(userId);
    if (relRaw && relRaw.following) {
      logError('handleFollowed:skip', '既フォロー済み id=' + userId + ' rel=' + JSON.stringify(relRaw), platform);
      return;
    }
  } catch (e) {
    logError('handleFollowed:getRelation', String(e) + ' id=' + userId, platform);
  }

  try {
    adapter.follow(userId);
    incrementCounter('FOLLOW_BACK', platform);
    logError('handleFollowed:ok', 'フォローバック完了 id=' + userId, platform);
  } catch (err) {
    logError('handleFollowed:follow', String(err) + ' id=' + userId, platform);
  }
}

/**
 * 処理済みフラグを CacheService と PropertiesService に記録する。
 */
function _markProcessed_(cacheKey) {
  try {
    CacheService.getScriptCache().put(cacheKey, '1', 21600); // 6時間
  } catch (_) {}
  try {
    setProp_(cacheKey, '1');
  } catch (_) {}
}

// ===================================================================
// キーワードフォローバック判定
// ===================================================================

/**
 * テキストに FOLLOW_KEYWORDS のいずれかが含まれていれば true を返す。
 * @param {string} text
 * @returns {boolean}
 */
function checkKeywordFollowBack_(text) {
  if (!parseBool(getConfig('FOLLOW_KEYWORD_ENABLED', 'TRUE'), true)) return false;
  var keywords = getConfig('FOLLOW_KEYWORDS', 'フォローして,followして,相互フォロー');
  if (!keywords) return false;

  var kws = keywords.split(',');
  var lowerText = (text || '').toLowerCase();
  for (var i = 0; i < kws.length; i++) {
    var kw = kws[i].trim().toLowerCase();
    if (kw && lowerText.indexOf(kw) !== -1) return true;
  }
  return false;
}
