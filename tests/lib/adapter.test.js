'use strict';
const {
  stripHtml,
  normalizeAcct,
  buildAuthHeader,
  parseLinkHeader,
  misskeyNoteToUnified,
  mastodonNoteToUnified,
  mastodonNotificationToUnified,
} = require('../../src/lib/adapter');

// ----------------------------------------------------------------
// stripHtml
// ----------------------------------------------------------------
describe('stripHtml', () => {
  test('タグを除去してプレーンテキストを返す', () => {
    expect(stripHtml('<p>Hello <strong>world</strong></p>')).toBe('Hello world');
  });

  test('<br> を空白に変換する', () => {
    expect(stripHtml('line1<br>line2')).toBe('line1 line2');
  });

  test('<br /> も空白に変換する', () => {
    expect(stripHtml('a<br />b')).toBe('a b');
  });

  test('HTMLエンティティをデコードする', () => {
    expect(stripHtml('a&amp;b &lt;c&gt; &quot;d&quot; &#39;e&#39;')).toBe("a&b <c> \"d\" 'e'");
  });

  test('&nbsp; を空白に変換する', () => {
    expect(stripHtml('foo&nbsp;bar')).toBe('foo bar');
  });

  test('連続空白をまとめる', () => {
    expect(stripHtml('<p>a</p><p>b</p>')).toBe('a b');
  });

  test('空文字列を返す(空入力)', () => {
    expect(stripHtml('')).toBe('');
    expect(stripHtml(null)).toBe('');
    expect(stripHtml(undefined)).toBe('');
  });
});

// ----------------------------------------------------------------
// normalizeAcct
// ----------------------------------------------------------------
describe('normalizeAcct', () => {
  test('外部ユーザー: host あり', () => {
    expect(normalizeAcct('alice', 'example.com', 'myhost.jp')).toBe('@alice@example.com');
  });

  test('自鯖ユーザー: host なし → ownHost を補完', () => {
    expect(normalizeAcct('bob', null, 'myhost.jp')).toBe('@bob@myhost.jp');
  });

  test('host が空文字でも ownHost を使う', () => {
    expect(normalizeAcct('carol', '', 'myhost.jp')).toBe('@carol@myhost.jp');
  });
});

// ----------------------------------------------------------------
// buildAuthHeader
// ----------------------------------------------------------------
describe('buildAuthHeader', () => {
  test('Bearer ヘッダを返す', () => {
    expect(buildAuthHeader('misskey', 'token123')).toEqual({
      Authorization: 'Bearer token123',
    });
  });

  test('Mastodon でも同じ形式', () => {
    expect(buildAuthHeader('mastodon', 'abc')).toEqual({
      Authorization: 'Bearer abc',
    });
  });
});

// ----------------------------------------------------------------
// parseLinkHeader
// ----------------------------------------------------------------
describe('parseLinkHeader', () => {
  test('next と prev の max_id を抽出する', () => {
    const header =
      '<https://mstdn.example/api/v1/timelines/home?max_id=99>; rel="next", ' +
      '<https://mstdn.example/api/v1/timelines/home?since_id=50>; rel="prev"';
    const result = parseLinkHeader(header);
    expect(result.next).toBe('99');
    // prev は since_id= を持たないため URL 全体が返る
    expect(typeof result.prev).toBe('string');
  });

  test('next のみの場合', () => {
    const header = '<https://mstdn.example/api/v1/timelines/home?max_id=123>; rel="next"';
    const result = parseLinkHeader(header);
    expect(result.next).toBe('123');
    expect(result.prev).toBeNull();
  });

  test('null/空を渡すと { next: null, prev: null }', () => {
    expect(parseLinkHeader(null)).toEqual({ next: null, prev: null });
    expect(parseLinkHeader('')).toEqual({ next: null, prev: null });
  });

  test('max_id を含むパラメータを正しく抽出', () => {
    const header =
      '<https://host/api?limit=20&max_id=456&foo=bar>; rel="next"';
    expect(parseLinkHeader(header).next).toBe('456');
  });
});

// ----------------------------------------------------------------
// misskeyNoteToUnified
// ----------------------------------------------------------------
describe('misskeyNoteToUnified', () => {
  const ownUserId = 'user001';
  const ownHost = 'misskey.example';

  const rawNote = {
    id: 'note001',
    text: 'hello misskey',
    visibility: 'home',
    createdAt: '2026-05-28T00:00:00.000Z',
    replyId: null,
    files: [],
    mentions: [],
    url: 'https://misskey.example/notes/note001',
    user: {
      id: 'user001',
      username: 'testuser',
      host: null,
      isBot: false,
    },
  };

  test('UnifiedNote の全フィールドが設定される', () => {
    const unified = misskeyNoteToUnified(rawNote, ownUserId, ownHost);
    expect(unified.id).toBe('note001');
    expect(unified.platform).toBe('misskey');
    expect(unified.text_raw).toBe('hello misskey');
    expect(unified.text_clean).toBe('hello misskey');
    expect(unified.visibility).toBe('home');
    expect(unified.created_at).toBe('2026-05-28T00:00:00.000Z');
    expect(unified.reply_to_id).toBeNull();
    expect(unified.has_attachments).toBe(false);
    expect(unified.mentions).toEqual([]);
  });

  test('自分自身の投稿は is_self=true', () => {
    const unified = misskeyNoteToUnified(rawNote, 'user001', ownHost);
    expect(unified.author.is_self).toBe(true);
  });

  test('他者の投稿は is_self=false', () => {
    const unified = misskeyNoteToUnified(rawNote, 'other', ownHost);
    expect(unified.author.is_self).toBe(false);
  });

  test('自鯖ユーザーの acct は ownHost を補完', () => {
    const unified = misskeyNoteToUnified(rawNote, ownUserId, ownHost);
    expect(unified.author.acct).toBe('@testuser@misskey.example');
  });

  test('外部ユーザーの acct は user.host を使う', () => {
    const externalNote = {
      ...rawNote,
      user: { ...rawNote.user, host: 'remote.example' },
    };
    const unified = misskeyNoteToUnified(externalNote, ownUserId, ownHost);
    expect(unified.author.acct).toBe('@testuser@remote.example');
  });

  test('添付ファイルがある場合 has_attachments=true', () => {
    const withFiles = { ...rawNote, files: [{ id: 'file1' }] };
    expect(misskeyNoteToUnified(withFiles, ownUserId, ownHost).has_attachments).toBe(true);
  });

  test('mentions が ID 文字列の配列になる', () => {
    const withMentions = { ...rawNote, mentions: ['uid1', 'uid2'] };
    const unified = misskeyNoteToUnified(withMentions, ownUserId, ownHost);
    expect(unified.mentions).toEqual(['uid1', 'uid2']);
  });

  test('null を渡すと null を返す', () => {
    expect(misskeyNoteToUnified(null, ownUserId, ownHost)).toBeNull();
  });
});

