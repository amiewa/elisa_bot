// ===================================================================
// Setup.gs — 初期設定・スプレッドシート構築・バリデーション・メニュー
// ===================================================================

// ===================================================================
// メニュー
// ===================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('elisa_bot')
    .addItem('初期設定(シート作成)', 'setupSpreadsheet')
    .addItem('設定値の検証', 'validateConfig')
    .addItem('API トークンの設定', 'manageApiTokens')
    .addSeparator()
    .addItem(
      'プラットフォーム切替後のクリーンアップ',
      'cleanupAfterPlatformSwitch'
    )
    .addSeparator()
    .addItem('[手動] 設定シート内容を確認', 'testShowConfig')
    .addSeparator()
    .addItem('[危険] 全データ初期化(ファクトリーリセット)', 'factoryReset')
    .addSeparator()
    .addItem('[デバッグ] 最後のWebhookイベント確認', 'showLastWebhookEvent')
    .addToUi();
}

// ===================================================================
// setupSpreadsheet — 13シートを冪等に作成・装飾
// ===================================================================

function setupSpreadsheet() {
  var ui = SpreadsheetApp.getUi();

  try {
    // 1. シートを作成(存在すれば流用)
    var sheetDefs = getSheetDefinitions_();
    for (var i = 0; i < sheetDefs.length; i++) {
      ensureSheet_(sheetDefs[i]);
    }

    // 2. 設定シートにデフォルト値を投入(既存値は上書きしない)
    initConfigSheet_();

    // 3. 装飾
    decorateDashboard_();
    decorateErrorLog_();

    ui.alert('初期設定が完了しました。');
  } catch (e) {
    logError('setupSpreadsheet', e.message);
    ui.alert('エラーが発生しました: ' + e.message);
  }
}

// ===================================================================
// シート定義
// ===================================================================

function getSheetDefinitions_() {
  return [
    { name: SHEET.CONFIG, headers: ['key', 'value', 'description'] },
    {
      name: SHEET.BLACKLIST,
      headers: ['type', 'identifier', 'reason', 'added_at']
    },
    { name: SHEET.NG_WORDS, headers: ['word'] },
    {
      name: SHEET.EMOJIS,
      headers: ['name', 'category', 'aliases', 'url', 'last_updated']
    },
    { name: SHEET.NG_EMOJIS, headers: ['name'] },
    {
      name: SHEET.NGRAM,
      headers: ['prev_token', 'next_token', 'count', 'last_used_at']
    },
    {
      name: SHEET.RAW_LEARN,
      headers: [
        'note_id',
        'platform',
        'author_acct',
        'content',
        'learned_at',
        'tokens_extracted'
      ]
    },
    {
      name: SHEET.PROCESSED_MISSKEY,
      headers: ['note_id', 'processed_at', 'source']
    },
    {
      name: SHEET.PROCESSED_MASTODON,
      headers: ['note_id', 'processed_at', 'source']
    },
    {
      name: SHEET.POST_HISTORY,
      headers: ['hash', 'posted_at', 'platform', 'original_text']
    },
    {
      name: SHEET.FOLLOWS,
      headers: [
        'platform',
        'user_id',
        'acct',
        'is_follower',
        'i_am_following',
        'missing_count',
        'followed_back_at',
        'updated_at'
      ]
    },
    {
      name: SHEET.DASHBOARD,
      headers: [
        'date',
        'platform',
        'post',
        'reply',
        'follow_back',
        'unfollow',
        'learn',
        'error',
        'url_fetch',
        'ngram_rows',
        'followers',
        'following'
      ]
    },
    {
      name: SHEET.ERROR_LOG,
      headers: ['timestamp', 'platform', 'function_name', 'error_message']
    }
  ];
}

/**
 * シートを冪等に作成し、ヘッダーが空なら書き込む。
 */
function ensureSheet_(def) {
  var sheet = SS.getSheetByName(def.name);
  if (!sheet) {
    sheet = SS.insertSheet(def.name);
  }
  // ヘッダー行が空なら書き込む
  var firstRow = sheet.getRange(1, 1, 1, def.headers.length).getValues()[0];
  var hasHeader = firstRow.some(function (v) {
    return String(v).trim() !== '';
  });
  if (!hasHeader) {
    sheet.getRange(1, 1, 1, def.headers.length).setValues([def.headers]);
    sheet
      .getRange(1, 1, 1, def.headers.length)
      .setFontWeight('bold')
      .setBackground('#e0e0e0');
    sheet.setFrozenRows(1);
  }
}

