// ============================================
// データ層 — localStorage永続化 + モックシード
// 実データ運用に切り替える際は load/save をGAS API等に差し替える。
// ============================================
window.App = window.App || {};

(function () {
  const KEY = "wagaya-home-v1";

  // ---- 日付ユーティリティ ----
  const pad = (n) => String(n).padStart(2, "0");
  const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => dstr(new Date());
  const daysAgo = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return dstr(d);
  };
  const daysAhead = (n) => daysAgo(-n);

  App.date = { str: dstr, today, daysAgo, daysAhead, pad };

  let uidCounter = 0;
  App.uid = () => `id-${Date.now().toString(36)}-${(uidCounter++).toString(36)}`;

  // ---- モックシード(初回起動時のみ投入) ----
  function seed() {
    return {
      isMockData: true,
      settings: { userName: "パパ", notifications: true, favoriteTeam: "" },
      family: [
        { id: "f1", name: "パパ", status: "在宅", updatedAt: Date.now() },
        { id: "f2", name: "ママ", status: "外出中", updatedAt: Date.now() },
        { id: "f3", name: "はると", status: "保育園", updatedAt: Date.now() },
        { id: "f4", name: "めい", status: "お昼寝中", updatedAt: Date.now() },
      ],
      events: [
        { id: App.uid(), date: today(), time: "10:00", title: "めい 予防接種(ひまわり小児科)", memberIds: ["f2", "f4"] },
        { id: App.uid(), date: today(), time: "16:30", title: "こた めばえ", memberIds: ["f3"] },
        { id: App.uid(), date: daysAhead(1), time: "10:30", title: "家族でおでかけ(ぽかぽか公園)", memberIds: ["f1", "f2", "f3", "f4"] },
        { id: App.uid(), date: daysAhead(3), time: "19:00", title: "ゴミ出し(資源ごみ)", memberIds: ["f1"] },
      ],
      tasks: [
        { id: App.uid(), title: "保育園の連絡帳を書く", due: today(), done: false, createdAt: Date.now() },
        { id: App.uid(), title: "オムツを注文する", due: today(), done: false, createdAt: Date.now() },
        { id: App.uid(), title: "水筒を洗う", due: today(), done: true, createdAt: Date.now() },
        { id: App.uid(), title: "写真をプリントする", due: daysAhead(4), done: false, createdAt: Date.now() },
        { id: App.uid(), title: "実家に電話する", due: null, done: false, createdAt: Date.now() },
      ],
      shopping: [
        { id: App.uid(), name: "牛乳", done: false },
        { id: App.uid(), name: "オムツ(Mサイズ)", done: false },
        { id: App.uid(), name: "バナナ", done: false },
        { id: App.uid(), name: "食パン", done: true },
      ],
      plants: [
        {
          id: App.uid(), name: "パキラ", place: "リビング", cycleDays: 7, wateredAt: daysAgo(6),
          careTasks: [
            { id: App.uid(), label: "摘芯", mode: "range", startDate: daysAhead(3), endDate: daysAhead(17) },
          ],
          careLog: [],
        },
        {
          id: App.uid(), name: "ポトス", place: "玄関", cycleDays: 10, wateredAt: daysAgo(2),
          careTasks: [
            { id: App.uid(), label: "植え替え", mode: "date", date: daysAhead(30) },
          ],
          careLog: [],
        },
      ],
      notes: [
        { id: App.uid(), type: "diary", date: daysAgo(1), title: "", body: "はるとが初めて自転車の補助輪なしで3メートル進めた。本人が一番びっくりしていた。", updatedAt: Date.now() },
        { id: App.uid(), type: "memo", date: daysAgo(2), title: "保育園の夏祭り", body: "7/26(日) 10時〜。浴衣は任意。水筒持参。", updatedAt: Date.now() },
      ],
      aiChat: [
        { role: "ai", text: "こんにちは!家族のこと、家のこと、なんでも気軽に相談してくださいね。", at: Date.now() },
      ],
    };
  }

  // 柏レイソルの試合カラー導入(v0.13.3、専用色への変更はv0.13.5)より前に
  // 登録された試合は色が付いていない/違う色のため、読み込み・同期のたびに補正する
  // (新規作成分は最初から専用色7が付くので影響なし)
  App.migrateMatchColors = function (state) {
    (state.events || []).forEach((e) => {
      if (e.kind === "match" && /柏レイソル/.test(e.title) && e.color !== 7) e.color = 7;
    });
  };

  // ---- ストア本体 ----
  const store = {
    state: null,

    load() {
      try {
        const raw = localStorage.getItem(KEY);
        this.state = raw ? JSON.parse(raw) : seed();
      } catch (e) {
        this.state = seed();
      }
      App.migrateMatchColors(this.state);
      this.save();
    },

    save() {
      try {
        localStorage.setItem(KEY, JSON.stringify(this.state));
      } catch (e) {
        App.toast && App.toast("保存できませんでした。空き容量を確認してください。", "info");
      }
      // 世帯共有が有効なら、変更をデバウンスしてサーバーへ(未設定なら何もしない)
      if (App.sync && App.sync.afterSave) App.sync.afterSave();
    },

    // 同期を発火させずにローカルだけ保存(同期処理が syncedAt を書き戻すときに使う)
    saveLocal() {
      try {
        localStorage.setItem(KEY, JSON.stringify(this.state));
      } catch (e) { /* 容量オーバー等は次回に委ねる */ }
    },

    // 変更→保存→再描画 を一括で行う
    update(mutator) {
      mutator(this.state);
      // 自分で何か操作した時点で「サンプルデータ」ではなくなる
      if (this.state.isMockData) this.state.isMockData = false;
      this.save();
      if (App.refresh) App.refresh();
    },

    reset() {
      this.state = seed();
      this.save();
      if (App.refresh) App.refresh();
    },

    // サンプルデータを一切残さず、まっさらな空の状態にする(設定・世帯参加はそのまま維持)
    clear() {
      Object.assign(this.state, {
        family: [],
        events: [],
        tasks: [],
        shopping: [],
        plants: [],
        notes: [],
        aiChat: [
          { role: "ai", text: "こんにちは!家族のこと、家のこと、なんでも気軽に相談してくださいね。", at: Date.now() },
        ],
        isMockData: false,
      });
      this.save();
      if (App.refresh) App.refresh();
    },
  };

  App.store = store;

  // ---- よく使う参照ヘルパー ----
  App.data = {
    member(id) {
      return store.state.family.find((f) => f.id === id);
    },
    todayEvents() {
      return store.state.events
        .filter((e) => e.date === today())
        .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    },
    eventsOn(dateStr) {
      return store.state.events
        .filter((e) => e.date === dateStr)
        .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    },
    todayTasks() {
      // 今日が期限 or 期限切れの未完了を優先し、完了済みは後ろへ
      const t = today();
      return store.state.tasks
        .filter((x) => x.due && x.due <= t)
        .sort((a, b) => Number(a.done) - Number(b.done) || (a.due || "").localeCompare(b.due || ""));
    },
    shoppingRemaining() {
      return store.state.shopping.filter((s) => !s.done).length;
    },
    plantsDue() {
      return store.state.plants.filter((p) => App.plantDaysLeft(p) <= 0).length;
    },
    // 植物由来の「今日やること」— 水やり期限・お手入れ適期をタスクの形に導出する。
    // tasksには保存しない(水やり・完了すると条件から外れて自然に消える)
    plantCareItems() {
      const t = today();
      const fmtShort = (s) => {
        const d = new Date(s + "T00:00:00");
        return `${d.getMonth() + 1}/${d.getDate()}`;
      };
      const items = [];
      store.state.plants.forEach((p) => {
        const left = App.plantDaysLeft(p);
        if (left <= 0) {
          items.push({
            id: `plant-water-${p.id}`,
            kind: "water",
            plantId: p.id,
            title: `「${p.name}」に水やり`,
            meta: left === 0 ? "今日が目安日です" : `目安日から${-left}日たっています`,
            done: false,
          });
        }
        (p.careTasks || []).forEach((c) => {
          const started = c.mode === "range" ? c.startDate <= t : c.date <= t;
          if (!started) return;
          let meta;
          if (c.mode === "range") {
            meta = t <= c.endDate
              ? `いま適期(${fmtShort(c.startDate)}〜${fmtShort(c.endDate)})`
              : `適期をすぎています(〜${fmtShort(c.endDate)})`;
          } else {
            meta = c.date === t ? "今日が予定日です" : `予定日をすぎています(${fmtShort(c.date)})`;
          }
          items.push({
            id: `plant-care-${p.id}-${c.id}`,
            kind: "care",
            plantId: p.id,
            careId: c.id,
            title: `「${p.name}」の${c.label}`,
            meta,
            done: false,
          });
        });
      });
      return items;
    },

    // お知らせ(アプリ内通知)— 今日/期限まわりの「気づいてほしい」項目を集約する。
    // settings.notifPrefs で種類ごとにオン・オフ(未設定なら全部オン)。
    // 実データから毎回導出するので、完了・水やり等で対応すると自然に消える。
    notifications() {
      const t = today();
      const prefs = (store.state.settings && store.state.settings.notifPrefs) || {};
      const on = (cat) => prefs[cat] !== false;
      const list = [];

      // 期限切れ・今日までのやること(未完了)
      if (on("task")) {
        store.state.tasks
          .filter((x) => !x.done && x.due && x.due <= t)
          .sort((a, b) => (a.due || "").localeCompare(b.due || ""))
          .forEach((x) =>
            list.push({
              id: "task-" + x.id,
              cat: "task", icon: "check", title: x.title,
              meta: x.due < t ? `期限切れ(${App.fmtDate(x.due)})` : "今日まで",
              route: "tasks",
            })
          );
      }

      // 今日の予定(試合は「試合」種別、それ以外は「予定」種別で扱う)
      this.todayEvents().forEach((e) => {
        const isMatch = e.kind === "match";
        if (isMatch ? !on("match") : !on("event")) return;
        list.push({
          id: "event-" + e.id,
          cat: isMatch ? "match" : "event",
          icon: isMatch ? "heart" : "calendar",
          title: e.title.replace(/^⚽\s*/, ""),
          meta: `今日 ${e.time || "終日"}`,
          route: "calendar",
        });
      });

      // 植物(水やり期限・お手入れ適期)
      if (on("plant")) {
        this.plantCareItems().forEach((p) =>
          list.push({
            id: p.id,
            cat: "plant", icon: p.kind === "water" ? "drop" : "leaf",
            title: p.title, meta: p.meta, route: "plants",
          })
        );
      }

      // 明日の試合の前日お知らせ(今日の分は上の予定側に出る)
      if (on("match")) {
        const tomorrow = App.date.daysAhead(1);
        store.state.events
          .filter((e) => e.kind === "match" && e.date === tomorrow)
          .forEach((e) =>
            list.push({
              id: "event-" + e.id,
              cat: "match", icon: "heart",
              title: e.title.replace(/^⚽\s*/, ""),
              meta: `明日 ${e.time || ""}`.trim(),
              route: "calendar",
            })
          );
      }

      return list;
    },

    // 未読(まだお知らせを開いて確認していない)件数。バッジ表示に使う。
    notifUnseenCount() {
      const seen = new Set((store.state.settings && store.state.settings.notifSeen) || []);
      return this.notifications().filter((n) => !seen.has(n.id)).length;
    },

    // お知らせを開いたとき、いま出ている項目を既読にする(=同時に古いIDを掃除)。
    markNotificationsSeen() {
      store.update((st) => {
        st.settings.notifSeen = App.data.notifications().map((n) => n.id);
      });
    },
  };

  // 植物由来タスクの完了処理(ホーム・やること画面のチェックから呼ばれる)
  App.completePlantCareItem = function (item) {
    let toastMsg = "";
    let toastIcon = "checkCircle";
    App.store.update((st) => {
      const p = st.plants.find((x) => x.id === item.plantId);
      if (!p) return;
      if (item.kind === "water") {
        p.wateredAt = today();
        toastMsg = `「${p.name}」に水やりしました`;
        toastIcon = "drop";
      } else {
        const c = (p.careTasks || []).find((x) => x.id === item.careId);
        if (!c) return;
        p.careTasks = p.careTasks.filter((x) => x.id !== item.careId);
        if (!p.careLog) p.careLog = [];
        p.careLog.push({ label: c.label, doneAt: today() });
        toastMsg = `「${c.label}」を完了しました`;
      }
    });
    if (toastMsg) App.toast(toastMsg, toastIcon);
  };

  // 水やり残日数(0以下=そろそろ)
  App.plantDaysLeft = function (p) {
    const watered = new Date(p.wateredAt + "T00:00:00");
    const next = new Date(watered);
    next.setDate(next.getDate() + p.cycleDays);
    const now = new Date(today() + "T00:00:00");
    return Math.round((next - now) / 86400000);
  };
})();
