'use strict';
require('../mocks/gas');

// --- Core ヘルパーのスタブ ---
global.incrementCounter = jest.fn();
global.logError = jest.fn();
global.getConfig = jest.fn((key, def) => {
  const cfg = {
    BOT_PLATFORM: 'mastodon',
    MASTODON_INSTANCE: 'https://mstdn.example',
    LEARN_TL_TYPE: 'home',
  };
  return key in cfg ? cfg[key] : (def !== undefined ? def : '');
});
global.getProp_ = jest.fn((key, def) => {
  if (key === 'MASTODON_TOKEN') return 'test-token';
  if (key === 'OWN_USER_ID') return 'acc001';
  if (key === 'LAST_BOT_PLATFORM') return 'mastodon';
  if (key === 'MASTODON_LAST_NOTIF_ID') return null;
  return def !== undefined ? def : null;
});
global.setProp_ = jest.fn();

// --- lib/adapter.js の純粋関数を注入 ---
const adapterLib = require('../../src/lib/adapter');
global.misskeyNoteToUnified = adapterLib.misskeyNoteToUnified;
global.mastodonNoteToUnified = adapterLib.mastodonNoteToUnified;
global.mastodonNotificationToUnified = adapterLib.mastodonNotificationToUnified;
global.buildAuthHeader = adapterLib.buildAuthHeader;
global.parseLinkHeader = adapterLib.parseLinkHeader;

const { createMastodonAdapter_, callMastodonApi } =
  require('../../src/Adapter.gs');

// モックステータス生成ヘルパー
function makeStatus(id, content = '<p>hello</p>') {
  return {
    id,
    content,
    visibility: 'public',
    created_at: '2026-05-28T00:00:00.000Z',
    in_reply_to_id: null,
    media_attachments: [],
    mentions: [],
    url: null,
    account: {
      id: 'other',
      username: 'user',
      acct: 'user@remote.example',
      bot: false,
    },
  };
}

function makeResponse(body, code = 200, linkHeader = null) {
  return {
    getContentText: () => JSON.stringify(body),
    getResponseCode: () => code,
    getAllHeaders: () => linkHeader ? { Link: linkHeader } : {},
  };
}

beforeEach(() => {
  UrlFetchApp.clearMockResponses();
  jest.clearAllMocks();
  global.getProp_ = jest.fn((key, def) => {
    if (key === 'MASTODON_TOKEN') return 'test-token';
    if (key === 'OWN_USER_ID') return 'acc001';
    if (key === 'LAST_BOT_PLATFORM') return 'mastodon';
    if (key === 'MASTODON_LAST_NOTIF_ID') return null;
    return def !== undefined ? def : null;
  });
});

// ----------------------------------------------------------------
// callMastodonApi — I/O コア
// ----------------------------------------------------------------
describe('callMastodonApi', () => {
  test('GET: JSON とリンクヘッダを返す', () => {
    const linkVal = '<https://mstdn.example/api/v1/timelines/home?max_id=50>; rel="next"';
    UrlFetchApp.setMockResponse(
      '/api/v1/timelines/home',
      makeResponse([makeStatus('s1')], 200, linkVal)
    );
    const res = callMastodonApi('https://mstdn.example', 'tok', '/api/v1/timelines/home', 'GET');
    expect(Array.isArray(res.data)).toBe(true);
    expect(res.linkHeader).toBe(linkVal);
  });

  test('POST: ボディを送信する', () => {
    UrlFetchApp.setMockResponse('/api/v1/statuses', makeResponse({ id: 's1' }));
    const res = callMastodonApi('https://mstdn.example', 'tok', '/api/v1/statuses', 'POST', { status: 'hi' });
    expect(res.data.id).toBe('s1');
    const req = UrlFetchApp._requests[0];
    const payload = JSON.parse(req.options.payload);
    expect(payload.status).toBe('hi');
  });

  test('401 エラー: category=auth', () => {
    UrlFetchApp.setMockResponse('/api/v1/timelines/home', makeResponse({}, 401));
    expect.assertions(3);
    try {
      callMastodonApi('https://mstdn.example', 'bad', '/api/v1/timelines/home', 'GET');
    } catch (e) {
      expect(e.status).toBe(401);
      expect(e.category).toBe('auth');
      expect(e.retriable).toBe(false);
    }
  });

  test('429 エラー: retriable=true', () => {
    UrlFetchApp.setMockResponse('/api/v1/statuses', makeResponse({}, 429));
    try {
      callMastodonApi('https://mstdn.example', 'tok', '/api/v1/statuses', 'POST', {});
    } catch (e) {
      expect(e.status).toBe(429);
      expect(e.retriable).toBe(true);
    }
  });

  test('500 エラー: category=server', () => {
    UrlFetchApp.setMockResponse('/api/v1/statuses', makeResponse({}, 500));
    try {
      callMastodonApi('https://mstdn.example', 'tok', '/api/v1/statuses', 'POST', {});
    } catch (e) {
      expect(e.category).toBe('server');
    }
  });

  test('incrementCounter が mastodon で呼ばれる', () => {
    UrlFetchApp.setMockResponse('/api/v1/accounts/verify_credentials', makeResponse({ id: 'a1' }));
    callMastodonApi('https://mstdn.example', 'tok', '/api/v1/accounts/verify_credentials', 'GET');
    expect(incrementCounter).toHaveBeenCalledWith('URL_FETCH', 'mastodon');
  });

  test('Authorization ヘッダが設定される', () => {
    UrlFetchApp.setMockResponse('/api/v1/timelines/home', makeResponse([]));
    callMastodonApi('https://mstdn.example', 'mytoken', '/api/v1/timelines/home', 'GET');
    expect(UrlFetchApp._requests[0].options.headers.Authorization).toBe('Bearer mytoken');
  });
});