// ===================================================================
// 設定シート初期値
// ===================================================================

var CONFIG_DEFAULTS_ = [
  // key, default, description
  ['BOT_ACTIVE', 'FALSE', 'TRUE=全体有効化 / FALSE=停止'],
  [
    'BOT_PLATFORM',
    'misskey',
    'misskey / mastodon 運用途中で変更の場合はelisa_botメニューから切り替えクリーンアップ'
  ],
  [
    'MISSKEY_INSTANCE',
    '',
    'URL 例:`https://misskey.example.com` (末尾スラッシュ不要)'
  ],
  ['MISSKEY_WEBHOOK_ENABLED', 'TRUE', 'Webhook経由のメンション返信'],
  [
    'MASTODON_INSTANCE',
    '',
    'URL 例：`https://mastodon.example.com`(末尾スラッシュ不要)'
  ],
  ['MASTODON_POLLING_INTERVAL_MIN', '60', '通知ポーリング間隔(分): 5/15/60'],
  ['POST_VISIBILITY', 'home', 'public / home / followers'],
  ['POST_NIGHT_START', '23', '夜間開始時刻(0-23)'],
  ['POST_NIGHT_END', '6', '夜間終了時刻(0-23)'],
  ['POST_INTERVAL_MIN_MINUTES', '30', '自動投稿の最短間隔(分)'],
  ['POST_CHANCE', '40', '自動投稿の発火確率(%)'],
  ['POST_DUPLICATE_SIMILARITY', '0.8', '類似投稿判定のジャッカードしきい値'],
  ['POST_DUPLICATE_RECENT_COUNT', '100', '類似判定対象の直近投稿数'],
  ['POST_SENTENCES_MIN', '3', '1投稿あたりの最小文数'],
  ['POST_SENTENCES_MAX', '5', '1投稿あたりの最大文数'],
  ['MARKOV_MIN_LENGTH', '8', '1文あたりの最短文字数'],
  ['MARKOV_MAX_LENGTH', '140', '投稿全体の最大文字数'],
  ['MARKOV_MAX_RETRY', '5', '生成リトライ上限'],
  ['MARKOV_EMOJI_RATE', '20', '各文末に絵文字を注入する確率(%)'],
  ['NGRAM_ORDER', '2', 'N-gram 次数(現状2固定)'],
  ['NGRAM_MAX_ROWS', '50000', 'N-gram シートの最大行数'],
  ['NGRAM_PRUNE_THRESHOLD', '45000', 'これを超えたら剪定起動'],
  ['NGRAM_PRUNE_DECAY', '0.05', 'score = log(count) - 経過日数 * decay'],
  ['LEARN_TL_TYPE', 'local', 'local / home / hybrid / global'],
  ['LEARN_NOTES_PER_TRIGGER', '20', '1トリガーで処理する最大投稿数'],
  ['LEARN_FROM_MENTIONS', 'FALSE', 'メンションを学習対象にするか'],
  ['LEARN_EXCLUDE_BOTS', 'TRUE', 'bot投稿を学習対象から除外'],
  ['LEARN_RAW_RETENTION_DAYS', '7', '生学習データ保持日数(0=保持しない)'],
  [
    'MORPH_URLFETCH_FALLBACK_THRESHOLD',
    '15000',
    'UrlFetch総数がこの値を超えたら簡易解析へ'
  ],
  ['MENTION_ENABLED', 'TRUE', 'メンション返信を有効にするか'],
  ['MENTION_MUTUAL_ONLY', 'TRUE', '相互フォローのみ返信'],
  ['MENTION_MAX_PER_USER_PER_DAY', '10', '1ユーザーあたりの日次返信上限'],
  ['MENTION_GLOBAL_MAX_PER_HOUR', '20', '全ユーザー合算の時間あたり返信上限'],
  ['MENTION_FALLBACK_TEXT', '生成失敗しちゃった', '生成失敗時の固定返信'],
  ['MENTION_EXCLUDE_BOTS', 'TRUE', 'botからのメンションを無視するか'],
  ['FOLLOW_AUTO_FOLLOW_BACK', 'TRUE', 'フォローバックを自動で行うか'],
  [
    'FOLLOW_AUTO_UNFOLLOW_BACK',
    'FALSE',
    'フォロー解除されたら自動アンフォロー'
  ],
  ['FOLLOW_UNFOLLOW_GRACE_CYCLES', '2', 'アンフォロー判定の猶予サイクル数'],
  ['FOLLOW_KEYWORD_ENABLED', 'TRUE', 'キーワードフォローバックを有効にするか'],
  [
    'FOLLOW_KEYWORDS',
    'フォローして,followして,相互フォロー',
    'フォローバックキーワード(カンマ区切り)'
  ],
  ['EMOJI_REFRESH_INTERVAL_DAYS', '7', '自鯖カスタム絵文字の更新間隔(日)'],
  ['EMOJI_MAX_COUNT', '500', '保持する自鯖絵文字の最大件数'],
  [
    'NG_WORDS_EXTERNAL_URL',
    'https://raw.githubusercontent.com/sayonari/goodBadWordlist/main/ja/BadList.txt',
    'NGワード外部リスト URL'
  ],
  ['MAINTENANCE_ENABLED', 'TRUE', '日次メンテナンスを有効にするか'],
  ['MAINTENANCE_CLEANUP_DAYS', '30', 'この日数より古いデータを削除'],
  ['PROCESSED_ID_RETENTION_DAYS', '14', '処理済み投稿IDの保持期間(日)'],
  ['ERROR_NOTIFY_ENABLED', 'FALSE', 'エラー発生時にメール通知するか'],
  ['ERROR_NOTIFY_EMAIL', '', '通知先メールアドレス']
];

