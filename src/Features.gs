// ===================================================================
// Features.gs — 業務ロジック: 自動投稿・学習・Mastodon ポーリング・ダッシュボード
// ===================================================================

// ===================================================================
// トリガーエントリポイント
// ===================================================================

/**
 * 1時間ごとのトリガーから呼び出されるメイン関数。
 * LockService で二重実行を防止する。
 */
function onHourlyTrigger() {
  if (getConfig('BOT_ACTIVE', 'FALSE') !== 'TRUE') return;

  var lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(3000)) {
      Logger.log('onHourlyTrigger: ロック取得失敗、スキップします');
      return;
    }
    mainDispatcher();
  } catch (e) {
    logError('onHourlyTrigger', String(e), 'system');
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

/**
 * 各業務ロジックを時間予算付きで順次実行する。
 */
function mainDispatcher() {
  var platform = getConfig('BOT_PLATFORM', 'misskey');

  // 1. 日次メンテナンス（残り4分以上ある場合）
  if (isTimeSafe(240000)) {
    try { runDailyMaintenance(); } catch (e) {
      logError('mainDispatcher:runDailyMaintenance', String(e), 'system');
    }
  }

  // 2. 学習処理（残り3分以上）
  if (isTimeSafe(180000)) {
    try { processLearn(); } catch (e) {
      logError('mainDispatcher:processLearn', String(e), platform);
    }
  }

  // 3. 自動投稿（残り2分以上）
  if (isTimeSafe(120000)) {
    try { processMarkovPost(); } catch (e) {
      logError('mainDispatcher:processMarkovPost', String(e), platform);
    }
  }

  // 4. Mastodon ポーリング（残り1分以上 かつ Mastodon のみ）
  if (isTimeSafe(60000) && platform === 'mastodon') {
    try { processMastodonPolling(); } catch (e) {
      logError('mainDispatcher:processMastodonPolling', String(e), 'mastodon');
    }
  }
}

// ===================================================================
// 学習処理
// ===================================================================

/**
 * タイムラインを取得して N-gram 学習を行う。
 */
function processLearn() {
  var platform = getConfig('BOT_PLATFORM', 'misskey');
  var adapter = createAdapter(platform);
  var notesPerTrigger = parseInt(getConfig('LEARN_NOTES_PER_TRIGGER', '50'), 10);
  var learnFromMentions = getConfig('LEARN_FROM_MENTIONS', 'FALSE') === 'TRUE';
  var ownUserId = getProp_('OWN_USER_ID', '');

  // TL 取得
  var notes;
  try {
    notes = adapter.getTimeline({ max_pages: 2, max_items: notesPerTrigger });
  } catch (e) {
    logError('processLearn:getTimeline', String(e), platform);
    return;
  }

  if (!notes || notes.length === 0) return;

  // 処理済み ID のフィルタリング
  var processedIds = _loadProcessedIds_(platform);
  var filtered = notes.filter(function (note) {
    if (!note || !note.id) return false;
    if (processedIds.indexOf(String(note.id)) !== -1) return false;
    // メンション除外（LEARN_FROM_MENTIONS=FALSE かつ自分へのメンションを含む）
    if (!learnFromMentions && ownUserId && note.mentions) {
      if (note.mentions.indexOf(ownUserId) !== -1) return false;
    }
    return true;
  });

  if (filtered.length === 0) return;

  var ngramStore = loadNgramStore_();
  learnFromNotes_(filtered, ngramStore);
  flushNgramStore_(ngramStore);
}

/**
 * 処理済み投稿 ID セットをシートから読み込む。
 */
function _loadProcessedIds_(platform) {
  var sheetName = platform === 'mastodon'
    ? SHEET.PROCESSED_MASTODON
    : SHEET.PROCESSED_MISSKEY;
  var sheet = getSheet_(sheetName);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var rows = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var ids = [];
  for (var i = 0; i < rows.length; i++) {
    var id = String(rows[i][0]).trim();
    if (id) ids.push(id);
  }
  return ids;
}

// ===================================================================
// 自動投稿
// ===================================================================

/**
 * マルコフ連鎖で投稿を生成して公開する。
 * 夜間・最短間隔・確率判定を経て投稿する。
 */
function processMarkovPost() {
  var platform = getConfig('BOT_PLATFORM', 'misskey');

  // 夜間判定
  if (isNightTime()) return;

  // 最短投稿間隔判定
  var intervalMin = parseInt(getConfig('POST_INTERVAL_MIN_MINUTES', '30'), 10);
  var lastPostAt = parseInt(getProp_('LAST_POST_AT', '0'), 10);
  if (Date.now() - lastPostAt < intervalMin * 60 * 1000) return;

  // 確率判定
  var chance = parseInt(getConfig('POST_CHANCE', '40'), 10);
  if (Math.random() * 100 >= chance) return;

  // N-gram ストアロード
  var ngramStore = loadNgramStore_();

  // 投稿生成
  var text = generatePost_(ngramStore);
  if (!text) {
    logError('processMarkovPost', 'マルコフ生成失敗（全リトライ消費）', platform);
    flushNgramStore_(ngramStore);
    return;
  }

  // 剪定が必要なら実行
  var maxRows   = parseInt(getConfig('NGRAM_MAX_ROWS',        '50000'), 10);
  var pruneAt   = parseInt(getConfig('NGRAM_PRUNE_THRESHOLD', '45000'), 10);
  var decay     = parseFloat(getConfig('NGRAM_PRUNE_DECAY',   '0.05'));
  if (ngramStore.size > pruneAt) {
    ngramStore.prune(maxRows, decay);
  }

  flushNgramStore_(ngramStore);

  // 投稿実行
  var visibility = getConfig('POST_VISIBILITY', 'home');
  var adapter = createAdapter(platform);
  var posted;
  try {
    posted = adapter.postNote(text, { visibility: visibility });
  } catch (e) {
    logError('processMarkovPost:postNote', String(e), platform);
    return;
  }

  // 投稿履歴保存
  _savePostHistory_(text, platform);

  // カウンタ・タイムスタンプ更新
  incrementCounter('POST', platform);
  setProp_('LAST_POST_AT', String(Date.now()));

  Logger.log('processMarkovPost: 投稿完了 id=' + (posted && posted.id));
}

/**
 * 投稿テキストを POST_HISTORY シートに保存する。
 */
function _savePostHistory_(text, platform) {
  var sheet = getSheet_(SHEET.POST_HISTORY);
  if (!sheet) return;
  try {
    // SHA-256 ハッシュの代わりに Utilities.computeDigest で生成
    var digest = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      text,
      Utilities.Charset.UTF_8
    );
    var hex = digest.map(function (b) {
      return ('0' + (b & 0xff).toString(16)).slice(-2);
    }).join('').substring(0, 16);
    var ts = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
    sheet.appendRow([hex, ts, platform, text]);
  } catch (_) {}
}

