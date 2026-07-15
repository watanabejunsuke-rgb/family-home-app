// ============================================
// 世帯データ同期(GAS) — SYNC_URL 未設定なら完全に無効(現状と同じ挙動)
//
// - 端末ローカルのみの項目(表示名・お知らせ既読・AIチャット)は同期しない
// - 共有するのは family/events/tasks/shopping/plants/notes と favoriteTeam
// - 競合は「後勝ち(updatedAt)」。起動時 pull、変更後はデバウンスして push
// - リモート反映(import)中とpush中は自動pushを止め、往復ループを防ぐ
// - settings.notifPrefs(通知のオン・オフ)だけは世帯共有の対象外で、
//   pushNotifPrefs()経由でuserIdごとにサーバーへ個別送信する(LINEプッシュの
//   毎朝ダイジェストが本人の設定に従うようにするため)
// ============================================
window.App = window.App || {};

(function () {
  const cfg = () => window.APP_CONFIG || {};
  const SHARED_KEYS = ["family", "events", "tasks", "shopping", "plants", "notes"];

  App.sync = {
    _timer: null,
    _pushing: false,
    _applyingRemote: false,

    configured() { return !!cfg().SYNC_URL; },
    hasHousehold() {
      const s = App.store.state && App.store.state.settings;
      return !!(s && s.householdId);
    },
    inLiff() { return !!App.liffState && App.liffState.mode === "liff"; },
    enabled() { return this.configured() && this.inLiff() && this.hasHousehold(); },

    // IDトークンは寿命が短いため、呼ぶたびにLIFF SDKから毎回取り直す
    // (以前は起動時に1回だけ取得してキャッシュしていたため、テストを重ねる
    // うちに期限切れになり「IdToken expired」で失敗する不具合があった)
    idToken() {
      if (window.liff && typeof window.liff.getIDToken === "function") {
        const t = window.liff.getIDToken();
        if (t) return t;
      }
      throw new Error("LINEログインが必要です");
    },

    async call(action, extra) {
      const url = cfg().SYNC_URL;
      if (!url) throw new Error("同期先が未設定です");
      const idToken = this.idToken();
      const res = await fetch(url, {
        method: "POST",
        // text/plain にしてプリフライト(OPTIONS)を避ける
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(Object.assign({ action, idToken }, extra || {})),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "同期に失敗しました");
      return data;
    },

    // ---- 世帯管理(UIから呼ばれる) ----
    async create() {
      const r = await this.call("create", { data: this._export() });
      this._applyRemote(() => this._saveHousehold(r));
      this.pushNotifPrefs(); // 初回から自分の通知設定をサーバーに登録しておく
      return r;
    },
    async join(inviteCode) {
      const r = await this.call("join", { inviteCode });
      this._applyRemote(() => {
        this._saveHousehold(r);
        if (r.data) this._merge(r.data);
      });
      if (!r.data) await this._pushNow(); // 相手が空なら自分の内容を初期データにする
      this.pushNotifPrefs();
      return r;
    },
    async leave() {
      try { await this.call("leave"); } catch (e) { /* 通信不可でもローカルは解除する */ }
      App.store.update((st) => {
        delete st.settings.householdId;
        delete st.settings.inviteCode;
        delete st.settings.syncedAt;
      });
    },

    // ---- 同期 ----
    async pull() {
      if (!this.enabled()) return { skipped: true };
      const r = await this.call("pull");
      if (r.household === null) {
        App.store.update((st) => { delete st.settings.householdId; });
        return { removed: true };
      }
      const localAt = App.store.state.settings.syncedAt || 0;
      if (r.data && r.updatedAt && r.updatedAt > localAt) {
        this._applyRemote(() => {
          this._merge(r.data);
          App.store.state.settings.syncedAt = r.updatedAt;
        });
        return { updated: true };
      }
      return { updated: false };
    },

    async _pushNow() {
      if (!this.enabled()) return;
      this._pushing = true;
      try {
        const r = await this.call("push", { data: this._export() });
        App.store.state.settings.syncedAt = r.updatedAt;
        App.store.saveLocal();
      } finally {
        this._pushing = false;
      }
    },

    // 植物の写真をアップロード(base64→Driveに保存)。戻り値: {id, url}
    // 世帯共有データそのものではない(URLだけを後でplant.photosに保存する)ので、
    // enabled()判定はここでは行わず呼び出し側(画面)が確認する
    async uploadPlantPhoto(plantId, dataBase64, mimeType, filename) {
      const r = await this.call("uploadPlantPhoto", { plantId, dataBase64, mimeType, filename });
      return { id: r.id, url: r.url };
    },
    async deletePlantPhoto(fileId) {
      await this.call("deletePlantPhoto", { fileId });
    },

    // 自分(このLINEアカウント)の通知オン・オフ設定をサーバーへ送る。
    // 世帯の共有データとは別枠(userIdごと)なので、他メンバーの設定には影響しない。
    // 失敗しても静かに諦める(次にトグルした時にまた送られる)
    async pushNotifPrefs() {
      if (!this.enabled()) return;
      try {
        await this.call("setNotifPrefs", { prefs: App.store.state.settings.notifPrefs || {} });
      } catch (e) { /* オフライン等: 次回の変更時に再送 */ }
    },

    // store.save() から呼ばれる。無効時・リモート反映中・push中は何もしない
    afterSave() {
      if (!this.enabled() || this._pushing || this._applyingRemote) return;
      clearTimeout(this._timer);
      this._timer = setTimeout(() => {
        this._pushNow().catch(() => { /* オフライン等: 次の変更で再送 */ });
      }, 1500);
    },

    // 画面を開いている間、相手の変更を定期的に取りに行く(20秒間隔)。
    // 画面が裏に回っているあいだは止めてバッテリー・通信を節約し、
    // 前面に戻った瞬間にも1回取得する。世帯未参加・LINE未接続なら中身は何もしない。
    _pollTimer: null,
    startPolling() {
      if (this._pollTimer) return;
      const POLL_MS = 20000;
      const tick = () => {
        if (document.hidden || !this.enabled() || this._pushing || this._applyingRemote) return;
        this.pull()
          .then((r) => { if (r && r.updated && App.refresh) App.refresh(); })
          .catch(() => { /* オフライン等は無視、次回に任せる */ });
      };
      this._pollTimer = setInterval(tick, POLL_MS);
      document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
    },

    // 起動時: ローカル表示のあとに非同期でpull
    async init() {
      if (!this.enabled()) return;
      try {
        const r = await this.pull();
        if (r && r.updated && App.refresh) App.refresh();
      } catch (e) { /* オフライン等は無視(ローカル表示のまま) */ }
    },

    // ---- 内部 ----
    _applyRemote(fn) {
      this._applyingRemote = true;
      try { fn(); } finally { this._applyingRemote = false; }
    },
    _export() {
      const st = App.store.state;
      const out = {};
      SHARED_KEYS.forEach((k) => { out[k] = st[k]; });
      out.settings = { favoriteTeam: st.settings.favoriteTeam || "" };
      return out;
    },
    _merge(data) {
      App.store.update((st) => {
        SHARED_KEYS.forEach((k) => { if (Array.isArray(data[k])) st[k] = data[k]; });
        if (data.settings && data.settings.favoriteTeam !== undefined) {
          st.settings.favoriteTeam = data.settings.favoriteTeam;
        }
        st.isMockData = false;
        App.migrateMatchColors(st);
      });
    },
    _saveHousehold(r) {
      App.store.update((st) => {
        st.settings.householdId = r.householdId;
        if (r.inviteCode) st.settings.inviteCode = r.inviteCode;
        if (r.updatedAt) st.settings.syncedAt = r.updatedAt;
        st.isMockData = false;
      });
    },
  };
})();