/**
 * 設定シートにデフォルト値を書き込む。既存の値は上書きしない(冪等)。
 */
function initConfigSheet_() {
  var sheet = getSheet_(SHEET.CONFIG);
  if (!sheet) return;

  var existing = sheet.getDataRange().getValues();
  var existingKeys = {};
  for (var i = 1; i < existing.length; i++) {
    existingKeys[String(existing[i][0]).trim()] = true;
  }

  var toAdd = [];
  for (var j = 0; j < CONFIG_DEFAULTS_.length; j++) {
    if (!existingKeys[CONFIG_DEFAULTS_[j][0]]) {
      toAdd.push(CONFIG_DEFAULTS_[j]);
    }
  }

  if (toAdd.length > 0) {
    var lastRow = sheet.getLastRow();
    sheet.getRange(lastRow + 1, 1, toAdd.length, 3).setValues(toAdd);
  }
}

// ===================================================================
// ダッシュボードシート装飾
// ===================================================================

function decorateDashboard_() {
  var sheet = getSheet_(SHEET.DASHBOARD);
  if (!sheet) return;

  var lastCol = 12; // 12列固定
  var headerRange = sheet.getRange(1, 1, 1, lastCol);

  // ヘッダー
  headerRange.setFontWeight('bold').setBackground('#e0e0e0');
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);

  // 数値列フォーマット(3〜12列)
  sheet.getRange(2, 3, sheet.getMaxRows() - 1, 10).setNumberFormat('#,##0');
  // date列フォーマット
  sheet.getRange(2, 1, sheet.getMaxRows() - 1, 1).setNumberFormat('yyyy-mm-dd');
  // 列幅自動調整
  for (var col = 1; col <= lastCol; col++) {
    sheet.autoResizeColumn(col);
  }

  // 条件付き書式(ルールごとに newConditionalFormatRule() を呼ぶ)
  var maxRow = sheet.getMaxRows() - 1;
  var rules = [
    // error > 0 → 赤系
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(0)
      .setBackground('#f8d7da')
      .setRanges([sheet.getRange(2, 8, maxRow, 1)])
      .build(),
    // url_fetch > 15000 → 黄系
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(15000)
      .setBackground('#fff3cd')
      .setRanges([sheet.getRange(2, 9, maxRow, 1)])
      .build(),
    // ngram_rows > 45000 → 黄系
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(45000)
      .setBackground('#fff3cd')
      .setRanges([sheet.getRange(2, 10, maxRow, 1)])
      .build(),
    // followers > 300 → 黄系
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(300)
      .setBackground('#fff3cd')
      .setRanges([sheet.getRange(2, 11, maxRow, 1)])
      .build()
  ];

  sheet.setConditionalFormatRules(rules);
}

