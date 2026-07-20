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

  // 機能フラグ(js/config.jsのFEATURE_FLAGS)。未定義キーはfalse扱い
  App.flag = (name) => !!((window.APP_CONFIG || {}).FEATURE_FLAGS || {})[name];

  // ---- モックシード(初回起動時のみ投入) ----
  function seed() {
    return {
      isMockData: true,
      settings: { userName: "パパ", notifications: true, favoriteTeam: "" },
      family: [
        { id: "f1", name: "パパ" },
        { id: "f2", name: "ママ" },
        { id: "f3", name: "はると" },
        { id: "f4", name: "めい" },
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
      // ホーム画面アイコンでログイン誘導をスキップした状態(js/liff.js)では、
      // 保存してもサーバーへ送られず、次にpullReadOnlyが走った瞬間に消えてしまう。
      // 「追加したのに気づかないうちに消えていた」を避けるため、この状態では
      // 保存操作自体を行わず、その場で分かるようにする
      if (App.liffState && App.liffState.needsLogin) {
        App.toast("追加・編集はLINEのトークから開いて行ってください", "info");
        return;
      }
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
    // 予定がdateStrを含むか(endDateがあれば期間、無ければ単日)。
    // 夏季休暇のような複数日にまたがる予定に対応(v0.14.6)
    eventCoversDate(e, dateStr) {
      return e.endDate ? (e.date <= dateStr && dateStr <= e.endDate) : e.date === dateStr;
    },
    todayEvents() {
      const t = today();
      return store.state.events
        .filter((e) => this.eventCoversDate(e, t))
        .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    },
    eventsOn(dateStr) {
      return store.state.events
        .filter((e) => this.eventCoversDate(e, dateStr))
        .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
    },
    // 家族のようす(旧:本人が手動で申告するステータス)は、こまめな手動更新が
    // 現実的でないため廃止し、今日の予定(既存のmemberIds)から自動で導出する方式にした。
    // 予定が無ければnull(「予定なし」として表示側で扱う)
    memberTodaySummary(memberId) {
      const evs = this.todayEvents().filter((e) => (e.memberIds || []).includes(memberId));
      if (!evs.length) return null;
      const first = evs[0]; // todayEventsは既に時刻順
      return {
        title: first.title.replace(/^⚽\s*/, ""),
        time: first.time || "終日",
        moreCount: evs.length - 1,
      };
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

    // 「きょうやったこと」— やること・植物のお世話のうち、今日完了したものを一覧にする。
    // LINEのボタン操作でも完了できるようになったため、アプリを開いたときに「今日やること」
    // からいつの間にか消えていて不安、とならないよう完了の記録を見せる
    doneToday() {
      const t = today();
      const items = [];
      store.state.tasks.forEach((x) => {
        if (x.done && x.doneAt === t) items.push({ title: x.title, doneBy: x.doneBy || null });
      });
      store.state.plants.forEach((p) => {
        if (p.wateredAt === t) items.push({ title: `「${p.name}」に水やり` });
        (p.careLog || []).forEach((c) => {
          if (c.doneAt === t) items.push({ title: `「${p.name}」の${c.label}` });
        });
      });
      return items;
    },

    // 図鑑由来の「今月のお世話ヒント」— うちの植物と図鑑を名前でゆるく突き合わせ、
    // 今月が適期の作業を参考情報として返す。以下は今年すでに対応済みとみなし出さない:
    // ・自分でお手入れ予定(careTasks)を登録済みのラベル
    // ・今年、その作業の適期月のいずれかで「やった」記録(careLog)がある場合(複数月にまたがる
    //   作業を最初の月で済ませても、翌月また出てこないように年単位でチェックする)
    // ・「今年はやらない」を選んだ場合(plant.pediaSkips)。植え替え等、毎年やる必要はない作業向け
    // plantCareItemsと違いdoneの概念がない(月単位の目安のため)ので、チェック項目には混ぜない。
    plantPediaTips() {
      const cur = new Date().getMonth() + 1;
      const curYear = new Date().getFullYear();
      const items = [];
      store.state.plants.forEach((p) => {
        if (!p.name) return;
        const pedia = (App.PLANTPEDIA || []).find(
          (e) => p.name.includes(e.name) || e.name.includes(p.name)
        );
        if (!pedia) return;
        const ownLabels = (p.careTasks || []).map((c) => c.label);
        const skippedLabels = (p.pediaSkips || [])
          .filter((s) => s.year === curYear)
          .map((s) => s.label);
        (pedia.tasks || []).forEach((t) => {
          if (t.months.indexOf(cur) < 0) return;
          if (ownLabels.includes(t.label)) return;
          if (skippedLabels.includes(t.label)) return;
          const doneThisSeason = (p.careLog || []).some((c) => {
            if (c.label !== t.label || !c.doneAt) return false;
            const y = Number(c.doneAt.slice(0, 4));
            const m = Number(c.doneAt.slice(5, 7));
            return y === curYear && t.months.indexOf(m) >= 0;
          });
          if (doneThisSeason) return;
          items.push({
            id: `plant-pedia-${p.id}-${pedia.id}-${t.label}`,
            plantId: p.id,
            label: t.label,
            title: `「${p.name}」の${t.label}`,
            meta: t.freq ? `図鑑のおすすめ・頻度:${t.freq}` : "図鑑のおすすめ(今月が適期)",
          });
        });
      });
      return items;
    },

    // 図鑑ヒントを「やった」記録として残す(careLogに追加するだけ。予定の作成はしない)
    logPediaTip(plantId, label) {
      store.update((st) => {
        const p = st.plants.find((x) => x.id === plantId);
        if (!p) return;
        if (!p.careLog) p.careLog = [];
        p.careLog.push({ label, doneAt: today() });
      });
    },

    // 図鑑ヒントを「今年はやらない」として今年いっぱい非表示にする(履歴には残さない)
    skipPediaTip(plantId, label) {
      const year = new Date().getFullYear();
      store.update((st) => {
        const p = st.plants.find((x) => x.id === plantId);
        if (!p) return;
        if (!p.pediaSkips) p.pediaSkips = [];
        if (!p.pediaSkips.some((s) => s.label === label && s.year === year)) {
          p.pediaSkips.push({ label, year });
        }
      });
    },

    // 担当メンバーの名前(assignedToのmemberIdから)。見つからなければnull
    assigneeName(memberId) {
      if (!memberId) return null;
      const m = this.member(memberId);
      return m ? m.name : null;
    },

    // LINEインボックスの未整理項目(pending=候補待ち・later=あとで整理)。新しい順
    inboxPending() {
      return (store.state.inboxItems || [])
        .filter((i) => i.status === "pending" || i.status === "later")
        .sort((a, b) => (b.receivedAt || 0) - (a.receivedAt || 0));
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
            title: p.title, meta: p.meta, route: "plants", param: p.plantId,
          })
        );
        // 図鑑由来の今月のお世話ヒント(参考情報)
        this.plantPediaTips().forEach((p) =>
          list.push({
            id: p.id,
            cat: "plant", icon: "leaf",
            title: p.title, meta: p.meta, route: "plants", param: p.plantId,
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

      // ---- ここから拡張分(静かに気づける材料。フラグOFFなら一切追加しない) ----
      const tomorrowStr = App.date.daysAhead(1);
      const yesterdayMs = new Date(t + "T00:00:00").getTime() - 86400000;

      if (App.flag("LINE_INBOX")) {
        // 未整理インボックス(件数だけの1行にまとめる)
        const pending = this.inboxPending();
        if (pending.length) {
          list.push({
            id: "inbox-pending-" + t,
            cat: "note", icon: "note",
            title: `LINEから届いたメモが${pending.length}件あります`,
            meta: "タップして整理できます",
            route: "inbox",
          });
        }
      }

      if (App.flag("EVENT_ACTIONS")) {
        store.state.events.forEach((e) => {
          const p = e.preparation;
          // 持ち物未確認(今日・明日の予定)
          if (p && (p.items || []).some((it) => !it.checked) && p.status !== "completed" && p.status !== "skipped") {
            if (this.eventCoversDate(e, t) || this.eventCoversDate(e, tomorrowStr)) {
              list.push({
                id: "prep-" + e.id,
                cat: "event", icon: "calendar",
                title: `「${e.title}」の持ち物`,
                meta: "確認していないものがあります",
                route: "calendar",
              });
            }
          }
          // 担当未定の重要予定(3日先まで)
          if (e.important && (!p || !p.assignedTo) && e.date >= t && e.date <= App.date.daysAhead(3)) {
            list.push({
              id: "unassigned-" + e.id,
              cat: "event", icon: "users",
              title: `「${e.title}」の準備`,
              meta: "だれがやるか決まっていません",
              route: "calendar",
            });
          }
        });
      }

      if (App.flag("PRIORITY_LAYER")) {
        // 期限が近い(明日まで)のやること
        if (on("task")) {
          store.state.tasks
            .filter((x) => !x.done && x.due === tomorrowStr)
            .forEach((x) =>
              list.push({
                id: "task-soon-" + x.id,
                cat: "task", icon: "check", title: x.title,
                meta: "明日が期限", route: "tasks",
              })
            );
        }
        // 昨日以降に変更された今日の予定
        this.todayEvents().forEach((e) => {
          if (e.updatedAt && e.updatedAt >= yesterdayMs) {
            list.push({
              id: "changed-" + e.id + "-" + e.updatedAt,
              cat: "event", icon: "calendar",
              title: e.title.replace(/^⚽\s*/, ""),
              meta: "昨日から内容に変更があります",
              route: "calendar",
            });
          }
        });
      }

      // クォータ等でLINE送信を控えた通知(GASがnotificationCenterへ書き込む)。
      // 古いものはノイズになるため直近7日分だけ表示する
      const weekAgoMs = Date.now() - 7 * 86400000;
      ((store.state.notificationCenter || [])).forEach((n) => {
        if (!n || !n.title) return;
        if (n.createdAt && n.createdAt < weekAgoMs) return;
        list.push({
          id: "nc-" + (n.id || n.createdAt),
          cat: "info", icon: "bell",
          title: n.title,
          meta: n.meta || "LINEには送らずここにお知らせしています",
          route: n.route || "home",
        });
      });

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

  // やることの完了・未完了切り替え(ホーム・やること画面の両方から呼ばれる共通処理)。
  // 完了時は「誰が完了させたか」もメニューの表示名(settings.userName)から記録する
  // (LINEのボタン操作経由の完了はサーバー側に表示名が無いため付かない)
  App.toggleTask = function (task) {
    App.store.update((st) => {
      const t = st.tasks.find((x) => x.id === task.id);
      if (!t) return;
      t.done = !t.done;
      if (t.done) {
        t.doneAt = today();
        if (st.settings.userName) t.doneBy = st.settings.userName;
        else delete t.doneBy;
      } else {
        delete t.doneAt;
        delete t.doneBy;
      }
    });
    const t = App.store.state.tasks.find((x) => x.id === task.id);
    if (t && t.done) App.toast("おつかれさま!1件完了しました");
    // 準備タスク(予定に紐づくやること)の完了は匿名の利用計測にだけ数える(本文は送らない)
    if (t && t.done && t.eventActionType === "preparation" && App.track) {
      App.track("event_action_completed", {});
    }
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
