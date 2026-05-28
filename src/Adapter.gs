// ===================================================================
// Adapter.gs — Misskey/Mastodon API アダプタ(I/O ラッパー)
// ===================================================================
//
// 設計方針(v11 §7):
//   - createAdapter() ファクトリが BOT_PLATFORM 設定に応じて実装を返す
//   - 純粋変換関数は src/lib/adapter.js に分離
//   - エラー応答: throw 方式(Error に status/category/retriable/platform_code を付与)
//   - ページネーション: P3 方式(max_pages + max_items 両指定可)
//   - OWN_USER_ID は起動時に getMe() で解決し PropertiesService にキャッシュ

// ===================================================================
// エラーファクトリ
// ===================================================================

/**
 * カテゴリ情報付きの Error を生成する。
 * @param {string} message
 * @param {number} status      - HTTP ステータスコード
 * @param {string} platform    - 'misskey' | 'mastodon'
 * @returns {Error}
 */
function makeApiError_(message, status, platform) {
  var err = new Error(message);
  err.status = status;
  err.platform = platform;

  if (status === 401 || status === 403) {
    err.category = 'auth';
    err.retriable = false;
  } else if (status === 429) {
    err.category = 'rate_limit';
    err.retriable = true;
  } else if (status >= 500) {
    err.category = 'server';
    err.retriable = true;
  } else {
    err.category = 'client';
    err.retriable = false;
  }
  err.platform_code = status;
  return err;
}

// ===================================================================
// Misskey I/O コア
// ===================================================================

/**
 * Misskey API を呼び出す。POST + i トークン認証。
 * @param {string} instance - 例: 'https://misskey.example'
 * @param {string} token    - Misskey ユーザートークン
 * @param {string} endpoint - 例: '/api/notes/create'
 * @param {Object} params   - リクエストボディ
 * @returns {Object} パース済み JSON
 */
function callMisskeyApi(instance, token, endpoint, params) {
  var url = instance.replace(/\/$/, '') + endpoint;
  var body = Object.assign({}, params, { i: token });
  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  };

  incrementCounter('URL_FETCH', 'misskey');
  var res = UrlFetchApp.fetch(url, options);
  var code = res.getResponseCode();
  var text = res.getContentText();

  if (code >= 400) {
    var msg = 'Misskey API エラー ' + code + ': ' + endpoint;
    logError('callMisskeyApi', msg + ' / ' + text.slice(0, 200), 'misskey');
    throw makeApiError_(msg, code, 'misskey');
  }

  try {
    return JSON.parse(text);
  } catch (_) {
    return {};
  }
}

// ===================================================================
// Mastodon I/O コア
// ===================================================================

/**
 * Mastodon API を呼び出す。Bearer 認証。
 * @param {string} instance    - 例: 'https://mstdn.example'
 * @param {string} token       - Mastodon アクセストークン
 * @param {string} endpoint    - 例: '/api/v1/statuses'
 * @param {string} method      - 'GET' | 'POST' | 'DELETE'
 * @param {Object} [body]      - POST/DELETE ボディ
 * @param {Object} [query]     - GET クエリパラメータ
 * @returns {{ data: Object, linkHeader: string|null }}
 */
function callMastodonApi(instance, token, endpoint, method, body, query) {
  var base = instance.replace(/\/$/, '') + endpoint;
  var url = base;

  if (query && Object.keys(query).length > 0) {
    var qs = Object.keys(query)
      .filter(function (k) { return query[k] !== undefined && query[k] !== null; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]); })
      .join('&');
    if (qs) url = base + '?' + qs;
  }

  var headers = buildAuthHeader('mastodon', token);
  var options = {
    method: method,
    headers: headers,
    muteHttpExceptions: true,
  };

  if (body && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }

  incrementCounter('URL_FETCH', 'mastodon');
  var res = UrlFetchApp.fetch(url, options);
  var code = res.getResponseCode();
  var text = res.getContentText();

  // Link ヘッダ取得(大文字小文字どちらでも対応)
  var linkHeader = null;
  try {
    var allHeaders = res.getAllHeaders();
    linkHeader = allHeaders['Link'] || allHeaders['link'] || null;
  } catch (_) {}

  if (code >= 400) {
    var msg = 'Mastodon API エラー ' + code + ': ' + endpoint;
    logError('callMastodonApi', msg + ' / ' + text.slice(0, 200), 'mastodon');
    throw makeApiError_(msg, code, 'mastodon');
  }

  var data = {};
  try { data = JSON.parse(text); } catch (_) {}

  return { data: data, linkHeader: linkHeader };
}