// ===================================================================
// エラーログシート装飾 (mi_mia 同等: ヘッダー bold + setFrozenRows のみ)
// ===================================================================

function decorateErrorLog_() {
  var sheet = getSheet_(SHEET.ERROR_LOG);
  if (!sheet) return;
  sheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#e0e0e0');
  sheet.setFrozenRows(1);
}

// ===================================================================
// 設定検証
// ===================================================================

function validateConfig() {
  var ui = SpreadsheetApp.getUi();
  try {
    var sheet = getSheet_(SHEET.CONFIG);
    if (!sheet) {
      ui.alert(
        '設定シートが見つかりません。先に「初期設定」を実行してください。'
      );
      return;
    }
    var data = sheet.getDataRange().getValues();
    var configMap = {};
    for (var i = 1; i < data.length; i++) {
      var key = String(data[i][0]).trim();
      var val = String(data[i][1]).trim();
      if (key) configMap[key] = val;
    }

    // src/lib/validate.js の validateConfigValues を呼ぶ
    var errors = validateConfigValues(configMap);
    if (errors.length === 0) {
      ui.alert('設定値の検証: OK\n問題は見つかりませんでした。');
    } else {
      ui.alert('設定値の検証: NG\n\n' + errors.join('\n'));
    }
  } catch (e) {
    logError('validateConfig', e.message);
    ui.alert('エラーが発生しました: ' + e.message);
  }
}

// ===================================================================
// API トークン管理
// ===================================================================

function manageApiTokens() {
  var ui = SpreadsheetApp.getUi();
  var platform = getConfig('BOT_PLATFORM', 'misskey');

  // Misskey トークン
  if (platform === 'misskey') {
    var mkRes = ui.prompt(
      'Misskey API トークン',
      'MISSKEY_TOKEN を入力してください:',
      ui.ButtonSet.OK_CANCEL
    );
    if (mkRes.getSelectedButton() === ui.Button.OK) {
      var mkToken = mkRes.getResponseText().trim();
      if (mkToken) {
        PropertiesService.getScriptProperties().setProperty(
          'MISSKEY_TOKEN',
          mkToken
        );
        ui.alert('MISSKEY_TOKEN を保存しました。');
      }
    }
  }

  // Mastodon トークン
  if (platform === 'mastodon') {
    var mdRes = ui.prompt(
      'Mastodon API トークン',
      'MASTODON_TOKEN を入力してください:',
      ui.ButtonSet.OK_CANCEL
    );
    if (mdRes.getSelectedButton() === ui.Button.OK) {
      var mdToken = mdRes.getResponseText().trim();
      if (mdToken) {
        PropertiesService.getScriptProperties().setProperty(
          'MASTODON_TOKEN',
          mdToken
        );
        ui.alert('MASTODON_TOKEN を保存しました。');
      }
    }
  }

  // Yahoo Client ID
  var yhRes = ui.prompt(
    'Yahoo! Client ID',
    'YAHOO_CLIENT_ID を入力してください:',
    ui.ButtonSet.OK_CANCEL
  );
  if (yhRes.getSelectedButton() === ui.Button.OK) {
    var yhId = yhRes.getResponseText().trim();
    if (yhId) {
      PropertiesService.getScriptProperties().setProperty(
        'YAHOO_CLIENT_ID',
        yhId
      );
      ui.alert('YAHOO_CLIENT_ID を保存しました。');
    }
  }
}

// ===================================================================
// プラットフォーム切替後クリーンアップ
// ===================================================================

function cleanupAfterPlatformSwitch() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.alert(
    'プラットフォーム切替後のクリーンアップ',
    '以下のキャッシュを削除します:\n- OWN_USER_ID\n- LAST_EMOJI_REFRESH_AT\n- LAST_BOT_PLATFORM\n\nダッシュボードタブの警告色も解除します。続行しますか？',
    ui.ButtonSet.OK_CANCEL
  );
  if (res !== ui.Button.OK) return;

  deleteProp_('OWN_USER_ID');
  deleteProp_('LAST_EMOJI_REFRESH_AT');
  deleteProp_('LAST_BOT_PLATFORM');
  clearConfigCache_();

  // ダッシュボードタブカラー解除
  var dashSheet = getSheet_(SHEET.DASHBOARD);
  if (dashSheet) dashSheet.setTabColor(null);

  ui.alert('クリーンアップが完了しました。');
}

