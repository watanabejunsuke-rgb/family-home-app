// ============================================
// メニュー・設定
// ============================================
window.App = window.App || {};
App.screens = App.screens || {};

(function () {
  // 柏レイソルの試合はチームカラー(黄色系)で表示する。member色1が北欧トーンの
  // アンバー系で近いため流用(カレンダーの色スウォッチと同じパレット)
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
    const saveBtn = App.el("button", { class: "btn-primary", text: isEdit ? "変更を保存" : "試合を追加" });
    const content = [
      App.field("対戦相手", opponentInput),
      App.field("日付", dateInput),
      timeField,
      App.el("div", { class: "field" }, [App.el("span", { class: "field__label", text: "ホーム/アウェイ" }), venueChips]),
      saveBtn,
    ];
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
            App.store.update((st2) => { st2.events = st2.events.filter((e) => e.id !== match.id); });
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
          if (e) Object.assign(e, { title, date: dateInput.value, time, opponent, venue, kind: "match", color });
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
  // 正式版ではJリーグ公式日程との自動連携(GAS経由)を予定。
  // 今はチーム名の保存+試合の手入力(実際の日程)。柏レイソルのみ公式日程の一括登録に対応。
  function openTeamSheet() {
    const st = App.store.state;
    const teamInput = App.el("input", { type: "text", value: st.settings.favoriteTeam || "", placeholder: "例:川崎フロンターレ" });
    const saveBtn = App.el("button", { class: "btn-primary", text: "チームを保存" });
    const addMatchBtn = App.el("button", {
      class: "btn-secondary",
      style: "margin-top: var(--spacing-3);",
      html: App.icon("plus", 18) + "<span>試合を追加(実際の日程)</span>",
    });
    const importBtn = App.el("button", {
      class: "section-header__action",
      style: "margin-top: var(--spacing-3);",
    });
    const syncImportLabel = () => {
      importBtn.innerHTML = isKashiwaTeam(teamInput.value)
        ? App.icon("calendar", 14) + `<span>柏レイソルの2026シーズン日程を登録する(${KASHIWA_2026_FIXTURES.length}試合)</span>`
        : App.icon("calendar", 14) + "<span>お試し用のサンプル日程を取り込む(3試合)</span>";
    };
    teamInput.addEventListener("input", syncImportLabel);
    syncImportLabel();

    // 登録済みの試合一覧(このチームの kind:"match" イベントを日付順に)
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
            onclick: () => { s.close(); openMatchSheet(st.settings.favoriteTeam || "応援チーム", m); },
          }, [
            App.el("span", { class: "schedule-item__time", text: App.fmtDate(m.date, { weekday: false }) }),
            App.el("span", { class: "schedule-item__title", text: m.title.replace(/^⚽\s*/, "") }),
          ])
        );
      });
      matchList.appendChild(listCard);
    }

    const s = App.sheet("応援チームの試合予定", [
      App.el("p", {
        style: "font-size: var(--text-sub); color: var(--color-text-secondary); margin-bottom: var(--spacing-4);",
        text: "対戦相手・日時を入力すると、その試合がカレンダーに登録されます。正式版では公式日程との自動連携を予定しています。",
      }),
      App.field("応援しているチーム", teamInput),
      saveBtn,
      addMatchBtn,
      importBtn,
      matchList,
    ]);
    const saveTeam = () => {
      const team = teamInput.value.trim();
      if (!team) { teamInput.focus(); App.toast("チーム名を入力してください", "info"); return null; }
      App.store.state.settings.favoriteTeam = team;
      App.store.save();
      return team;
    };
    saveBtn.addEventListener("click", () => {
      const team = saveTeam();
      if (!team) return;
      s.close();
      App.refresh();
      App.toast(`応援チームを「${team}」にしました`, "heart");
    });
    addMatchBtn.addEventListener("click", () => {
      const team = saveTeam();
      if (!team) return;
      s.close();
      openMatchSheet(team, null);
    });
    importBtn.addEventListener("click", () => {
      const team = saveTeam();
      if (!team) return;
      s.close();
      if (isKashiwaTeam(team)) {
        App.store.update((st2) => {
          KASHIWA_2026_FIXTURES.forEach((f) => {
            st2.events.push({
              id: App.uid(),
              title: `⚽ ${team} vs ${f.opponent}(${f.venue === "home" ? "ホーム" : "アウェイ"})`,
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
        return;
      }
      const fixtures = [
        { days: 6, time: "14:00", note: "ホーム" },
        { days: 13, time: "19:00", note: "アウェイ" },
        { days: 27, time: "15:00", note: "ホーム" },
      ];
      App.store.update((st2) => {
        fixtures.forEach((f) => {
          st2.events.push({
            id: App.uid(),
            title: `⚽ ${team} 観戦(${f.note}・サンプル日程)`,
            date: App.date.daysAhead(f.days),
            time: f.time,
            memberIds: st2.family.map((m) => m.id),
            kind: "match",
          });
        });
      });
      App.toast("サンプル日程3試合をカレンダーに追加しました", "calendar");
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
      const links = [
        { label: "家族のようす", icon: "users", cat: "family", route: "family" },
        { label: "買い物リスト", icon: "cart", cat: "shopping", route: "shopping" },
        { label: "植物の記録", icon: "leaf", cat: "plant", route: "plants" },
        { label: "メモ・日記", icon: "note", cat: "note", route: "notes" },
        { label: "AIに相談", icon: "sparkle", cat: "ai", route: "ai" },
      ];
      const linkCard = App.el("div", { class: "card card--lg" });
      links.forEach((l) => {
        linkCard.appendChild(
          App.el("button", { class: "list-row", onclick: () => App.go(l.route) }, [
            App.el("span", { class: "list-row__icon", style: `background: var(--cat-${l.cat}-bg); color: var(--cat-${l.cat});`, html: App.icon(l.icon, 18) }),
            App.el("span", { class: "list-row__body", text: l.label }),
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
            App.el("span", { class: "list-row__sub", text: st.settings.favoriteTeam ? `${st.settings.favoriteTeam}を応援中` : "チーム未設定(サンプル日程で試せます)" }),
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

      const cats = [
        { key: "event", label: "予定", sub: "今日の予定", icon: "calendar", cat: "calendar" },
        { key: "task", label: "やること", sub: "期限切れ・今日まで", icon: "check", cat: "task" },
        { key: "plant", label: "植物のお世話", sub: "水やり・お手入れ適期", icon: "leaf", cat: "plant" },
        { key: "match", label: "応援チームの試合", sub: "今日・前日のお知らせ", icon: "heart", cat: "family" },
      ];

      const card = App.el("div", { class: "card card--lg" });
      cats.forEach((c) => {
        const isOn = prefs[c.key] !== false;
        const sw = App.el("button", {
          class: "switch",
          role: "switch",
          "aria-checked": String(isOn),
          "aria-label": `${c.label}のお知らせ`,
          onclick: () => {
            App.store.update((x) => {
              if (!x.settings.notifPrefs) x.settings.notifPrefs = {};
              x.settings.notifPrefs[c.key] = x.settings.notifPrefs[c.key] === false;
            });
          },
        });
        card.appendChild(
          App.el("div", { class: "list-row" }, [
            App.el("span", { class: "list-row__icon", style: `background: var(--cat-${c.cat}-bg); color: var(--cat-${c.cat});`, html: App.icon(c.icon, 18) }),
            App.el("span", { class: "list-row__body" }, [
              App.el("span", { text: c.label }),
              App.el("span", { class: "list-row__sub", text: c.sub }),
            ]),
            sw,
          ])
        );
      });

      container.appendChild(
        App.el("section", { class: "section" }, [App.sectionHeader("お知らせに出す種類", { icon: "bell" }), card])
      );
      container.appendChild(
        App.el("section", { class: "section" }, [
          App.el("div", { class: "card card--lg" }, [
            App.el("p", {
              style: "font-size: var(--text-sub); color: var(--color-text-secondary); line-height: var(--line-height);",
              html: "オンにした種類が、ホーム右上のベル(お知らせ)に表示されます。<br>LINEへのプッシュ通知は正式版で対応予定です。",
            }),
          ]),
        ])
      );
    },
  };

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
