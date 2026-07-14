# バックエンド セットアップ手順（世帯共有）

`backend/Code.gs` を Google Apps Script に載せて、家族データの共有置き場を作る手順。**渡辺さんの操作**が必要な部分です（アカウント/認証情報の操作は私が代行できないため）。所要 15〜20分。

> セキュリティの肝: 秘密情報はすべて GAS のスクリプトプロパティに置きます。公開リポジトリ（フロント）には URL しか置きません。書き込みは LINE の IDトークンを GAS 側で検証するので、**URL を知っているだけの他人は書き込めません**。

## 1. スプレッドシートを作る

1. Googleドライブで新しいスプレッドシートを作成（名前は「わが家ホーム DB」など）。
2. シート名（左下のタブ）を `households` に変更。
3. 1行目に見出しを入れる（任意だがおすすめ）:
   `householdId | inviteCode | members | data | updatedAt`
4. URL の `/d/` と `/edit` の間の文字列が **スプレッドシートID**。控えておく。

## 2. Apps Script プロジェクトを作る

1. スプレッドシートのメニュー **拡張機能 → Apps Script**。
2. 既定の `Code.gs` の中身を全消しして、この repo の `backend/Code.gs` を丸ごと貼り付け。
3. 保存（プロジェクト名は「わが家ホーム backend」など）。

## 3. スクリプトプロパティを設定

Apps Script 左の **歯車（プロジェクトの設定）→ スクリプト プロパティ** で2つ追加:

| プロパティ | 値 |
|---|---|
| `SHEET_ID` | 手順1で控えたスプレッドシートID |
| `LINE_LOGIN_CHANNEL_ID` | LIFFチャネルの**チャネルID**（数字）|

> `LINE_LOGIN_CHANNEL_ID` は、LINE Developers コンソールの LINEログインチャネル基本情報にある「チャネルID」。目安として、`js/config.js` の `LIFF_ID`（`2010693415-ddc2Kd3X`）の **ダッシュより前の数字 `2010693415`** がそれに当たることが多いです。念のためコンソールで確認してください。

## 4. ウェブアプリとしてデプロイ

1. 右上 **デプロイ → 新しいデプロイ**。
2. 種類 = **ウェブアプリ**。
3. 説明 = 任意 / **実行するユーザー = 自分** / **アクセスできるユーザー = 全員**。
4. デプロイ → 権限を承認（自分のGoogleアカウントで）。
5. 発行された **ウェブアプリURL（`…/exec` で終わる）** を控える。これをフロントに設定します。

## 5. 動作確認（任意）

ブラウザでウェブアプリURLをそのまま開くと `{"ok":true,"service":"wagaya-home backend",...}` が返れば起動OK。
（データ操作は IDトークンが要るので、ここでは起動確認だけ）

## 6. フロントに URL をつなぐ

次の私の作業で、`js/config.js` に `SYNC_URL`（このURL）を設定する口を用意します。URL を教えてもらえれば設定します（公開して問題ないURLです。守るのはURLの秘匿ではなくIDトークン検証です）。

---

## API（参考・フロントが使う）

すべて `POST`（`Content-Type: text/plain` でプリフライト回避）。本文は JSON。必須で `idToken` を含める。

| action | 目的 | 返り値 |
|---|---|---|
| `create` | 世帯を新規作成（作成者が最初のメンバー）| `householdId`, `inviteCode`, `data`, `updatedAt` |
| `join` | `inviteCode` で既存世帯に参加 | `householdId`, `data`, `updatedAt` |
| `pull` | 自分の世帯データを取得 | `data`, `updatedAt`（未参加なら `household:null`）|
| `push` | 自分の世帯データを更新（後勝ち）| `updatedAt` |
| `leave` | 世帯から抜ける | `left` |

## あとで（通知プッシュ用）

プッシュ通知を足すときに、追加で:
- スクリプトプロパティ `MESSAGING_CHANNEL_TOKEN`（LINE Messaging API チャネルのアクセストークン）
- 時間主導トリガー（毎朝、その日のダイジェストを push）

詳細は `docs/plan-notifications.md`。