// ===================================================================
// ファクトリーリセット
// ===================================================================

/**
 * 全シートのデータ・設定・APIトークン類を含むスクリプトプロパティをすべて削除し、
 * 設定シートをデフォルト値で再構成する。操作は二段確認で保護される。
 */
function factoryReset() {
  var ui = SpreadsheetApp.getUi();

  // 第1確認: 内容説明と OK/CANCEL
  var first = ui.alert(
    '[危険] 全データ初期化(ファクトリーリセット)',
    '以下をすべて削除・初期化します:\n' +
      '・全シートのデータ行(ヘッダは保持)\n' +
      '・全設定値(デフォルトに戻す)\n' +
      '・APIトークン / Webhookシークレット\n' +
      '・キャッシュ・内部カウンタ\n\n' +
      'この操作は元に戻せません。続行しますか？',
    ui.ButtonSet.OK_CANCEL
  );
  if (first !== ui.Button.OK) return;

  // 第2確認: "初期化" とタイプさせて誤操作を防止
  var second = ui.prompt(
    '最終確認',
    '本当に実行するには「初期化」と入力してください:',
    ui.ButtonSet.OK_CANCEL
  );
  if (second.getSelectedButton() !== ui.Button.OK) return;
  if (second.getResponseText().trim() !== '初期化') {
    ui.alert('入力が一致しないため、初期化を中止しました。');
    return;
  }

  try {
    // 1. スクリプトプロパティ全削除(トークン・秘密鍵・カウンタ含む)
    PropertiesService.getScriptProperties().deleteAllProperties();

    // 2. 全シートのデータ行クリア(ヘッダ保持)
    var sheetDefs = getSheetDefinitions_();
    for (var i = 0; i < sheetDefs.length; i++) {
      ensureSheet_(sheetDefs[i]);
      var sheet = getSheet_(sheetDefs[i].name);
      if (!sheet) continue;
      var lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
      }
    }

    // 3. 設定をデフォルト値で再投入(クリア後なので全行が入る)
    initConfigSheet_();

    // 4. シート装飾を再適用
    decorateDashboard_();
    decorateErrorLog_();
    var dashSheet = getSheet_(SHEET.DASHBOARD);
    if (dashSheet) dashSheet.setTabColor(null);

    // 5. キャッシュ全消去
    clearConfigCache_();

    ui.alert(
      '初期化完了',
      '全データを初期化しました。\n\n' +
        'APIトークン類も削除されています。メニューの「API トークンの設定」から\n' +
        'MISSKEY_TOKEN / MASTODON_TOKEN / YAHOO_CLIENT_ID を再登録してください。\n\n' +
        'Misskey の Webhook を利用している場合は、Webhook シークレットも再生成して\n' +
        'Misskey 側の設定を更新してください。',
      ui.ButtonSet.OK
    );
  } catch (e) {
    logError('factoryReset', e.message, 'system');
    ui.alert('エラーが発生しました: ' + e.message);
  }
}

// ===================================================================
// 手動テスト関数
// ===================================================================

function showLastWebhookEvent() {
  var ui = SpreadsheetApp.getUi();
  var entry =
    PropertiesService.getScriptProperties().getProperty('DEBUG_DOPOST_ENTRY') ||
    '(なし)';
  var event =
    PropertiesService.getScriptProperties().getProperty('DEBUG_LAST_EVENT') ||
    '(なし)';
  ui.alert(
    '[デバッグ] Webhookイベント診断',
    'doPost到達:\n' + entry + '\n\n---\nパース結果:\n' + event,
    ui.ButtonSet.OK
  );
}

function testShowConfig() {
  var ui = SpreadsheetApp.getUi();
  var platform = getConfig('BOT_PLATFORM', '(未設定)');
  var active = getConfig('BOT_ACTIVE', '(未設定)');
  var instance = getConfig(
    platform === 'mastodon' ? 'MASTODON_INSTANCE' : 'MISSKEY_INSTANCE',
    '(未設定)'
  );
  ui.alert(
    '現在の設定確認',
    'BOT_ACTIVE: ' +
      active +
      '\nBOT_PLATFORM: ' +
      platform +
      '\nインスタンス: ' +
      instance,
    ui.ButtonSet.OK
  );
}