// ----------------------------------------------------------------
// Mastodon アダプタ — postNote
// ----------------------------------------------------------------
describe('mastodonAdapter.postNote', () => {
  test('投稿 API を呼んで結果を返す', () => {
    UrlFetchApp.setMockResponse('/api/v1/statuses', makeResponse({ id: 's1' }));
    const adapter = createMastodonAdapter_();
    const result = adapter.postNote('テスト投稿');
    expect(result.id).toBe('s1');
  });
});

// ----------------------------------------------------------------
// Mastodon アダプタ — getTimeline / Link ヘッダ追従
// ----------------------------------------------------------------
describe('mastodonAdapter.getTimeline', () => {
  test('TL を取得して UnifiedNote 配列を返す', () => {
    UrlFetchApp.setMockResponse('/api/v1/timelines/home', makeResponse([makeStatus('s1'), makeStatus('s2')]));
    const adapter = createMastodonAdapter_();
    const result = adapter.getTimeline({ max_pages: 1 });
    expect(result).toHaveLength(2);
    expect(result[0].platform).toBe('mastodon');
  });

  test('Link ヘッダを追従して次ページを取得する', () => {
    const link1 = '<https://mstdn.example/api/v1/timelines/home?max_id=10>; rel="next"';
    let callCount = 0;
    UrlFetchApp.fetch = jest.fn((_url) => {
      callCount++;
      if (callCount === 1) {
        return makeResponse([makeStatus('s1')], 200, link1);
      }
      // 2ページ目: リンクヘッダなし
      return makeResponse([makeStatus('s2')], 200, null);
    });

    const adapter = createMastodonAdapter_();
    const result = adapter.getTimeline({ max_pages: 2 });
    expect(result).toHaveLength(2);
    expect(callCount).toBe(2);
    // 2ページ目のリクエストに max_id が含まれることを確認
    const call2Url = UrlFetchApp.fetch.mock.calls[1][0];
    expect(call2Url).toContain('max_id=10');

    // モックを元に戻す
    UrlFetchApp.fetch = function (url, options) {
      this._requests.push({ url, options });
      for (const [pattern, response] of this._mockResponses) {
        if (url.includes(pattern)) return response;
      }
      return { getContentText: () => '{}', getResponseCode: () => 200, getAllHeaders: () => ({}) };
    };
  });

  test('max_items で件数制限', () => {
    UrlFetchApp.setMockResponse(
      '/api/v1/timelines/home',
      makeResponse([makeStatus('a'), makeStatus('b'), makeStatus('c')])
    );
    const adapter = createMastodonAdapter_();
    const result = adapter.getTimeline({ max_pages: 1, max_items: 2 });
    expect(result).toHaveLength(2);
  });

  test('LEARN_TL_TYPE=local → /api/v1/timelines/public?local=true を呼ぶ', () => {
    global.getConfig = jest.fn((key, def) => {
      if (key === 'MASTODON_INSTANCE') return 'https://mstdn.example';
      if (key === 'LEARN_TL_TYPE') return 'local';
      return def !== undefined ? def : '';
    });
    UrlFetchApp.setMockResponse('/api/v1/timelines/public', makeResponse([makeStatus('l1')]));
    const adapter = createMastodonAdapter_();
    const result = adapter.getTimeline({ max_pages: 1 });
    expect(result).toHaveLength(1);
    const req = UrlFetchApp._requests.find(r => r.url.includes('/api/v1/timelines/public'));
    expect(req).toBeDefined();
    expect(req.url).toContain('local=true');
  });

  test('LEARN_TL_TYPE=global → /api/v1/timelines/public (local クエリなし)', () => {
    global.getConfig = jest.fn((key, def) => {
      if (key === 'MASTODON_INSTANCE') return 'https://mstdn.example';
      if (key === 'LEARN_TL_TYPE') return 'global';
      return def !== undefined ? def : '';
    });
    UrlFetchApp.setMockResponse('/api/v1/timelines/public', makeResponse([makeStatus('g1')]));
    const adapter = createMastodonAdapter_();
    const result = adapter.getTimeline({ max_pages: 1 });
    expect(result).toHaveLength(1);
    const req = UrlFetchApp._requests.find(r => r.url.includes('/api/v1/timelines/public'));
    expect(req).toBeDefined();
    expect(req.url).not.toContain('local=true');
  });

  test('LEARN_TL_TYPE=hybrid → /api/v1/timelines/public (global と同じ扱い)', () => {
    global.getConfig = jest.fn((key, def) => {
      if (key === 'MASTODON_INSTANCE') return 'https://mstdn.example';
      if (key === 'LEARN_TL_TYPE') return 'hybrid';
      return def !== undefined ? def : '';
    });
    UrlFetchApp.setMockResponse('/api/v1/timelines/public', makeResponse([makeStatus('hy1')]));
    const adapter = createMastodonAdapter_();
    const result = adapter.getTimeline({ max_pages: 1 });
    expect(result).toHaveLength(1);
    const req = UrlFetchApp._requests.find(r => r.url.includes('/api/v1/timelines/public'));
    expect(req).toBeDefined();
  });
});

