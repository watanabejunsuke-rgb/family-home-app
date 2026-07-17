// ============================================
// メニュー・設定
// ============================================
window.App = window.App || {};
App.screens = App.screens || {};

(function () {
  // 柏レイソルの試合はチームカラー(専用のマスタードイエロー、color:7)で表示する
  const isKashiwaTeam = (name) => (name || "").includes("柏レイソル");

  function openNameSheet() {
    const st = App.store.state;
    const nameInput = App.el("input", { type: "text", value: st.settings.userName, placeholder: "例:パパ" });
    const saveBtn = App.el("button", { class: "btn-primary", text: "保存する" });
    const s = App.sheet("表示名を変更", [App.field("表示名", nameInput), saveBtn]);
    saveBtn.addEventListener("click", () => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); App.toast("表示名を入力してください", "info"); return; }
      s.close();
      App.store.update((x) => { x.settings.userName = name; });
      App.toast("表示名を変更しました");
    });
  }

  // 勝敗(結果)。J.League公式サイトの直接スクレイピングは規約上グレーな面があり見送り、
  // 安全な「試合が終わったらワンタップで手動記録」方式にした
  const RESULT_OPTIONS = [
    { value: "", label: "未定" },
    { value: "win", label: "勝ち" },
    { value: "loss", label: "負け" },
    { value: "draw", label: "引き分け" },
  ];
  // カレンダー画面でも同じ表示に使うため共有(js/screens/calendar.jsから参照)
  const RESULT_BADGE = { win: { text: "○勝ち", cls: "badge--success" }, loss: { text: "●負け", cls: "badge--warning" }, draw: { text: "△引き分け", cls: "badge--muted" } };
  App.MATCH_RESULT_BADGE = RESULT_BADGE;

  // 試合1件の追加・編集シート(実際の日程を手入力で登録)
  function openMatchSheet(team, match) {
    const isEdit = !!match;
    const opponentInput = App.el("input", { type: "text", value: isEdit ? match.opponent : "", placeholder: "例:浦和レッズ" });
    const dateInput = App.el("input", { type: "date", value: isEdit ? match.date : App.date.today() });
    let time = isEdit ? match.time : "14:00";
    const timeField = App.timeField("キックオフ時間", time, (v) => (time = v));
    let venue = isEdit ? match.venue : "home";
    const venueChips = App.chipSelect(
      [{ value: "home", label: "ホーム" }, { value: "away", label: "アウェイ" }],
      venue,
      (v) => (venue = v)
    );
    let result = isEdit ? match.result || "" : "";
    const resultChips = App.chipSelect(RESULT_OPTIONS, result, (v) => (result = v));
    const saveBtn = App.el("button", { class: "btn-primary", text: isEdit ? "変更を保存" : "試合を追加" });
    const content = [
      App.field("対戦相手", opponentInput),
      App.field("日付", dateInput),
      timeField,
      App.el("div", { class: "field" }, [App.el("span", { class: "field__label", text: "ホーム/アウェイ" }), venueChips]),
    ];
    if (isEdit) {
      content.push(App.el("div", { class: "field" }, [App.el("span", { class: "field__label", text: "勝敗(試合後に記録)" }), resultChips]));
    }
    content.push(saveBtn);
    if (isEdit) {
      const del = App.el("button", { class: "btn-danger-text", html: App.icon("trash", 16) + "<span>この試合を削除</span>" });
      del.addEventListener("click", () => {
        App.confirm({
          title: "試合を削除しますか?",
          message: `「${match.title}」を削除します。この操作は取り消せません。`,
          okLabel: "削除する",
          danger: true,
          onOk: () => {
            s.close();
            App.store.update((st2) => {
              st2.events = st2.events.filter((e) => e.id !== match.id);
              // 準備タスクを孤立させない(未完了は削除・完了済みは紐付けだけ外す)
              st2.tasks = (st2.tasks || []).filter((t) => !(t.eventId === match.id && t.eventActionType === "preparation" && !t.done));
              st2.tasks.forEach((t) => { if (t.eventId === match.id) delete t.eventId; });
            });
            App.toast("削除しました", "trash");
          },
        });
      });
      content.push(del);
    }
    const s = App.sheet(isEdit ? "試合を編集" : "試合を追加", content);
    saveBtn.addEventListener("click", () => {
      const opponent = opponentInput.value.trim();
      if (!opponent) { opponentInput.focus(); App.toast("対戦相手を入力してください", "info"); return; }
      s.close();
      const title = `⚽ ${team} vs ${opponent}(${venue === "home" ? "ホーム" : "アウェイ"})`;
      const color = isKashiwaTeam(team) ? 7 : 0;
      App.store.update((st2) => {
        if (isEdit) {
          const e = st2.events.find((x) => x.id === match.id);
          if (e) Object.assign(e, { title, date: dateInput.value, time, opponent, venue, kind: "match", color, result: result || undefined });
        } else {
          st2.events.push({
            id: App.uid(), title, date: dateInput.value, time, opponent, venue, color,
            memberIds: st2.family.map((m) => m.id), kind: "match",
          });
        }
      });
      App.toast(isEdit ? "変更しました" : "試合をカレンダーに追加しました", "calendar");
    });
  }

  // 柏レイソル 2026シーズン(明治安田J1リーグ+ルヴァンカップ)の実際の日程。
  // J.League公式サイト(jleague.jp)より2026-07-14時点で確認・取得。
  // 天皇杯2回戦(8/26)は対戦相手が未定のため含めない。
  // ホーム/アウェイの試合日が「◯日 or ◯日+1」となっているものと、
  // キックオフ時間が「AFCクラブ競技会の抽選会(8/18)後に確定」となっているものはメモに理由を残す。
  const KASHIWA_2026_FIXTURES = [
    { date: "2026-08-08", time: "19:00", opponent: "水戸", venue: "home", memo: "明治安田J1リーグ 第1節" },
    { date: "2026-08-14", time: "19:00", opponent: "東京Ｖ", venue: "away", memo: "明治安田J1リーグ 第2節" },
    { date: "2026-08-21", time: "19:00", opponent: "長崎", venue: "home", memo: "明治安田J1リーグ 第3節" },
    { date: "2026-08-29", time: "18:30", opponent: "清水", venue: "away", memo: "明治安田J1リーグ 第4節" },
    { date: "2026-09-02", time: "19:00", opponent: "Ｃ大阪", venue: "away", memo: "明治安田J1リーグ 第5節" },
    { date: "2026-09-06", time: "19:00", opponent: "横浜FM", venue: "home", memo: "明治安田J1リーグ 第6節" },
    { date: "2026-09-12", time: "", opponent: "京都", venue: "away", memo: "明治安田J1リーグ 第7節(9/12土 or 9/13日。キックオフ時間未定)" },
    { date: "2026-09-20", time: "17:00", opponent: "町田", venue: "away", memo: "明治安田J1リーグ 第8節" },
    { date: "2026-10-03", time: "19:00", opponent: "Ｇ大阪", venue: "home", memo: "ルヴァンカップ4回戦(10/3土 or 10/4日)" },
    { date: "2026-10-09", time: "19:00", opponent: "神戸", venue: "home", memo: "明治安田J1リーグ 第9節" },
    { date: "2026-10-17", time: "", opponent: "名古屋", venue: "home", memo: "明治安田J1リーグ 第10節(10/17土 or 10/18日。キックオフ時間未定・AFC抽選8/18後に確定)" },
    { date: "2026-10-21", time: "19:00", opponent: "FC東京", venue: "away", memo: "明治安田J1リーグ 第11節" },
    { date: "2026-10-24", time: "15:00", opponent: "鹿島", venue: "away", memo: "明治安田J1リーグ 第12節(10/24土 or 10/25日)" },
    { date: "2026-10-31", time: "", opponent: "浦和", venue: "home", memo: "明治安田J1リーグ 第13節(10/31土 or 11/1日。キックオフ時間未定・AFC抽選8/18後に確定)" },
    { date: "2026-11-07", time: "", opponent: "川崎Ｆ", venue: "home", memo: "明治安田J1リーグ 第14節(11/7土 or 11/8日。キックオフ時間未定・AFC抽選8/18後に確定)" },
    { date: "2026-11-20", time: "19:00", opponent: "千葉", venue: "home", memo: "明治安田J1リーグ 第15節" },
    { date: "2026-11-28", time: "", opponent: "広島", venue: "home", memo: "明治安田J1リーグ 第17節(11/28土 or 11/29日。キックオフ時間未定・AFC抽選8/18後に確定)" },
    { date: "2026-12-05", time: "", opponent: "福岡", venue: "home", memo: "明治安田J1リーグ 第18節(12/5土 or 12/6日。キックオフ時間未定・AFC抽選8/18後に確定)" },
    { date: "2026-12-13", time: "14:00", opponent: "岡山", venue: "away", memo: "明治安田J1リーグ 第19節" },
    { date: "2026-12-16", time: "19:00", opponent: "Ｇ大阪", venue: "away", memo: "明治安田J1リーグ 第16節" },
    { date: "2026-12-19", time: "16:00", opponent: "川崎Ｆ", venue: "away", memo: "明治安田J1リーグ 第20節" },
  ];

  // 応援チームの試合予定
  // 実運用では柏レイソルしか使わないため、チーム名を自由入力させず固定にする(v0.14.4)。
  // 正式版ではJリーグ公式日程との自動連携(GAS経由)を予定。今は2026シーズンの
  // 一括登録+試合の手入力(実際の日程、カップ戦等の追加分)に対応。
  const TEAM_NAME = "柏レイソル";

  function openTeamSheet() {
    const st = App.store.state;
    const importBtn = App.el("button", {
      class: "btn-primary",
      html: App.icon("calendar", 18) + `<span>2026シーズンの日程を登録する(${KASHIWA_2026_FIXTURES.length}試合)</span>`,
    });
    const addMatchBtn = App.el("button", {
      class: "btn-secondary",
      style: "margin-top: var(--spacing-3);",
      html: App.icon("plus", 18) + "<span>試合を1件追加(カップ戦など)</span>",
    });

    // 登録済みの試合一覧(kind:"match" イベントを日付順に)
    const upcoming = st.events
      .filter((e) => e.kind === "match")
      .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
    const matchList = App.el("div", { class: "field" });
    if (upcoming.length > 0) {
      matchList.appendChild(App.el("span", { class: "field__label", text: "登録済みの試合" }));
      const listCard = App.el("div", {});
      upcoming.forEach((m) => {
        listCard.appendChild(
          App.el("button", {
            class: "schedule-item",
            style: "width:100%; text-align:left;",
            "aria-label": `${m.title}を編集`,
            onclick: () => { s.close(); openMatchSheet(TEAM_NAME, m); },
          }, [
            App.el("span", { class: "schedule-item__time", text: App.fmtDate(m.date, { weekday: false }) }),
            App.el("span", { class: "schedule-item__title", text: m.title.replace(/^⚽\s*/, "") }),
            m.result && RESULT_BADGE[m.result]
              ? App.el("span", { class: `badge ${RESULT_BADGE[m.result].cls}`, text: RESULT_BADGE[m.result].text })
              : null,
          ])
        );
      });
      matchList.appendChild(listCard);
    }

    const s = App.sheet(`${TEAM_NAME}の試合予定`, [
      App.el("p", {
        style: "font-size: var(--text-sub); color: var(--color-text-secondary); margin-bottom: var(--spacing-4);",
        text: "登録した試合はカレンダーに表示されます。正式版では公式日程との自動連携を予定しています。",
      }),
      importBtn,
      addMatchBtn,
      matchList,
    ]);
    const ensureTeamSaved = () => {
      if (st.settings.favoriteTeam !== TEAM_NAME) {
        App.store.state.settings.favoriteTeam = TEAM_NAME;
        App.store.save();
      }
    };
    importBtn.addEventListener("click", () => {
      ensureTeamSaved();
      s.close();
      App.store.update((st2) => {
        KASHIWA_2026_FIXTURES.forEach((f) => {
          st2.events.push({
            id: App.uid(),
            title: `⚽ ${TEAM_NAME} vs ${f.opponent}(${f.venue === "home" ? "ホーム" : "アウェイ"})`,
            date: f.date,
            time: f.time,
            opponent: f.opponent,
            venue: f.venue,
            memo: f.memo,
            memberIds: st2.family.map((m) => m.id),
            kind: "match",
            color: 7,
          });
        });
      });
      App.toast(`${KASHIWA_2026_FIXTURES.length}試合をカレンダーに登録しました`, "calendar");
    });
    addMatchBtn.addEventListener("click", () => {
      ensureTeamSaved();
      s.close();
      openMatchSheet(TEAM_NAME, null);
    });
  }

  App.screens.menu = {
    title: "メニュー",
    nav: "menu",

    render(container) {
      const st = App.store.state;

      // ---- プロフィール ----
      container.appendChild(
        App.el("section", { class: "section" }, [
          App.el("div", { class: "card card--lg menu-profile" }, [
            App.initialAvatar(st.settings.userName, (st.family.find((f) => f.name === st.settings.userName) || {}).id),
            App.el("div", { style: "flex: 1;" }, [
              App.el("p", { class: "menu-profile__name", text: st.settings.userName }),
              App.el("p", {
                class: "menu-profile__sub",
                text: App.liffState.mode === "liff" ? "LINEと接続中" : "デモモード(LINE未接続)",
              }),
            ]),
            App.el("button", { class: "icon-btn", "aria-label": "表示名を変更", html: App.icon("edit", 18), onclick: openNameSheet }),
          ]),
        ])
      );

      // ---- 機能一覧 ----
      const inboxCount = App.flag("LINE_INBOX") ? App.data.inboxPending().length : 0;
      const links = [
        { label: "家族のようす", icon: "users", cat: "family", route: "family" },
        { label: "お友達・知り合い", icon: "heart", cat: "family", route: "contacts" },
        ...(App.flag("LINE_INBOX")
          ? [{ label: "未整理(LINEから届いたメモ)", icon: "note", cat: "note", route: "inbox", sub: inboxCount ? `${inboxCount}件が整理を待っています` : "いまは何もありません" }]
          : []),
        { label: "買い物リスト", icon: "cart", cat: "shopping", route: "shopping" },
        { label: "植物の記録", icon: "leaf", cat: "plant", route: "plants" },
        { label: "植物図鑑", icon: "leaf", cat: "plant", route: "pedia" },
        { label: "メモ・日記", icon: "note", cat: "note", route: "notes" },
        // デモ版であることが一覧の時点で分かるよう明示(本物のAI相談と誤解されないため)
        { label: "AIに相談", icon: "sparkle", cat: "ai", route: "ai", sub: "デモ版・固定文言での応答です" },
      ];
      const linkCard = App.el("div", { class: "card card--lg" });
      links.forEach((l) => {
        linkCard.appendChild(
          App.el("button", { class: "list-row", onclick: () => App.go(l.route) }, [
            App.el("span", { class: "list-row__icon", style: `background: var(--cat-${l.cat}-bg); color: var(--cat-${l.cat});`, html: App.icon(l.icon, 18) }),
            App.el("span", { class: "list-row__body" }, [
              App.el("span", { text: l.label }),
              l.sub ? App.el("span", { class: "list-row__sub", text: l.sub }) : null,
            ]),
            App.el("span", { class: "chevron", html: App.icon("chevron", 16) }),
          ])
        );
      });
      container.appendChild(App.el("section", { class: "section" }, [App.sectionHeader("きろく・そうだん"), linkCard]));

      // ---- 設定 ----
      const settingsRows = [
        App.el("button", { class: "list-row", onclick: () => App.go("notifSettings") }, [
          App.el("span", { class: "list-row__icon", style: "background: var(--color-primary-light); color: var(--color-primary);", html: App.icon("bell", 18) }),
          App.el("span", { class: "list-row__body" }, [
            App.el("span", { text: "通知・お知らせ" }),
            App.el("span", { class: "list-row__sub", text: "お知らせに出す種類を設定" }),
          ]),
          App.el("span", { class: "chevron", html: App.icon("chevron", 16) }),
        ]),
      ];
      // 家族と共有(バックエンド接続後のみ表示)
      if (App.sync && App.sync.configured()) {
        settingsRows.push(
          App.el("button", { class: "list-row", onclick: () => App.go("householdShare") }, [
            App.el("span", { class: "list-row__icon", style: "background: var(--cat-family-bg); color: var(--cat-family);", html: App.icon("users", 18) }),
            App.el("span", { class: "list-row__body" }, [
              App.el("span", { text: "家族と共有" }),
              App.el("span", { class: "list-row__sub", text: App.sync.hasHousehold() ? "連携中" : "別のスマホと同期する" }),
            ]),
            App.el("span", { class: "chevron", html: App.icon("chevron", 16) }),
          ])
        );
      }
      const settingsCard = App.el("div", { class: "card card--lg" }, [
        ...settingsRows,
        App.el("button", { class: "list-row", onclick: openTeamSheet }, [
          App.el("span", { class: "list-row__icon", style: "background: var(--cat-family-bg); color: var(--cat-family);", html: App.icon("heart", 18) }),
          App.el("span", { class: "list-row__body" }, [
            App.el("span", { text: "応援チームの試合予定" }),
            App.el("span", { class: "list-row__sub", text: st.settings.favoriteTeam ? `${st.settings.favoriteTeam}を応援中` : "タップして試合を登録" }),
          ]),
          App.el("span", { class: "chevron", html: App.icon("chevron", 16) }),
        ]),
        // 初期化は滅多に使わず取り返しがつかないため、メニュー直下に置かず「データ管理」画面の奥に置く
        App.el("button", { class: "list-row", onclick: () => App.go("dataManage") }, [
          App.el("span", { class: "list-row__icon", style: "background: var(--color-divider); color: var(--color-text-secondary);", html: App.icon("settings", 18) }),
          App.el("span", { class: "list-row__body" }, [
            App.el("span", { text: "データ管理" }),
            App.el("span", { class: "list-row__sub", text: "保存データの確認・初期化" }),
          ]),
          App.el("span", { class: "chevron", html: App.icon("chevron", 16) }),
        ]),
      ]);
      container.appendChild(App.el("section", { class: "section" }, [App.sectionHeader("設定"), settingsCard]));

      container.appendChild(
        App.el("p", {
          class: "menu-version",
          text: `${window.APP_CONFIG.APP_NAME} v${window.APP_CONFIG.VERSION}${st.isMockData ? "(サンプルデータ表示中)" : ""}`,
        })
      );
    },
  };

  // ============================================
  // 通知・お知らせ設定 — ホームのベル(お知らせ)に出す種類をオン・オフ
  // 実際のLINEプッシュ配信はバックエンドが要るため正式版で対応(ここは表示制御)
  // ============================================
  App.screens.notifSettings = {
    title: "通知・お知らせ",
    back: true,

    render(container) {
      const st = App.store.state;
      if (!st.settings.notifPrefs) st.settings.notifPrefs = {};
      const prefs = st.settings.notifPrefs;

      // defOn=trueの項目は「未設定ならオン」、falseは「未設定ならオフ」。
      // 新しく増えた通知は、初期値で通知が増えないようすべてdefOn:falseにしてある
      const prefOn = (key, defOn) => (defOn ? prefs[key] !== false : prefs[key] === true);

      const toggleRow = (c) => {
        const isOn = prefOn(c.key, c.defOn !== false);
        const sw = App.el("button", {
          class: "switch",
          role: "switch",
          "aria-checked": String(isOn),
          "aria-label": `${c.label}`,
          onclick: () => {
            App.store.update((x) => {
              if (!x.settings.notifPrefs) x.settings.notifPrefs = {};
              x.settings.notifPrefs[c.key] = !isOn;
            });
            // ホームのベルだけでなく、LINEプッシュにも本人の設定として反映されるようサーバーへ送る
            if (App.sync && App.sync.pushNotifPrefs) App.sync.pushNotifPrefs();
          },
        });
        return App.el("div", { class: "list-row" }, [
          App.el("span", { class: "list-row__icon", style: `background: var(--cat-${c.cat || "calendar"}-bg); color: var(--cat-${c.cat || "calendar"});`, html: App.icon(c.icon || "bell", 18) }),
          App.el("span", { class: "list-row__body" }, [
            App.el("span", { text: c.label }),
            App.el("span", { class: "list-row__sub", text: c.sub }),
          ]),
          sw,
        ]);
      };

      const cats = [
        { key: "event", label: "予定", sub: "今日の予定", icon: "calendar", cat: "calendar", defOn: true },
        { key: "task", label: "やること", sub: "期限切れ・今日まで", icon: "check", cat: "task", defOn: true },
        { key: "plant", label: "植物のお世話", sub: "水やり・お手入れ適期", icon: "leaf", cat: "plant", defOn: true },
        { key: "match", label: "応援チームの試合", sub: "今日・前日のお知らせ", icon: "heart", cat: "family", defOn: true },
      ];
      const card = App.el("div", { class: "card card--lg" });
      cats.forEach((c) => card.appendChild(toggleRow(c)));
      container.appendChild(
        App.el("section", { class: "section" }, [App.sectionHeader("お知らせに出す種類", { icon: "bell" }), card])
      );

      // ---- LINEに届く通知(月200通の無料枠内でやりくりする分) ----
      // フラグが全部OFFのときは従来の画面のまま(このセクションごと出さない)
      const showLineSection = App.flag("LINE_MESSAGE_QUOTA") || App.flag("LINE_INBOX") || App.flag("PRIORITY_LAYER");
      const lineCats = [
        { key: "digest", label: "朝ダイジェスト", sub: "朝に今日の予定・やることを1通", icon: "sun", cat: "calendar", defOn: true },
        { key: "importantOnly", label: "重要日だけ受け取る", sub: "大事な予定がある日だけに絞る", icon: "calendar", cat: "calendar", defOn: false },
        { key: "evening", label: "夜のお知らせ", sub: "明日の準備の見直し", icon: "bell", cat: "note", defOn: false },
        { key: "immediate", label: "すぐのお知らせ", sub: "予定の変更などをその場で", icon: "bell", cat: "calendar", defOn: false },
        { key: "assigned", label: "担当になった時", sub: "自分が担当になったら知らせる", icon: "users", cat: "family", defOn: false },
        { key: "shoppingNotify", label: "買い物のお知らせ", sub: "リストの追加・更新", icon: "cart", cat: "shopping", defOn: false },
        { key: "completionShare", label: "完了の共有", sub: "家族がやることを終えた時", icon: "check", cat: "task", defOn: false },
        { key: "inboxReply", label: "LINE登録時の短い返信", sub: "「買い物:牛乳」等の登録の確認", icon: "note", cat: "note", defOn: false },
        { key: "autoSuppress", label: "上限が近い時は自動でひかえる", sub: "月の無料枠を守るための調整", icon: "settings", cat: "ai", defOn: true },
      ];
      if (showLineSection) {
        const lineCard = App.el("div", { class: "card card--lg" });
        lineCats.forEach((c) => lineCard.appendChild(toggleRow(c)));
        container.appendChild(
          App.el("section", { class: "section" }, [App.sectionHeader("LINEに届く通知", { icon: "send" }), lineCard])
        );
      }

      container.appendChild(
        App.el("section", { class: "section" }, [
          App.el("div", { class: "card card--lg" }, [
            App.el("p", {
              style: "font-size: var(--text-sub); color: var(--color-text-secondary); line-height: var(--line-height);",
              html: showLineSection
                ? "上の設定はこの端末のあなたにだけ効きます(家族それぞれが自分の好みで選べます)。LINEの無料プランは月200通までのため、上限が近づくと優先度の低いお知らせは自動でアプリ内のお知らせに切り替わります。"
                : "オンにした種類が、ホーム右上のベル(お知らせ)と、毎朝届くLINEの通知の両方に反映されます。",
            }),
          ]),
        ])
      );

      // ---- LINE通知の利用状況(世帯の管理者=最初に世帯を作った人だけに表示) ----
      if (App.flag("LINE_MESSAGE_QUOTA") && st.settings.isHouseholdAdmin && App.sync && App.sync.enabled && App.sync.enabled()) {
        const statusBtn = App.el("button", {
          class: "btn-secondary",
          html: App.icon("info", 16) + "<span>今月の利用状況を見る</span>",
        });
        statusBtn.addEventListener("click", async () => {
          statusBtn.setAttribute("disabled", "");
          try {
            const r = await App.sync.call("getQuotaStatus", {});
            const q = r.quota || {};
            const rows = [
              ["今月の送信", `${q.sent || 0}通 / ${q.limit || 200}通`],
              ["残り", `${q.remaining !== undefined ? q.remaining : "-"}通`],
              ["ひかえた通知", `${q.suppressed || 0}件(アプリ内お知らせへ)`],
              ["いちばん多い用途", q.topPurpose ? quotaPurposeLabel(q.topPurpose) : "まだありません"],
              ["リセット", `${q.month || "-"}の月末まで`],
              ["状態", q.level === "critical" ? "上限がとても近いです" : q.level === "warning" ? "上限が近づいています" : "ゆとりがあります"],
            ];
            const card2 = App.el("div", { class: "card card--lg" });
            rows.forEach(([label, value]) => {
              card2.appendChild(
                App.el("div", { class: "list-row", style: "min-height: 44px;" }, [
                  App.el("span", { class: "list-row__body", text: label }),
                  App.el("span", { class: "badge badge--muted", text: value }),
                ])
              );
            });
            const byPurpose = q.byPurpose || {};
            const purposeLines = Object.keys(byPurpose).map((k) => `${quotaPurposeLabel(k)}:${byPurpose[k]}通`);
            App.sheet("今月のLINE通知", [
              card2,
              purposeLines.length
                ? App.el("p", {
                    style: "font-size: var(--text-sub); color: var(--color-text-secondary); margin-top: var(--spacing-3);",
                    text: `用途別:${purposeLines.join(" / ")}`,
                  })
                : null,
            ].filter(Boolean));
          } catch (e) {
            App.toast("利用状況を取得できませんでした。あとでもう一度お試しください。", "info");
          } finally {
            statusBtn.removeAttribute("disabled");
          }
        });
        container.appendChild(
          App.el("section", { class: "section" }, [
            App.sectionHeader("LINE通知の利用状況", { icon: "info" }),
            App.el("div", { class: "card card--lg" }, [
              App.el("p", {
                style: "font-size: var(--text-sub); color: var(--color-text-secondary); margin-bottom: var(--spacing-3);",
                text: "世帯を作った人にだけ表示されます。LINE無料プランの月200通の使いぐあいを確認できます。",
              }),
              statusBtn,
            ]),
          ])
        );
      }
    },
  };

  // クォータの用途キーを日本語表示にする(管理者向け表示専用)
  function quotaPurposeLabel(key) {
    const labels = {
      digest: "朝ダイジェスト",
      reply: "返信",
      immediate: "すぐのお知らせ",
      assigned: "担当のお知らせ",
      evening: "夜のお知らせ",
      completion_share: "完了の共有",
      shopping_update: "買い物",
      plant_minor: "植物",
      important: "重要なお知らせ",
      test: "テスト",
    };
    return labels[key] || key;
  }

  // ============================================
  // データ管理 — 破壊的操作はここの奥に置く(誤操作防止のため
  // 「消える内容の確認」→「チェック」→「最終確認」の三段構え)。
  // 「空にする」= サンプルデータ無しの実運用開始用、「サンプルデータに戻す」= デモ・動作確認用、の2本立て
  // ============================================
  App.screens.dataManage = {
    title: "データ管理",
    back: true,

    render(container) {
      const st = App.store.state;

      // ---- いま保存されているデータ ----
      const counts = [
        { label: "予定", n: st.events.length },
        { label: "やること", n: st.tasks.length },
        { label: "買い物リスト", n: st.shopping.length },
        { label: "植物", n: st.plants.length },
        { label: "メモ・日記", n: st.notes.length },
        { label: "家族", n: st.family.length },
      ];
      const summaryCard = App.el("div", { class: "card card--lg" });
      counts.forEach((c) => {
        summaryCard.appendChild(
          App.el("div", { class: "list-row", style: "min-height: 44px;" }, [
            App.el("span", { class: "list-row__body", text: c.label }),
            App.el("span", { class: "badge badge--muted", text: `${c.n}件` }),
          ])
        );
      });
      container.appendChild(
        App.el("section", { class: "section" }, [
          App.sectionHeader("この端末に保存されているデータ", { icon: "info" }),
          summaryCard,
        ])
      );

      // ---- 空にする(サンプルデータを含めてすべて削除し、まっさらな状態にする) ----
      let agreedClear = false;
      const clearBtn = App.el("button", {
        class: "btn-primary",
        style: "background: var(--color-error); margin-top: var(--spacing-4);",
        text: "空にして始める",
        disabled: "",
      });
      const clearCheckBox = App.el("span", { class: "confirm-check__box", html: App.icon("check", 14) });
      const clearCheckRow = App.el("button", {
        class: "confirm-check",
        "aria-pressed": "false",
        onclick: () => {
          agreedClear = !agreedClear;
          clearCheckRow.setAttribute("aria-pressed", String(agreedClear));
          if (agreedClear) clearBtn.removeAttribute("disabled");
          else clearBtn.setAttribute("disabled", "");
        },
      }, [clearCheckBox, App.el("span", { text: "上のデータがすべて消えることを確認しました" })]);

      const sharing = App.sync && App.sync.hasHousehold && App.sync.hasHousehold();
      clearBtn.addEventListener("click", () => {
        App.confirm({
          title: "空にしますか?",
          message: sharing
            ? "登録されているものをすべて削除して、サンプルデータの無いまっさらな状態にします。共有中のため、家族の端末からも同じデータが消えます。この操作は取り消せません。"
            : "登録されているものをすべて削除して、サンプルデータの無いまっさらな状態にします。この操作は取り消せません。",
          okLabel: "空にする",
          danger: true,
          onOk: () => {
            App.store.clear();
            App.toast("空にしました");
            App.go("home");
          },
        });
      });

      container.appendChild(
        App.el("section", { class: "section" }, [
          App.sectionHeader("空にする", { icon: "trash" }),
          App.el("div", { class: "card card--lg" }, [
            App.el("p", {
              style: "font-size: var(--text-sub); color: var(--color-text-secondary); margin-bottom: var(--spacing-3);",
              text: "サンプルデータを含め、登録されているものをすべて削除して、実際の内容だけをまっさらな状態から入力し直せます。",
            }),
            clearCheckRow,
            clearBtn,
          ]),
        ])
      );

      // ---- 初期化(チェックを入れないとボタンが押せない) ----
      let agreed = false;
      const resetBtn = App.el("button", {
        class: "btn-primary",
        style: "background: var(--color-error); margin-top: var(--spacing-4);",
        text: "データを初期化する",
        disabled: "",
      });
      const checkBox = App.el("span", { class: "confirm-check__box", html: App.icon("check", 14) });
      const checkRow = App.el("button", {
        class: "confirm-check",
        "aria-pressed": "false",
        onclick: () => {
          agreed = !agreed;
          checkRow.setAttribute("aria-pressed", String(agreed));
          if (agreed) resetBtn.removeAttribute("disabled");
          else resetBtn.setAttribute("disabled", "");
        },
      }, [checkBox, App.el("span", { text: "上のデータがすべて消えることを確認しました" })]);

      resetBtn.addEventListener("click", () => {
        App.confirm({
          title: "本当に初期化しますか?",
          message: "すべてのデータを消して、サンプルデータに戻します。この操作は取り消せません。",
          okLabel: "初期化する",
          danger: true,
          onOk: () => {
            App.store.reset();
            App.toast("データを初期化しました");
            App.go("home");
          },
        });
      });

      container.appendChild(
        App.el("section", { class: "section" }, [
          App.sectionHeader("サンプルデータに戻す", { icon: "info" }),
          App.el("div", { class: "card card--lg" }, [
            App.el("p", {
              style: "font-size: var(--text-sub); color: var(--color-text-secondary); margin-bottom: var(--spacing-3);",
              text: "登録した予定・やること・メモなどをすべて消して、最初のお試し用サンプルデータに戻します。人に見せる時や動作確認に使う操作で、普段の利用では上の「空にする」で十分です。",
            }),
            checkRow,
            resetBtn,
          ]),
        ])
      );
    },
  };
})();