// ----------------------------------------------------------------
// mastodonNoteToUnified
// ----------------------------------------------------------------
describe('mastodonNoteToUnified', () => {
  const ownUserId = 'acc001';
  const ownHost = 'mstdn.example';

  const rawStatus = {
    id: 'status001',
    content: '<p>hello <strong>mastodon</strong></p>',
    visibility: 'public',
    created_at: '2026-05-28T00:00:00.000Z',
    in_reply_to_id: null,
    media_attachments: [],
    mentions: [],
    url: 'https://mstdn.example/@user/status001',
    account: {
      id: 'acc001',
      username: 'testuser',
      acct: 'testuser',
      bot: false,
    },
  };

  test('HTML が除去された text_clean を返す', () => {
    const unified = mastodonNoteToUnified(rawStatus, ownUserId, ownHost);
    expect(unified.text_clean).toBe('hello mastodon');
    expect(unified.text_raw).toBe('<p>hello <strong>mastodon</strong></p>');
  });

  test('platform は mastodon', () => {
    expect(mastodonNoteToUnified(rawStatus, ownUserId, ownHost).platform).toBe('mastodon');
  });

  test('自鯖ユーザー(acct に @ なし)は ownHost 補完', () => {
    const unified = mastodonNoteToUnified(rawStatus, ownUserId, ownHost);
    expect(unified.author.acct).toBe('@testuser@mstdn.example');
  });

  test('外部ユーザー(acct が user@host 形式)はそのまま', () => {
    const external = {
      ...rawStatus,
      account: { ...rawStatus.account, acct: 'alice@remote.example' },
    };
    const unified = mastodonNoteToUnified(external, ownUserId, ownHost);
    expect(unified.author.acct).toBe('@alice@remote.example');
  });

  test('is_self が正しく設定される', () => {
    expect(mastodonNoteToUnified(rawStatus, 'acc001', ownHost).author.is_self).toBe(true);
    expect(mastodonNoteToUnified(rawStatus, 'other', ownHost).author.is_self).toBe(false);
  });

  test('media_attachments があれば has_attachments=true', () => {
    const withMedia = {
      ...rawStatus,
      media_attachments: [{ id: 'm1', type: 'image' }],
    };
    expect(mastodonNoteToUnified(withMedia, ownUserId, ownHost).has_attachments).toBe(true);
  });

  test('in_reply_to_id が文字列化される', () => {
    const reply = { ...rawStatus, in_reply_to_id: '9999' };
    expect(mastodonNoteToUnified(reply, ownUserId, ownHost).reply_to_id).toBe('9999');
  });

  test('null を渡すと null を返す', () => {
    expect(mastodonNoteToUnified(null, ownUserId, ownHost)).toBeNull();
  });
});

// ----------------------------------------------------------------
// mastodonNotificationToUnified
// ----------------------------------------------------------------
describe('mastodonNotificationToUnified', () => {
  const ownUserId = 'acc001';
  const ownHost = 'mstdn.example';

  test('mention 通知: status を UnifiedNote に変換し _notif_type を付与', () => {
    const rawNotif = {
      id: 'notif001',
      type: 'mention',
      status: {
        id: 'st001',
        content: '<p>hi</p>',
        visibility: 'public',
        created_at: '2026-05-28T00:00:00.000Z',
        in_reply_to_id: null,
        media_attachments: [],
        mentions: [],
        url: null,
        account: {
          id: 'other',
          username: 'other',
          acct: 'other@remote.example',
          bot: false,
        },
      },
    };
    const unified = mastodonNotificationToUnified(rawNotif, ownUserId, ownHost);
    expect(unified).not.toBeNull();
    expect(unified._notif_type).toBe('mention');
    expect(unified._notif_id).toBe('notif001');
    expect(unified.text_clean).toBe('hi');
  });

  test('follow 通知(status なし)は null を返す', () => {
    const followNotif = { id: 'n2', type: 'follow', status: null };
    expect(mastodonNotificationToUnified(followNotif, ownUserId, ownHost)).toBeNull();
  });

  test('null を渡すと null を返す', () => {
    expect(mastodonNotificationToUnified(null, ownUserId, ownHost)).toBeNull();
  });
});
