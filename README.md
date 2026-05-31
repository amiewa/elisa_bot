# elisa_bot

Misskey / Mastodon 両対応のマルコフ連鎖 bot。
Google Apps Script (GAS) + Google Spreadsheet で動作し、完全ゼロコスト。

## 必要なもの

| サービス | 用途 |
|---|---|
| Google アカウント | GAS・スプレッドシートの実行環境 |
| Misskey または Mastodon アカウント | 投稿先 |
| [Yahoo! デベロッパーネットワーク](https://developer.yahoo.co.jp/) | 日本語形態素解析 API (Client ID) |

## セットアップ

### 1. リポジトリのクローン

```sh
git clone https://github.com/amiewa/elisa_bot.git
cd elisa_bot
npm install
```

### 2. clasp の認証・プロジェクト作成

```sh
npx clasp login
npx clasp create --type sheets --title "elisa_bot"
```

作成後、`.clasp.json` の `scriptId` が自動入力される。
あわせて作成されたスプレッドシートの URL を控えておく。

### 3. コードを GAS にプッシュ

```sh
npm run push
```

### 4. スプレッドシートでの初期設定

1. 作成したスプレッドシートを開く
2. メニュー **elisa_bot > 初期設定(シート作成)** を実行 — 12 シートが作成され、設定シートにデフォルト値が入力される
3. **設定** シートを開き、各キーに値を入力する（[設定キー一覧](#設定キー一覧) 参照）
4. メニュー **elisa_bot > API トークンの設定** を実行し、各トークンを保存する
   - Yahoo! 形態素解析 API の Client ID は [Yahoo! デベロッパーネットワーク](https://developer.yahoo.co.jp/) でアプリを登録して取得する。取得した「アプリケーション ID」を入力する。HTTP 401 が発生する場合は、この Client ID が無効または誤って入力されている可能性が高い。
5. メニュー **elisa_bot > 設定値の検証** を実行し、エラーがないことを確認する

### 5. トリガーの設定

GAS エディタ(拡張機能 > Apps Script)で以下のトリガーを追加する。

| 関数 | 種別 | 間隔 |
|---|---|---|
| `onHourlyTrigger` | 時間ドリブン | 1時間ごと |

### 6. Misskey Webhook の設定（Misskey 使用時のみ）

1. **API トークンの設定** でシークレットを生成・確認する（アラートに表示される）
2. GAS エディタで **デプロイ > 新しいデプロイ** を作成し、Web アプリとして公開する（アクセス権: 全員）
3. Misskey の設定 > **Webhook** に以下を登録する

| 項目 | 値 |
|---|---|
| URL | `https://script.google.com/macros/s/<デプロイ ID>/exec` |
| シークレット | `manageApiTokens` で表示されたシークレット |
| イベント | `mention` / `followed` にチェック |

---

## 設定キー一覧

設定は **設定** シートの `key` / `value` 列で管理する。

### BOT 全体

| キー | デフォルト | 説明 |
|---|---|---|
| `BOT_ACTIVE` | `FALSE` | `TRUE` にするとトリガー処理が有効になる |
| `BOT_PLATFORM` | `misskey` | `misskey` または `mastodon` |

### Misskey

| キー | デフォルト | 説明 |
|---|---|---|
| `MISSKEY_INSTANCE` | (空) | インスタンス URL（末尾スラッシュなし）例: `https://misskey.io` |
| `MISSKEY_WEBHOOK_ENABLED` | `TRUE` | Webhook 経由のメンション返信を有効にする |

### Mastodon

| キー | デフォルト | 説明 |
|---|---|---|
| `MASTODON_INSTANCE` | (空) | インスタンス URL 例: `https://mastodon.social` |
| `MASTODON_POLLING_INTERVAL_MIN` | `60` | 通知ポーリング間隔（`5` / `15` / `60` 分） |

### 投稿

| キー | デフォルト | 説明 |
|---|---|---|
| `POST_VISIBILITY` | `home` | 公開範囲: `public` / `home` / `followers` |
| `POST_NIGHT_START` | `23` | 夜間開始時刻（0-23）。夜間は自動投稿しない |
| `POST_NIGHT_END` | `6` | 夜間終了時刻（0-23） |
| `POST_INTERVAL_MIN_MINUTES` | `30` | 自動投稿の最短間隔（分） |
| `POST_CHANCE` | `40` | 1トリガーあたりの投稿発火確率（%） |
| `POST_DUPLICATE_SIMILARITY` | `0.8` | 類似投稿とみなすジャッカード係数（0.0〜1.0） |
| `POST_DUPLICATE_RECENT_COUNT` | `100` | 類似判定に使う直近投稿数 |
| `POST_SENTENCES_MIN` | `3` | 1投稿の最小文数 |
| `POST_SENTENCES_MAX` | `5` | 1投稿の最大文数 |

### マルコフ連鎖

| キー | デフォルト | 説明 |
|---|---|---|
| `MARKOV_MIN_LENGTH` | `8` | 1文の最短文字数 |
| `MARKOV_MAX_LENGTH` | `140` | 投稿全体の最大文字数 |
| `MARKOV_MAX_RETRY` | `5` | 生成リトライ上限 |
| `MARKOV_EMOJI_RATE` | `20` | 文末にカスタム絵文字を注入する確率（%） |

### N-gram

| キー | デフォルト | 説明 |
|---|---|---|
| `NGRAM_ORDER` | `2` | N-gram 次数（現状 2 固定） |
| `NGRAM_MAX_ROWS` | `50000` | N-gram シートの最大行数 |
| `NGRAM_PRUNE_THRESHOLD` | `45000` | この行数を超えたら剪定を実行 |
| `NGRAM_PRUNE_DECAY` | `0.05` | 剪定スコアの時間減衰係数 |

### 学習

| キー | デフォルト | 説明 |
|---|---|---|
| `LEARN_TL_TYPE` | `local` | 学習するタイムライン: `local` / `home` / `hybrid` / `global`（Mastodon では `hybrid` は `global` と同じ扱い） |
| `LEARN_NOTES_PER_TRIGGER` | `20` | 1トリガーで処理する最大投稿数 |
| `LEARN_FROM_MENTIONS` | `FALSE` | メンションを学習対象にするか |
| `LEARN_EXCLUDE_BOTS` | `TRUE` | bot 投稿を学習から除外するか |
| `LEARN_RAW_RETENTION_DAYS` | `7` | 生学習データの保持日数（0 = 保持しない） |

**常時除外（設定不要）**: フォロワー限定投稿（`followers`/`private`）とDM（`specified`/`direct`）はプライバシー保護のため学習対象から常に除外される。`public`・`home`（Misskey）・`unlisted`（Mastodon）のみ学習対象。

### 形態素解析

| キー | デフォルト | 説明 |
|---|---|---|
| `MORPH_URLFETCH_FALLBACK_THRESHOLD` | `15000` | UrlFetch 累計がこの値を超えたら簡易解析に切り替え |

### メンション返信

| キー | デフォルト | 説明 |
|---|---|---|
| `MENTION_ENABLED` | `TRUE` | メンション返信を有効にするか |
| `MENTION_MUTUAL_ONLY` | `TRUE` | 相互フォローのみ返信するか |
| `MENTION_MAX_PER_USER_PER_DAY` | `10` | 1ユーザーへの日次返信上限 |
| `MENTION_GLOBAL_MAX_PER_HOUR` | `20` | 全ユーザー合算の時間あたり返信上限 |
| `MENTION_FALLBACK_TEXT` | `生成失敗しちゃった` | 生成失敗時の固定返信テキスト |
| `MENTION_EXCLUDE_BOTS` | `TRUE` | bot からのメンションを無視するか |

### フォロー管理

| キー | デフォルト | 説明 |
|---|---|---|
| `FOLLOW_AUTO_FOLLOW_BACK` | `TRUE` | フォローバックを自動で行うか |
| `FOLLOW_AUTO_UNFOLLOW_BACK` | `FALSE` | フォロー解除されたら自動アンフォローするか |
| `FOLLOW_UNFOLLOW_GRACE_CYCLES` | `2` | アンフォロー判定の猶予サイクル数 |
| `FOLLOW_KEYWORD_ENABLED` | `TRUE` | キーワードフォローバックを有効にするか |
| `FOLLOW_KEYWORDS` | `フォローして,followして,相互フォロー` | フォローバックキーワード（カンマ区切り） |

### カスタム絵文字

| キー | デフォルト | 説明 |
|---|---|---|
| `EMOJI_REFRESH_INTERVAL_DAYS` | `7` | 自鯖カスタム絵文字の更新間隔（日） |
| `EMOJI_MAX_COUNT` | `500` | 保持する絵文字の最大件数 |

### NGワード

| キー | デフォルト | 説明 |
|---|---|---|
| `NG_WORDS_EXTERNAL_URL` | (GitHub 公開リスト) | NGワード外部リスト URL |

### メンテナンス

| キー | デフォルト | 説明 |
|---|---|---|
| `MAINTENANCE_ENABLED` | `TRUE` | 日次メンテナンスを有効にするか |
| `MAINTENANCE_CLEANUP_DAYS` | `30` | この日数より古いデータを削除 |
| `PROCESSED_ID_RETENTION_DAYS` | `14` | 処理済み投稿 ID の保持期間（日） |

### エラー通知

| キー | デフォルト | 説明 |
|---|---|---|
| `ERROR_NOTIFY_ENABLED` | `FALSE` | エラー発生時にメール通知するか |
| `ERROR_NOTIFY_EMAIL` | (空) | 通知先メールアドレス |

---

## API トークンの保存先

トークン類は GAS の **スクリプトプロパティ**（`PropertiesService.getScriptProperties()`）に保存される。
スプレッドシートには保存されない。

| プロパティキー | 内容 |
|---|---|
| `MISSKEY_TOKEN` | Misskey API トークン |
| `MASTODON_TOKEN` | Mastodon API トークン（アクセストークン） |
| `MISSKEY_WEBHOOK_SECRET` | Webhook 署名検証用シークレット |
| `YAHOO_CLIENT_ID` | Yahoo! 形態素解析 API Client ID |

---

## スプレッドシート構成（12シート）

| シート名 | 用途 |
|---|---|
| 設定 | 設定キー・値・説明 |
| 学習除外ブラックリスト | 学習から除外するユーザー・インスタンス |
| NGワード | カスタム NGワード（1行1単語） |
| 自鯖カスタム絵文字 | 絵文字名・URL・最終更新日時 |
| N-gram本体 | bigram チェーン（最大 50,000 行） |
| 生学習データ | 学習用の生テキスト（保持期間後削除） |
| 処理済み投稿ID(Misskey) | 学習済みノート ID（14日で削除） |
| 処理済み投稿ID(Mastodon) | 学習済みステータス ID（14日で削除） |
| 投稿履歴ハッシュ | 重複投稿チェック用ハッシュ |
| フォロー管理 | フォロワー・フォロー中の一覧 |
| ダッシュボード | 日次統計（投稿数・学習数・エラー数など） |
| エラーログ | エラー発生日時・関数名・メッセージ |

---

## 開発コマンド

```sh
npm test           # Jest ユニットテスト（236件）
npm run lint       # src/*.gs の ESLint
npm run lint:lib   # src/lib/*.js + tests/ の ESLint
npm run push       # GAS にプッシュ
npm run pull       # GAS からプル
npm run watch      # ファイル変更時に自動プッシュ
```

---

## アーキテクチャ概要

```
GAS 層（Google Apps Script）
├─ Setup.gs       UI メニュー・スプレッドシート初期化・設定管理
├─ Core.gs        共通ユーティリティ（設定取得・ログ・カウンタ）
├─ Webhook.gs     Misskey webhook エンドポイント（doPost）
├─ Adapter.gs     Misskey / Mastodon API ラッパー（15 メソッド統一インタフェース）
├─ Features.gs    自動投稿・学習・Mastodon ポーリング・ダッシュボード書き込み
├─ Maintenance.gs 日次メンテナンス・フォロー同期・各種ローテーション
└─ Markov.gs      N-gram 学習・マルコフ連鎖投稿生成

lib 層（Node.js でもテスト可能な純粋関数）
├─ adapter.js     UnifiedNote 変換・パース・認証ヘッダ構築
├─ markov.js      NGramStore クラス・学習・生成・絵文字注入（シートエラーセルガード付き）
├─ text.js        テキスト前処理（学習入力: 9 ステップパイプライン）・生成後処理（sanitizeGeneratedText）
├─ morph.js       Yahoo 形態素解析レスポンス処理・フォールバック解析
├─ time.js        夜間判定・時間予算判定
├─ ngwords.js     NGワード判定・ジャッカード類似度
└─ validate.js    設定値検証

テスト
└─ tests/         Jest ユニットテスト（lib 7ファイル + adapter 2ファイル）
```

## ライセンス

MIT
