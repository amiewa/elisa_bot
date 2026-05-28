'use strict';
require('../mocks/gas');

// --- Core ヘルパーのスタブ ---
global.incrementCounter = jest.fn();
global.logError = jest.fn();
global.getConfig = jest.fn((key, def) => {
  const cfg = {
    BOT_PLATFORM: 'misskey',
    MISSKEY_INSTANCE: 'https://misskey.example',
    LEARN_TL_TYPE: 'local',
  };
  return key in cfg ? cfg[key] : (def !== undefined ? def : '');
});
global.getProp_ = jest.fn((key, def) => {
  if (key === 'MISSKEY_TOKEN') return 'test-token';
  if (key === 'OWN_USER_ID') return 'uid001';
  if (key === 'LAST_BOT_PLATFORM') return 'misskey';
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

const { createMisskeyAdapter_, callMisskeyApi, makeApiError_ } =
  require('../../src/Adapter.gs');

// モックノート生成ヘルパー
function makeNote(id, text = 'hello') {
  return {
    id,
    text,
    visibility: 'public',
    createdAt: '2026-05-28T00:00:00.000Z',
    replyId: null,
    files: [],
    mentions: [],
    url: null,
    user: {
      id: 'other',
      username: 'user',
      host: null,
      isBot: false,
    },
  };
}

function makeResponse(body, code = 200) {
  return {
    getContentText: () => JSON.stringify(body),
    getResponseCode: () => code,
    getAllHeaders: () => ({}),
  };
}

beforeEach(() => {
  UrlFetchApp.clearMockResponses();
  jest.clearAllMocks();
  global.getProp_ = jest.fn((key, def) => {
    if (key === 'MISSKEY_TOKEN') return 'test-token';
    if (key === 'OWN_USER_ID') return 'uid001';
    if (key === 'LAST_BOT_PLATFORM') return 'misskey';
    return def !== undefined ? def : null;
  });
});

// ----------------------------------------------------------------
// callMisskeyApi — I/O コア
// ----------------------------------------------------------------
describe('callMisskeyApi', () => {
  test('成功: JSON をパースして返す', () => {
    UrlFetchApp.setMockResponse('/api/notes/create', makeResponse({ createdNote: { id: 'n1' } }));
    const result = callMisskeyApi('https://misskey.example', 'tok', '/api/notes/create', { text: 'hi' });
    expect(result.createdNote.id).toBe('n1');
    expect(UrlFetchApp._requests[0].url).toBe('https://misskey.example/api/notes/create');
  });

  test('401 エラー: category=auth, retriable=false で throw', () => {
    UrlFetchApp.setMockResponse('/api/notes', makeResponse({ error: 'unauthorized' }, 401));
    expect(() => callMisskeyApi('https://misskey.example', 'bad', '/api/notes', {}))
      .toThrow();
    try {
      callMisskeyApi('https://misskey.example', 'bad', '/api/notes', {});
    } catch (e) {
      expect(e.status).toBe(401);
      expect(e.category).toBe('auth');
      expect(e.retriable).toBe(false);
    }
  });

  test('429 エラー: category=rate_limit, retriable=true', () => {
    UrlFetchApp.setMockResponse('/api/notes', makeResponse({}, 429));
    try {
      callMisskeyApi('https://misskey.example', 'tok', '/api/notes', {});
    } catch (e) {
      expect(e.status).toBe(429);
      expect(e.category).toBe('rate_limit');
      expect(e.retriable).toBe(true);
    }
  });

  test('500 エラー: category=server, retriable=true', () => {
    UrlFetchApp.setMockResponse('/api/notes', makeResponse({}, 500));
    try {
      callMisskeyApi('https://misskey.example', 'tok', '/api/notes', {});
    } catch (e) {
      expect(e.status).toBe(500);
      expect(e.category).toBe('server');
      expect(e.retriable).toBe(true);
    }
  });

  test('incrementCounter が呼ばれる', () => {
    UrlFetchApp.setMockResponse('/api/i', makeResponse({ id: 'u1' }));
    callMisskeyApi('https://misskey.example', 'tok', '/api/i', {});
    expect(incrementCounter).toHaveBeenCalledWith('URL_FETCH', 'misskey');
  });
});

// ----------------------------------------------------------------
// Misskey アダプタ — postNote
// ----------------------------------------------------------------
describe('misskeyAdapter.postNote', () => {
  test('成功: 投稿 API を呼び出す', () => {
    UrlFetchApp.setMockResponse('/api/notes/create', makeResponse({ createdNote: { id: 'n1' } }));
    const adapter = createMisskeyAdapter_();
    const result = adapter.postNote('テスト投稿');
    expect(result.createdNote.id).toBe('n1');
    const req = UrlFetchApp._requests.find(r => r.url.includes('/api/notes/create'));
    expect(req).toBeDefined();
  });
});

// ----------------------------------------------------------------
// Misskey アダプタ — getTimeline
// ----------------------------------------------------------------
describe('misskeyAdapter.getTimeline', () => {
  test('local TL を取得して UnifiedNote 配列を返す', () => {
    const notes = [makeNote('n1'), makeNote('n2')];
    UrlFetchApp.setMockResponse('/api/notes/local-timeline', makeResponse(notes));
    const adapter = createMisskeyAdapter_();
    const result = adapter.getTimeline({ max_pages: 1 });
    expect(result).toHaveLength(2);
    expect(result[0].platform).toBe('misskey');
    expect(result[0].id).toBe('n1');
  });

  test('空配列が返ったらループを抜ける', () => {
    UrlFetchApp.setMockResponse('/api/notes/local-timeline', makeResponse([]));
    const adapter = createMisskeyAdapter_();
    expect(adapter.getTimeline()).toEqual([]);
  });

  test('max_items で件数が制限される', () => {
    const notes = [makeNote('a'), makeNote('b'), makeNote('c')];
    UrlFetchApp.setMockResponse('/api/notes/local-timeline', makeResponse(notes));
    const adapter = createMisskeyAdapter_();
    const result = adapter.getTimeline({ max_pages: 1, max_items: 2 });
    expect(result).toHaveLength(2);
  });

  test('LEARN_TL_TYPE=home → /api/notes/timeline を呼ぶ', () => {
    global.getConfig = jest.fn((key, def) => {
      if (key === 'MISSKEY_INSTANCE') return 'https://misskey.example';
      if (key === 'LEARN_TL_TYPE') return 'home';
      return def !== undefined ? def : '';
    });
    UrlFetchApp.setMockResponse('/api/notes/timeline', makeResponse([makeNote('h1')]));
    const adapter = createMisskeyAdapter_();
    const result = adapter.getTimeline({ max_pages: 1 });
    expect(result).toHaveLength(1);
    const req = UrlFetchApp._requests.find(r => r.url.includes('/api/notes/timeline'));
    expect(req).toBeDefined();
    expect(req.url).not.toContain('local-timeline');
  });

  test('LEARN_TL_TYPE=hybrid → /api/notes/hybrid-timeline を呼ぶ', () => {
    global.getConfig = jest.fn((key, def) => {
      if (key === 'MISSKEY_INSTANCE') return 'https://misskey.example';
      if (key === 'LEARN_TL_TYPE') return 'hybrid';
      return def !== undefined ? def : '';
    });
    UrlFetchApp.setMockResponse('/api/notes/hybrid-timeline', makeResponse([makeNote('hy1')]));
    const adapter = createMisskeyAdapter_();
    const result = adapter.getTimeline({ max_pages: 1 });
    expect(result).toHaveLength(1);
    const req = UrlFetchApp._requests.find(r => r.url.includes('/api/notes/hybrid-timeline'));
    expect(req).toBeDefined();
  });

  test('LEARN_TL_TYPE=global → /api/notes/global-timeline を呼ぶ', () => {
    global.getConfig = jest.fn((key, def) => {
      if (key === 'MISSKEY_INSTANCE') return 'https://misskey.example';
      if (key === 'LEARN_TL_TYPE') return 'global';
      return def !== undefined ? def : '';
    });
    UrlFetchApp.setMockResponse('/api/notes/global-timeline', makeResponse([makeNote('g1'), makeNote('g2')]));
    const adapter = createMisskeyAdapter_();
    const result = adapter.getTimeline({ max_pages: 1 });
    expect(result).toHaveLength(2);
    const req = UrlFetchApp._requests.find(r => r.url.includes('/api/notes/global-timeline'));
    expect(req).toBeDefined();
  });

  test('未知の LEARN_TL_TYPE → /api/notes/local-timeline にフォールバック', () => {
    global.getConfig = jest.fn((key, def) => {
      if (key === 'MISSKEY_INSTANCE') return 'https://misskey.example';
      if (key === 'LEARN_TL_TYPE') return 'unknown';
      return def !== undefined ? def : '';
    });
    UrlFetchApp.setMockResponse('/api/notes/local-timeline', makeResponse([makeNote('fb1')]));
    const adapter = createMisskeyAdapter_();
    const result = adapter.getTimeline({ max_pages: 1 });
    expect(result).toHaveLength(1);
    const req = UrlFetchApp._requests.find(r => r.url.includes('/api/notes/local-timeline'));
    expect(req).toBeDefined();
  });
});

// ----------------------------------------------------------------
// Misskey アダプタ — follow / unfollow
// ----------------------------------------------------------------
describe('misskeyAdapter.follow / unfollow', () => {
  test('follow: フォロー API を呼ぶ', () => {
    UrlFetchApp.setMockResponse('/api/following/create', makeResponse({}));
    const adapter = createMisskeyAdapter_();
    adapter.follow('uid999');
    const req = UrlFetchApp._requests.find(r => r.url.includes('/api/following/create'));
    expect(req).toBeDefined();
  });

  test('unfollow: フォロー解除 API を呼ぶ', () => {
    UrlFetchApp.setMockResponse('/api/following/delete', makeResponse({}));
    const adapter = createMisskeyAdapter_();
    adapter.unfollow('uid999');
    const req = UrlFetchApp._requests.find(r => r.url.includes('/api/following/delete'));
    expect(req).toBeDefined();
  });
});

// ----------------------------------------------------------------
// Misskey アダプタ — ページネーション
// ----------------------------------------------------------------
describe('misskeyAdapter pagination', () => {
  test('max_pages=2 で2ページ取得する', () => {
    // ページ1: 2件
    // ページ2: 1件
    // ページ3: 空 → ループ終了(ただし max_pages=2 で先に止まる)
    const page1 = [makeNote('a'), makeNote('b')];
    const page2 = [makeNote('c')];

    // リクエスト順にレスポンスを返す
    let callCount = 0;
    UrlFetchApp.fetch = jest.fn((_url, _opts) => {
      callCount++;
      const body = callCount === 1 ? page1 : callCount === 2 ? page2 : [];
      return {
        getContentText: () => JSON.stringify(body),
        getResponseCode: () => 200,
        getAllHeaders: () => ({}),
      };
    });

    const adapter = createMisskeyAdapter_();
    const result = adapter.getTimeline({ max_pages: 2 });
    expect(result).toHaveLength(3);
    expect(callCount).toBe(2);

    // UrlFetchApp.fetch を元に戻す
    UrlFetchApp.fetch = function (url, options) {
      this._requests.push({ url, options });
      for (const [pattern, response] of this._mockResponses) {
        if (url.includes(pattern)) return response;
      }
      return { getContentText: () => '{}', getResponseCode: () => 200 };
    };
  });
});

// ----------------------------------------------------------------
// makeApiError_
// ----------------------------------------------------------------
describe('makeApiError_', () => {
  test('403 は auth カテゴリ', () => {
    const e = makeApiError_('forbidden', 403, 'misskey');
    expect(e.category).toBe('auth');
    expect(e.retriable).toBe(false);
  });

  test('404 は client カテゴリ', () => {
    const e = makeApiError_('not found', 404, 'misskey');
    expect(e.category).toBe('client');
    expect(e.retriable).toBe(false);
  });

  test('502 は server カテゴリ、retriable=true', () => {
    const e = makeApiError_('bad gateway', 502, 'mastodon');
    expect(e.category).toBe('server');
    expect(e.retriable).toBe(true);
  });
});