// ===================================================================
// アダプタファクトリ
// ===================================================================

/**
 * BOT_PLATFORM 設定値に基づいて Misskey または Mastodon アダプタを返す。
 * @returns {Object} 15 操作を持つアダプタオブジェクト
 */
function createAdapter() {
  var platform = getConfig('BOT_PLATFORM', 'misskey');
  if (platform === 'mastodon') {
    return createMastodonAdapter_();
  }
  return createMisskeyAdapter_();
}

// ===================================================================
// Misskey アダプタ実装
// ===================================================================

function createMisskeyAdapter_() {
  var instance = getConfig('MISSKEY_INSTANCE');
  var token = getProp_('MISSKEY_TOKEN', '');
  var ownHost = instance.replace(/^https?:\/\//, '').replace(/\/$/, '');

  // OWN_USER_ID の解決(キャッシュ優先)
  var ownUserId = getProp_('OWN_USER_ID', '');
  var lastPlatform = getProp_('LAST_BOT_PLATFORM', '');
  if (!ownUserId || lastPlatform !== 'misskey') {
    try {
      var meRaw = callMisskeyApi(instance, token, '/api/i', {});
      ownUserId = String(meRaw.id || '');
      setProp_('OWN_USER_ID', ownUserId);
      setProp_('LAST_BOT_PLATFORM', 'misskey');
    } catch (e) {
      logError('createMisskeyAdapter_', 'OWN_USER_ID の解決に失敗: ' + e.message, 'misskey');
    }
  }

  function api(endpoint, params) {
    return callMisskeyApi(instance, token, endpoint, params || {});
  }

  function toUnified(raw) {
    return misskeyNoteToUnified(raw, ownUserId, ownHost);
  }

  // --- ページネーション取得 ---
  function fetchPaginated(endpoint, baseParams, maxPages, maxItems) {
    var results = [];
    var params = Object.assign({}, baseParams, { limit: 100 });
    var pages = 0;
    var untilId = null;

    while (true) {
      if (untilId) params.untilId = untilId;
      var data = api(endpoint, params);
      if (!Array.isArray(data) || data.length === 0) break;

      for (var i = 0; i < data.length; i++) {
        results.push(toUnified(data[i]));
        if (maxItems && results.length >= maxItems) return results;
      }

      pages++;
      if (maxPages && pages >= maxPages) break;
      untilId = data[data.length - 1].id;
    }
    return results;
  }

  return {
    platform: 'misskey',

    postNote: function (text, options) {
      var params = Object.assign({ text: text }, options || {});
      return api('/api/notes/create', params);
    },

    deleteNote: function (noteId) {
      return api('/api/notes/delete', { noteId: noteId });
    },

    getMyNotes: function (opts) {
      var o = opts || {};
      return fetchPaginated('/api/users/notes', { userId: ownUserId }, o.max_pages || 1, o.max_items);
    },

    getTimeline: function (opts) {
      var o = opts || {};
      var tlType = getConfig('LEARN_TL_TYPE', 'local');
      var epMap = {
        home:   '/api/notes/timeline',
        local:  '/api/notes/local-timeline',
        hybrid: '/api/notes/hybrid-timeline',
        global: '/api/notes/global-timeline'
      };
      var ep = epMap[tlType] || '/api/notes/local-timeline';
      return fetchPaginated(ep, {}, o.max_pages || 1, o.max_items);
    },

    // Misskey はメンション一覧 API が非公式のため webhook に依存。
    // フォールバック用の最小実装として空配列を返す。
    getMentions: function () {
      return [];
    },

    getRepliesTo: function (noteId) {
      var data = api('/api/notes/replies', { noteId: noteId, limit: 100 });
      return Array.isArray(data) ? data.map(toUnified) : [];
    },

    follow: function (userId) {
      return api('/api/following/create', { userId: userId });
    },

    unfollow: function (userId) {
      return api('/api/following/delete', { userId: userId });
    },

    getFollowers: function (opts) {
      var o = opts || {};
      return fetchPaginated('/api/users/followers', { userId: ownUserId }, o.max_pages || 10, o.max_items);
    },

    getFollowing: function (opts) {
      var o = opts || {};
      return fetchPaginated('/api/users/following', { userId: ownUserId }, o.max_pages || 10, o.max_items);
    },

    getRelation: function (userId) {
      var data = api('/api/users/relation', { userId: userId });
      var raw = Array.isArray(data) ? data[0] : data;
      if (!raw) return null;
      // Misskey は isFollowing/isFollowed を返す。呼び出し側と統一するため following に正規化する
      return {
        following: Boolean(raw.isFollowing !== undefined ? raw.isFollowing : raw.following),
        followed_by: Boolean(raw.isFollowed !== undefined ? raw.isFollowed : raw.followed_by),
        requested: Boolean(raw.hasPendingFollowRequestFromYou),
      };
    },

    getMe: function () {
      return api('/api/i', {});
    },

    getCustomEmojis: function () {
      var data = api('/api/emojis', {});
      return Array.isArray(data.emojis) ? data.emojis : [];
    },

    verifyWebhookSignature: function (secret, sigHeader, rawBody) {
      if (!secret) return true;
      var digest = Utilities.computeHmacSha256Signature(rawBody, secret);
      var hex = digest.map(function (b) {
        return ('0' + (b & 0xff).toString(16)).slice(-2);
      }).join('');
      return hex === sigHeader;
    },

    parseNotification: function (event) {
      if (!event || !event.body) return null;
      var body = event.body;
      var type = body.type;
      var note = body.note || body.body;

      if (!note) {
        // 'followed' イベント: body.user にフォロワー情報が入る
        if (type === 'followed' && body.user) {
          var u = body.user;
          return {
            _notif_type: type,
            id: String(body.id || ''),
            platform: 'misskey',
            author: {
              id: String(u.id || body.userId || ''),
              acct: u.username || '',
              is_bot: Boolean(u.isBot),
              is_self: false,
            },
          };
        }
        return null;
      }

      var unified = toUnified(note);
      if (unified) unified._notif_type = type;
      return unified;
    },
  };
}

// ===================================================================
// Mastodon アダプタ実装
// ===================================================================

function createMastodonAdapter_() {
  var instance = getConfig('MASTODON_INSTANCE');
  var token = getProp_('MASTODON_TOKEN', '');
  var ownHost = instance.replace(/^https?:\/\//, '').replace(/\/$/, '');

  // OWN_USER_ID の解決(キャッシュ優先)
  var ownUserId = getProp_('OWN_USER_ID', '');
  var lastPlatform = getProp_('LAST_BOT_PLATFORM', '');
  if (!ownUserId || lastPlatform !== 'mastodon') {
    try {
      var meRes = callMastodonApi(instance, token, '/api/v1/accounts/verify_credentials', 'GET');
      ownUserId = String(meRes.data.id || '');
      setProp_('OWN_USER_ID', ownUserId);
      setProp_('LAST_BOT_PLATFORM', 'mastodon');
    } catch (e) {
      logError('createMastodonAdapter_', 'OWN_USER_ID の解決に失敗: ' + e.message, 'mastodon');
    }
  }

  function api(endpoint, method, body, query) {
    return callMastodonApi(instance, token, endpoint, method || 'GET', body, query);
  }

  function toUnified(raw) {
    return mastodonNoteToUnified(raw, ownUserId, ownHost);
  }

  // --- ページネーション取得(Link ヘッダ追従) ---
  function fetchPaginated(endpoint, baseQuery, maxPages, maxItems) {
    var results = [];
    var query = Object.assign({ limit: 40 }, baseQuery);
    var pages = 0;

    while (true) {
      var res = api(endpoint, 'GET', null, query);
      var items = Array.isArray(res.data) ? res.data : [];
      if (items.length === 0) break;

      for (var i = 0; i < items.length; i++) {
        results.push(toUnified(items[i]));
        if (maxItems && results.length >= maxItems) return results;
      }

      pages++;
      if (maxPages && pages >= maxPages) break;

      // Link ヘッダから次ページの max_id を取得
      var link = parseLinkHeader(res.linkHeader);
      if (!link.next) break;
      query = Object.assign({}, query, { max_id: link.next });
    }
    return results;
  }

  return {
    platform: 'mastodon',

    postNote: function (text, options) {
      var o = options || {};
      var body = Object.assign({ status: text }, o);
      return api('/api/v1/statuses', 'POST', body).data;
    },

    deleteNote: function (statusId) {
      return api('/api/v1/statuses/' + statusId, 'DELETE').data;
    },

    getMyNotes: function (opts) {
      var o = opts || {};
      return fetchPaginated('/api/v1/accounts/' + ownUserId + '/statuses', {}, o.max_pages || 1, o.max_items);
    },

    getTimeline: function (opts) {
      var o = opts || {};
      var tlType = getConfig('LEARN_TL_TYPE', 'local');
      var ep, baseQuery;
      if (tlType === 'local') {
        ep = '/api/v1/timelines/public';
        baseQuery = { local: true };
      } else if (tlType === 'global' || tlType === 'hybrid') {
        ep = '/api/v1/timelines/public';
        baseQuery = {};
      } else {
        // home (既定)
        ep = '/api/v1/timelines/home';
        baseQuery = {};
      }
      return fetchPaginated(ep, baseQuery, o.max_pages || 1, o.max_items);
    },

    getMentions: function (opts) {
      var o = opts || {};
      var sinceId = getProp_('MASTODON_LAST_NOTIF_ID', null);
      var baseQuery = { types: ['mention'], limit: 40 };
      if (sinceId) baseQuery.since_id = sinceId;

      // notifications は status と構造が異なるため独自ループで変換
      var results = [];
      var pages = 0;
      var maxPages = o.max_pages || 3;
      var curQuery = Object.assign({}, baseQuery);

      while (true) {
        var res = api('/api/v1/notifications', 'GET', null, curQuery);
        var items = Array.isArray(res.data) ? res.data : [];
        if (items.length === 0) break;

        for (var i = 0; i < items.length; i++) {
          var unified = mastodonNotificationToUnified(items[i], ownUserId, ownHost);
          if (unified) {
            results.push(unified);
            if (o.max_items && results.length >= o.max_items) {
              if (results[0]._notif_id) setProp_('MASTODON_LAST_NOTIF_ID', results[0]._notif_id);
              return results;
            }
          }
        }

        pages++;
        if (pages >= maxPages) break;
        var link = parseLinkHeader(res.linkHeader);
        if (!link.next) break;
        curQuery = Object.assign({}, curQuery, { max_id: link.next });
      }

      // 最新の通知 ID を保存(次回ポーリング用、通知 ID = Mastodon の since_id 基準)
      if (results.length > 0 && results[0]._notif_id) {
        setProp_('MASTODON_LAST_NOTIF_ID', results[0]._notif_id);
      }
      return results;
    },

    getRepliesTo: function (statusId) {
      var res = api('/api/v1/statuses/' + statusId + '/context', 'GET');
      var descendants = (res.data && res.data.descendants) ? res.data.descendants : [];
      return descendants.map(toUnified);
    },

    follow: function (accountId) {
      return api('/api/v1/accounts/' + accountId + '/follow', 'POST').data;
    },

    unfollow: function (accountId) {
      return api('/api/v1/accounts/' + accountId + '/unfollow', 'POST').data;
    },

    getFollowers: function (opts) {
      var o = opts || {};
      return fetchPaginated('/api/v1/accounts/' + ownUserId + '/followers', {}, o.max_pages || 10, o.max_items);
    },

    getFollowing: function (opts) {
      var o = opts || {};
      return fetchPaginated('/api/v1/accounts/' + ownUserId + '/following', {}, o.max_pages || 10, o.max_items);
    },

    getRelation: function (accountId) {
      var res = api('/api/v1/accounts/relationships', 'GET', null, { id: [accountId] });
      return Array.isArray(res.data) ? res.data[0] : res.data;
    },

    getMe: function () {
      return api('/api/v1/accounts/verify_credentials', 'GET').data;
    },

    getCustomEmojis: function () {
      var res = api('/api/v1/custom_emojis', 'GET');
      return Array.isArray(res.data) ? res.data : [];
    },

    // Mastodon は doPost webhook を使わないため常に true を返す
    verifyWebhookSignature: function () {
      return true;
    },

    parseNotification: function (rawNotif) {
      return mastodonNotificationToUnified(rawNotif, ownUserId, ownHost);
    },
  };
}

// ===================================================================
// Node.js テスト向け条件付き export (A-2 方式)
// ===================================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createAdapter: createAdapter,
    callMisskeyApi: callMisskeyApi,
    callMastodonApi: callMastodonApi,
    makeApiError_: makeApiError_,
    createMisskeyAdapter_: createMisskeyAdapter_,
    createMastodonAdapter_: createMastodonAdapter_,
  };
}
