// GAS API モック — UrlFetchApp は URL パターン別レスポンス対応 (elisa_bot 独自拡張)

global.SpreadsheetApp = {};
global.CacheService = {};
global.PropertiesService = {};
global.LockService = {};
global.Utilities = {};
global.MailApp = {};
global.ContentService = {};
global.Logger = { log: () => {} };
global.Session = {};

global.UrlFetchApp = {
  _requests: [],
  _mockResponses: new Map(),
  setMockResponse: function (urlPattern, response) {
    this._mockResponses.set(urlPattern, response);
  },
  clearMockResponses: function () {
    this._mockResponses.clear();
    this._requests = [];
  },
  fetch: function (url, options) {
    this._requests.push({ url, options });
    for (const [pattern, response] of this._mockResponses) {
      if (url.includes(pattern)) return response;
    }
    return {
      getContentText: () => '{}',
      getResponseCode: () => 200
    };
  }
};
