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
          // iPhoneの「ホーム画面に追加」から開いた場合(スタンドアロン表示)は
          // liff.login()を呼ばない。ホーム画面アイコンは独立した保存領域を持つため
          // ログインが必要になりがちな上、LINEアプリへの引き継ぎから戻る先が
          // 元のアイコンではなく新しいSafariタブになってしまい、アイコン側は
          // 何度タップしても同じログイン画面に迷い込む(2026-07-20、実機で確認)。
          // この状態ではリダイレクトを試みず、手元のキャッシュデータのまま表示する
          const isStandalone = window.navigator.standalone === true
            || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
          if (isStandalone) {
            App.liffState.mode = "mock";
            // このフラグが立っている間、画面上部に「LINEを開く」導線を常時表示する
            // (js/app.jsのrenderSyncBanner)。予定の追加・編集はできてしまうが
            // 家族と共有されない(サーバーへ送られない)ため、気づけるようにする
            App.liffState.needsLogin = true;
            onReady();
            App.toast("最新の状態にするには、LINEのトークから開いてください", "info");
            return;
          }
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
