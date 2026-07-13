// ============================================
// LIFF接続 — LIFF_ID未設定時はモックモードで動作
// ============================================
window.App = window.App || {};

(function () {
  App.liffState = { mode: "mock", profile: null, error: null };

  App.initLiff = function (onReady) {
    const id = window.APP_CONFIG.LIFF_ID;
    if (!id) {
      // モックモード:ブラウザ単体での動作確認用
      App.liffState.mode = "mock";
      App.liffState.profile = { displayName: App.store.state.settings.userName };
      onReady();
      return;
    }
    // 本番モード:LIFF SDKを動的読み込み
    const script = document.createElement("script");
    script.src = "https://static.line-scdn.net/liff/edge/2/sdk.js";
    script.onload = async () => {
      try {
        await window.liff.init({ liffId: id });
        if (!window.liff.isLoggedIn()) {
          window.liff.login();
          return;
        }
        const profile = await window.liff.getProfile();
        App.liffState.mode = "liff";
        App.liffState.profile = profile;
        App.store.update((st) => {
          st.settings.userName = profile.displayName;
        });
        onReady();
      } catch (e) {
        App.liffState.error = e;
        App.liffState.mode = "mock";
        onReady();
        App.toast("LINEと接続できませんでした。オフラインで表示しています。", "info");
      }
    };
    script.onerror = () => {
      App.liffState.mode = "mock";
      onReady();
      App.toast("情報を読み込めませんでした。通信状況を確認して、もう一度お試しください。", "info");
    };
    document.head.appendChild(script);
  };
})();
