# わが家ホーム — 家庭向けLINEミニアプリ

家族の日常を管理する「家庭のホーム画面」。
Apple Homeのカード UI × 無印良品の余白 × 北欧の温かい色 × Things 3 の操作感をデザイン基準にしています。

## 動かし方

ビルド不要です。`index.html` をブラウザで開くだけで動きます(デモモード)。
データはブラウザの localStorage に保存されます。

## LINEミニアプリとして公開する手順

1. このフォルダを GitHub Pages などの HTTPS ホスティングに置く
2. [LINE Developers](https://developers.line.biz/) でプロバイダー + LINEログインチャネルを作成し、LIFFアプリを追加(エンドポイントURL = 公開URL)
3. 発行された LIFF ID を `js/config.js` の `LIFF_ID` に設定

`LIFF_ID` が空のあいだはモックモード(ブラウザ単体で動作確認)になります。

## 構成

```
index.html            エントリーポイント(SPA)
css/
  tokens.css          デザイントークン(色・余白・角丸・影・文字・z-index・モーション)
  base.css            リセット + アプリ骨格(セーフエリア・100dvh対応)
  components.css      共通コンポーネント(カード/シート/トースト/ナビ/フォーム等)
  screens.css         画面別スタイル
js/
  config.js           設定(LIFF ID はここ)
  icons.js            アウトラインSVGアイコンセット
  store.js            データ層(localStorage + モックシード)
  ui.js               共通UIビルダー(BottomSheet, Toast, TaskItem, ChipSelect等)
  liff.js             LIFF接続(未設定時はモックモード)
  app.js              ルーティング・ヘッダー・下部ナビ
  js/screens/         各画面(home / calendar / tasks / shopping / family / plants / notes / ai / menu)
```

## 画面

- **ホーム** — 挨拶、今日の予定、家族のようす、今日やること(最大5件)、クイックアクセス
- **カレンダー** — 月グリッド + 選択日の予定、予定の追加・編集・削除
- **やること** — 今日/すべて切替、完了チェック(アニメーション付き)
- **買い物リスト** — その場追加、購入済み管理
- **家族のようす** — 本人が自分で更新するステータス(位置情報の自動追跡なし)
- **植物の記録** — 水やり周期メーター、「そろそろ」表示
- **メモ・日記** — メモ/日記の切替
- **AIに相談** — 現在はデモ応答(正式版でAI API連携予定)
- **メニュー** — 各機能への導線、通知設定(準備中)、データ初期化

## 今後の拡張ポイント

- `store.js` の load/save を GAS Web API(スプレッドシート)や Firebase に差し替えると家族間同期が可能
- `liff.js` 経由で Messaging API のプッシュ通知(予定リマインド・水やり通知)へ発展
- `ai.js` の `mockReply` を Claude API 等に差し替えると本物のAI相談に

## 対象外(仕様)

金融機関API連携・口座情報・家計簿連携・決済機能は実装しません。
