// ===================================================================
// lib/adapter.js — UnifiedNote 変換・パース・ヘッダ構築(純粋関数)
// ===================================================================

/**
 * Mastodon HTML 本文からタグを除去してプレーンテキストへ変換。
 * <br>/<p> は改行相当で空白に置換し、連続空白をまとめる。
 * @param {string} html
 * @returns {string}
 */
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @username や @username@host を @username@host 形式に正規化。
 * 自鯖ユーザー(ホストなし)は ownHost を補完する。
 * @param {string} username
 * @param {string|null} host
 * @param {string} ownHost
 * @returns {string}
 */
function normalizeAcct(username, host, ownHost) {
  const h = host || ownHost;
  return `@${username}@${h}`;
}

/**
 * Bearer 認証ヘッダを構築する。
 * @param {string} _platform - 'misskey' | 'mastodon' (将来の拡張用、現状未使用)
 * @param {string} token
 * @returns {{ Authorization: string }}
 */
function buildAuthHeader(_platform, token) {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Mastodon の Link レスポンスヘッダをパースして next/prev の max_id を返す。
 * ヘッダ名は大文字小文字どちらでも対応。
 * 形式例: <https://host/api/v1/timelines/home?max_id=123>; rel="next", <...>; rel="prev"
 * @param {string|null} linkHeader
 * @returns {{ next: string|null, prev: string|null }}
 */
function parseLinkHeader(linkHeader) {
  const result = { next: null, prev: null };
  if (!linkHeader) return result;

  const parts = linkHeader.split(',');
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="(\w+)"/);
    if (!match) continue;
    const url = match[1];
    const rel = match[2];
    if (rel === 'next' || rel === 'prev') {
      const maxIdMatch = url.match(/[?&]max_id=([^&]+)/);
      result[rel] = maxIdMatch ? maxIdMatch[1] : url;
    }
  }
  return result;
}

/**
 * Misskey の Note オブジェクトを UnifiedNote に変換する純粋関数。
 * @param {Object} rawNote - Misskey API レスポンスの note オブジェクト
 * @param {string} ownUserId
 * @param {string} ownHost
 * @returns {Object} UnifiedNote
 */
function misskeyNoteToUnified(rawNote, ownUserId, ownHost) {
  if (!rawNote) return null;
  const user = rawNote.user || {};
  const acct = normalizeAcct(
    user.username || '',
    user.host || null,
    ownHost || ''
  );
  const text = rawNote.text || '';
  const mentionIds = (rawNote.mentions || []).map((m) => String(m));

  return {
    id: String(rawNote.id || ''),
    platform: 'misskey',
    url: rawNote.url || null,
    author: {
      id: String(user.id || ''),
      acct,
      is_bot: Boolean(user.isBot),
      is_self: String(user.id || '') === String(ownUserId || ''),
    },
    text_raw: text,
    text_clean: text,
    visibility: rawNote.visibility || 'public',
    created_at: rawNote.createdAt || null,
    reply_to_id: rawNote.replyId ? String(rawNote.replyId) : null,
    mentions: mentionIds,
    has_attachments: Array.isArray(rawNote.files) && rawNote.files.length > 0,
  };
}

/**
 * Mastodon の Status オブジェクトを UnifiedNote に変換する純粋関数。
 * @param {Object} rawStatus - Mastodon API レスポンスの status オブジェクト
 * @param {string} ownUserId
 * @param {string} ownHost  - 自鯖ドメイン(acct 正規化用)
 * @returns {Object} UnifiedNote
 */
function mastodonNoteToUnified(rawStatus, ownUserId, ownHost) {
  if (!rawStatus) return null;
  const account = rawStatus.account || {};

  // acct が既に user@host 形式の場合はそのまま使い、単独 username の場合は補完
  const acctRaw = account.acct || account.username || '';
  const acct = acctRaw.includes('@')
    ? `@${acctRaw}`
    : normalizeAcct(acctRaw, null, ownHost || '');

  const textRaw = rawStatus.content || '';
  const textClean = stripHtml(textRaw);
  const mentionIds = (rawStatus.mentions || []).map((m) => String(m.id || m));

  return {
    id: String(rawStatus.id || ''),
    platform: 'mastodon',
    url: rawStatus.url || null,
    author: {
      id: String(account.id || ''),
      acct,
      is_bot: Boolean(account.bot),
      is_self: String(account.id || '') === String(ownUserId || ''),
    },
    text_raw: textRaw,
    text_clean: textClean,
    visibility: rawStatus.visibility || 'public',
    created_at: rawStatus.created_at || null,
    reply_to_id: rawStatus.in_reply_to_id ? String(rawStatus.in_reply_to_id) : null,
    mentions: mentionIds,
    has_attachments:
      Array.isArray(rawStatus.media_attachments) &&
      rawStatus.media_attachments.length > 0,
  };
}

/**
 * Mastodon の Notification オブジェクトを UnifiedNote に変換する純粋関数。
 * mention/follow/follow_request/reblog/favourite 各タイプに対応。
 * @param {Object} rawNotif
 * @param {string} ownUserId
 * @param {string} ownHost
 * @returns {Object|null} UnifiedNote(status がなければ null)
 */
function mastodonNotificationToUnified(rawNotif, ownUserId, ownHost) {
  if (!rawNotif) return null;
  const status = rawNotif.status;
  // follow など status を持たない通知は null を返す
  if (!status) return null;
  const unified = mastodonNoteToUnified(status, ownUserId, ownHost);
  if (!unified) return null;
  unified._notif_type = rawNotif.type;
  unified._notif_id = String(rawNotif.id || '');
  return unified;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    stripHtml,
    normalizeAcct,
    buildAuthHeader,
    parseLinkHeader,
    misskeyNoteToUnified,
    mastodonNoteToUnified,
    mastodonNotificationToUnified,
  };
}
