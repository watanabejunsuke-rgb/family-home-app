// ============================================
// 利用状況の匿名計測 — App.track(eventName, props)
// ・本文(タイトル・メモなどの中身)は絶対に送らない。件数・種類・文字数などの数値だけ
// ・失敗しても主要な操作を止めない(すべて握りつぶす)
// ・フラグPRODUCT_ANALYTICSがOFF、またはLINE未接続・世帯未参加なら何もしない
// ============================================
window.App = window.App || {};

(function () {
  // propsとして送ってよい値: 数値・真偽値・短い英数字ラベルのみ。
  // 日本語の自由文が紛れ込んでも送信前にここで落とす(プライバシー保護の最後の砦)
  function sanitizeProps(props) {
    const out = {};
    Object.entries(props || {}).forEach(([k, v]) => {
      if (typeof v === "number" || typeof v === "boolean") out[k] = v;
      else if (typeof v === "string" && /^[\w-]{0,32}$/.test(v)) out[k] = v;
    });
    return out;
  }

  App.track = function (eventName, props) {
    try {
      if (!App.flag || !App.flag("PRODUCT_ANALYTICS")) return;
      if (!App.sync || !App.sync.enabled || !App.sync.enabled()) return;
      App.sync
        .call("logEvent", { event: String(eventName).slice(0, 64), props: sanitizeProps(props) })
        .catch(() => { /* 計測はベストエフォート。失敗は無視 */ });
    } catch (e) { /* 計測が主要操作を巻き込まないよう常に握りつぶす */ }
  };

  // LINEから開かれた(LIFF内で起動した)ことを1日1回だけ数える
  App.trackAppOpened = function () {
    try {
      if (!App.liffState || App.liffState.mode !== "liff") return;
      const t = App.date.today();
      if (App.store.state.settings.openTrackedDate === t) return;
      App.store.state.settings.openTrackedDate = t;
      App.store.saveLocal();
      App.track("miniapp_opened_from_line", {});
    } catch (e) { /* 同上 */ }
  };
})();
