// ============================================
// アプリ設定
// LIFF_IDを設定すると本番モード(LINEログイン)になります。
// 空のままだとモックモード(ブラウザ単体で動作確認)。
// ============================================
window.APP_CONFIG = {
  APP_NAME: "暮らしnote",
  VERSION: "0.39.4",
  LIFF_ID: "2010693415-ddc2Kd3X",
  // 世帯共有バックエンド(GAS)のウェブアプリURL。空のあいだは同期は完全に無効(端末内のみ)。
  // ※共有用の正しい形は /u/N/ を含まない .../macros/s/.../exec
  SYNC_URL: "https://script.google.com/macros/s/AKfycbzzvr5jG13CxFvWEdKTo75T-JEUvKSZGDfSIzrWgMskkeVP6ELOI6ADsN-uN1RzBYg/exec",
  // LINE公式アカウントのベーシックID(LINE Developers「Messaging API設定」の
  // 「ボットの基本ID」)。ホーム画面アイコンでログイン誘導をスキップした時、
  // 「LINEを開く」導線に使う。値が違う場合はここだけ直せばよい
  LINE_OA_ID: "@419xhscm",

  // 機能フラグ — falseにするとその機能のUI・処理が丸ごと無効になり、従来どおり動く。
  // バックエンド(GAS)側にも対応するフラグ(Script Propertiesの FLAG_*)があり、
  // サーバー側の挙動はそちらで制御する(backend/README.md参照)。
  FEATURE_FLAGS: {
    PRIORITY_LAYER: true,      // ホームの「まず確認」レイヤー
    EVENT_ACTIONS: true,       // 予定の「準備」(担当・持ち物・準備タスク)
    LINE_INBOX: true,          // LINE家族インボックス(未整理一覧)
    LINE_MESSAGE_QUOTA: true,  // 月200通クォータの管理者表示(送信制御自体はGAS側フラグ)
    PRODUCT_ANALYTICS: false,  // 利用状況の匿名計測(GAS側のセットアップ完了後にtrueへ)
  },
};