// ----------------------------------------------------------------
// Mastodon アダプタ — follow / unfollow
// ----------------------------------------------------------------
describe('mastodonAdapter.follow / unfollow', () => {
  test('follow API を呼ぶ', () => {
    UrlFetchApp.setMockResponse('/api/v1/accounts/uid999/follow', makeResponse({}));
    const adapter = createMastodonAdapter_();
    adapter.follow('uid999');
    const req = UrlFetchApp._requests.find(r => r.url.includes('/api/v1/accounts/uid999/follow'));
    expect(req).toBeDefined();
  });

  test('unfollow API を呼ぶ', () => {
    UrlFetchApp.setMockResponse('/api/v1/accounts/uid999/unfollow', makeResponse({}));
    const adapter = createMastodonAdapter_();
    adapter.unfollow('uid999');
    const req = UrlFetchApp._requests.find(r => r.url.includes('/api/v1/accounts/uid999/unfollow'));
    expect(req).toBeDefined();
  });
});

// ----------------------------------------------------------------
// Mastodon アダプタ — getMentions (ポーリング)
// ----------------------------------------------------------------
describe('mastodonAdapter.getMentions', () => {
  test('mention 通知を取得する', () => {
    const notifs = [
      {
        id: 'notif1',
        type: 'mention',
        status: makeStatus('s1'),
      },
    ];
    UrlFetchApp.setMockResponse('/api/v1/notifications', makeResponse(notifs));
    const adapter = createMastodonAdapter_();
    const result = adapter.getMentions({ max_pages: 1 });
    expect(result).toHaveLength(1);
    // 最新の通知 ID(status ID でなく notification ID)が保存される
    expect(setProp_).toHaveBeenCalledWith('MASTODON_LAST_NOTIF_ID', 'notif1');
  });
});

// ----------------------------------------------------------------
// Mastodon アダプタ — parseNotification
// ----------------------------------------------------------------
describe('mastodonAdapter.parseNotification', () => {
  test('mention 通知を UnifiedNote に変換する', () => {
    const rawNotif = {
      id: 'n1',
      type: 'mention',
      status: makeStatus('s1', '<p>hello</p>'),
    };
    const adapter = createMastodonAdapter_();
    const result = adapter.parseNotification(rawNotif);
    expect(result).not.toBeNull();
    expect(result._notif_type).toBe('mention');
    expect(result.text_clean).toBe('hello');
  });

  test('follow 通知(status なし)は null', () => {
    const adapter = createMastodonAdapter_();
    expect(adapter.parseNotification({ id: 'n2', type: 'follow', status: null })).toBeNull();
  });
});
