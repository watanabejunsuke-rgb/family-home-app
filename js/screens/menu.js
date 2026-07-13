// ============================================
// メニュー・設定
// ============================================
window.App = window.App || {};
App.screens = App.screens || {};

(function () {
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

  // 応援チームの試合予定
  // 正式版ではJリーグ公式日程との自動連携(GAS経由)を予定。
  // 現在はサンプル日程の取り込みでカレンダー登録の流れを確認できる。
  function openTeamSheet() {
    const st = App.store.state;
    const teamInput = App.el("input", { type: "text", value: st.settings.favoriteTeam || "", placeholder: "例:川崎フロンターレ" });
    const saveBtn = App.el("button", { class: "btn-primary", text: "チームを保存" });
    const importBtn = App.el("button", {
      class: "btn-secondary",
      style: "margin-top: var(--spacing-3);",
      html: App.icon("calendar", 18) + "<span>サンプル日程を取り込む(3試合)</span>",
    });
    const s = App.sheet("応援チームの試合予定", [
      App.el("p", {
        style: "font-size: var(--text-sub); color: var(--color-text-secondary); margin-bottom: var(--spacing-4);",
        text: "正式版では公式の試合日程と自動で連携する予定です。いまはサンプル日程で、カレンダーに登録される流れを確認できます。",
      }),
      App.field("応援しているチーム", teamInput),
      saveBtn,
      importBtn,
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
    importBtn.addEventListener("click", () => {
      const team = saveTeam();
      if (!team) return;
      s.close();
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
      const notifSwitch = App.el("button", {
        class: "switch",
        role: "switch",
        "aria-checked": String(st.settings.notifications),
        "aria-label": "通知(準備中)",
        onclick: () => {
          App.store.update((x) => { x.settings.notifications = !x.settings.notifications; });
          App.toast(App.store.state.settings.notifications ? "通知をオンにしました(正式版で有効になります)" : "通知をオフにしました", "bell");
        },
      });
      const settingsCard = App.el("div", { class: "card card--lg" }, [
        App.el("div", { class: "list-row" }, [
          App.el("span", { class: "list-row__icon", style: "background: var(--color-primary-light); color: var(--color-primary);", html: App.icon("bell", 18) }),
          App.el("span", { class: "list-row__body" }, [
            App.el("span", { text: "通知" }),
            App.el("span", { class: "list-row__sub", text: "LINE通知は正式版で対応予定" }),
          ]),
          notifSwitch,
        ]),
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
  // データ管理 — 初期化はここの奥に置く(誤操作防止のため
  // 「消える内容の確認」→「チェック」→「最終確認」の三段構え)
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
          App.sectionHeader("初期化", { icon: "trash" }),
          App.el("div", { class: "card card--lg" }, [
            App.el("p", {
              style: "font-size: var(--text-sub); color: var(--color-text-secondary); margin-bottom: var(--spacing-3);",
              text: "登録した予定・やること・メモなどをすべて消して、最初のサンプルデータに戻します。普段の利用でこの操作が必要になることはありません。",
            }),
            checkRow,
            resetBtn,
          ]),
        ])
      );
    },
  };
})();
