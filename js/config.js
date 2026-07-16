// ============================================
// アプリ設定
// LIFF_IDを設定すると本番モード(LINEログイン)になります。
// 空のままだとモックモード(ブラウザ単体で動作確認)。
// ============================================
window.APP_CONFIG = {
  APP_NAME: "暮らしnote",
  VERSION: "0.35.3",
  LIFF_ID: "2010693415-ddc2Kd3X",
  // 世帯共有バックエンド(GAS)のウェブアプリURL。空のあいだは同期は完全に無効(端末内のみ)。
  // ※共有用の正しい形は /u/N/ を含まない .../macros/s/.../exec
  SYNC_URL: "https://script.google.com/macros/s/AKfycbzzvr5jG13CxFvWEdKTo75T-JEUvKSZGDfSIzrWgMskkeVP6ELOI6ADsN-uN1RzBYg/exec",
};