// ===================================================================
// Mastodon ポーリング
// ===================================================================

/**
 * Mastodon の通知をポーリングしてメンションを処理する。
 */
function processMastodonPolling() {
  var adapter = createAdapter('mastodon');

  var options = { max_pages: 3 };

  var notifications;
  try {
    notifications = adapter.getMentions(options);
  } catch (e) {
    logError('processMastodonPolling:getMentions', String(e), 'mastodon');
    return;
  }

  if (!notifications || notifications.length === 0) return;

  // 各メンションを処理（handleMention は Webhook.gs に定義）
  for (var i = 0; i < notifications.length; i++) {
    if (!isTimeSafe(30000)) break;
    try {
      handleMention(notifications[i]);
    } catch (e) {
      logError('processMastodonPolling:handleMention', String(e), 'mastodon');
    }
  }
}

// ===================================================================
// ダッシュボード書き込み
// ===================================================================

/**
 * 指定日のカウンタを集計してダッシュボードシートに3行追記する。
 * @param {Date} date  集計対象日
 */
function writeDashboard_(date) {
  var sheet = getSheet_(SHEET.DASHBOARD);
  if (!sheet) return;

  var dateStr = Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd');

  // プラットフォームごとの行
  var platforms = ['misskey', 'mastodon'];
  for (var p = 0; p < platforms.length; p++) {
    var pl = platforms[p];
    sheet.appendRow([
      dateStr,
      pl,
      _getCount_('POST',        pl, dateStr),
      _getCount_('REPLY',       pl, dateStr),
      _getCount_('FOLLOW_BACK', pl, dateStr),
      _getCount_('UNFOLLOW',    pl, dateStr),
      _getCount_('LEARN',       pl, dateStr),
      _getCount_('ERROR',       pl, dateStr),
      _getCount_('URL_FETCH',   pl, dateStr),
      '',   // ngram_rows: platform 行は空欄
      _countFollows_(pl, 'follower'),
      _countFollows_(pl, 'following')
    ]);
  }

  // system 行
  var ngramRows = 0;
  var ngramSheet = getSheet_(SHEET.NGRAM);
  if (ngramSheet) ngramRows = Math.max(0, ngramSheet.getLastRow() - 1);

  sheet.appendRow([
    dateStr,
    'system',
    '', '', '', '', '',
    _getCount_('ERROR', 'system', dateStr),
    _getCount_('URL_FETCH', 'system', dateStr),
    ngramRows,
    '',  // followers: system 行は空欄
    ''   // following: system 行は空欄
  ]);
}

function _getCount_(type, platform, dateStr) {
  var key = 'COUNT_' + type + '_' + platform + '_' + dateStr;
  return parseInt(getProp_(key, '0'), 10);
}

function _countFollows_(platform, role) {
  var sheet = getSheet_(SHEET.FOLLOWS);
  if (!sheet) return 0;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var rows = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  var count = 0;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() !== platform) continue;
    if (role === 'follower'  && rows[i][3]) count++;
    if (role === 'following' && rows[i][4]) count++;
  }
  return count;
}
