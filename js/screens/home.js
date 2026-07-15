// ============================================
// ホーム — 「今日の家庭の状態」がひと目で分かる画面
// ============================================
window.App = window.App || {};
App.screens = App.screens || {};

// 予定の詳細シート(ホームの予定タップで開く)。メモの確認と編集への導線を提供する
function openEventDetailSheet(ev) {
  const fam = App.store.state.family;
  const ids = ev.memberIds || [];
  const who =
    fam.length > 0 && fam.every((m) => ids.includes(m.id))
      ? "みんな"
      : ids.map((id) => (App.data.member(id) || {}).name).filter(Boolean).join("・") || "未設定";

  const row = (label, value, multiline) =>
    App.el("div", { class: "field", style: "margin-bottom: var(--spacing-3);" }, [
      App.el("span", { class: "field__label", text: label }),
      App.el("p", { text: value, style: multiline ? "white-space: pre-wrap;" : "" }),
    ]);

  const content = [
    row("日時", `${App.fmtDate(ev.date)} ${ev.time || "終日"}`),
    row("だれの予定", who),
  ];
  if (ev.memo) content.push(row("メモ", ev.memo, true));

  const editBtn = App.el("button", { class: "btn-primary", text: "この予定を編集" });
  content.push(editBtn);

  const s = App.sheet(ev.title, content);
  editBtn.addEventListener("click", () => {
    s.close();
    App.openEventSheet(ev);
  });
}

App.screens.home = {
  title: "ホーム",
  nav: "home",
  greeting: true,

  render(container) {
    const st = App.store.state;

    // ---- はじめに(初回だけの案内カード。閉じると二度と出ない)。
    // 色つき背景+アイコン+大きめの見出しで、他の白いカードに埋もれず目立つようにする ----
    if (!st.settings.introDismissed) {
      container.appendChild(
        App.el("section", { class: "section" }, [
          App.el("div", { class: "card card--lg", style: "position: relative; background: var(--color-primary-light);" }, [
            App.el("button", {
              class: "icon-btn",
              style: "position: absolute; top: var(--spacing-2); right: var(--spacing-2);",
              "aria-label": "この案内を閉じる",
              html: App.icon("x", 18),
              onclick: () => App.store.update((x) => { x.settings.introDismissed = true; }),
            }),
            App.el("p", {
              style: "font-size: var(--text-heading); font-weight: 700; color: var(--color-primary-strong); margin-bottom: var(--spacing-2); padding-right: 32px; display: flex; align-items: center; gap: var(--spacing-2);",
              html: App.icon("sparkle", 20) + "<span>はじめに</span>",
            }),
            App.el("p", {
              style: "font-size: var(--text-body); color: var(--color-text); line-height: var(--line-height);",
              text: "わが家ホームへようこそ。予定・やること・買い物・植物のお世話・メモ日記を、家族みんなで気軽に共有できます。右下の+からいつでも追加でき、変更はもう片方の端末にも自動で届きます。まずは「今日やること」や「買い物リスト」から使ってみてください。",
            }),
          ]),
        ])
      );
    }

    // ---- 1. 今日の予定 ----
    const scheduleSection = App.el("section", { class: "section" }, [
      App.sectionHeader("今日の予定", {
        icon: "calendar",
        actionLabel: "カレンダー",
        onAction: () => App.go("calendar"),
      }),
    ]);
    const events = App.data.todayEvents();
    const scheduleCard = App.el("div", { class: "card card--lg" });
    if (events.length === 0) {
      scheduleCard.appendChild(
        App.emptyState("sun", "今日は登録された予定はありません", "ゆっくり過ごせそうです。")
      );
    } else {
      events.forEach((ev) => {
        // メモ付きの予定には小さなアイコンを添えて「タップで見られる」ことを示す
        const title = App.el("span", { class: "schedule-item__title" }, [
          ev.title,
          ev.memo ? App.el("span", { class: "schedule-item__note-icon", html: App.icon("note", 13) }) : null,
        ]);
        const isAway = ev.kind === "match" && ev.venue === "away";
        const dot = App.el("span", {
          class: "schedule-item__dot" + (isAway ? " schedule-item__dot--away" : ""),
          style: `color: ${App.paletteColor(ev.color || 0).fg};`,
        });
        scheduleCard.appendChild(
          App.el("button", {
            class: "schedule-item",
            style: "width:100%; text-align:left;",
            "aria-label": `「${ev.title}」の詳しい内容を見る`,
            onclick: () => openEventDetailSheet(ev),
          }, [
            dot,
            App.el("span", { class: "schedule-item__time", text: ev.time || "終日" }),
            title,
            App.memberBadges(ev),
          ])
        );
      });
    }
    scheduleSection.appendChild(scheduleCard);
    container.appendChild(scheduleSection);

    // ---- 2. 家族のようす ----
    const familySection = App.el("section", { class: "section" }, [
      App.sectionHeader("家族のようす", {
        icon: "users",
        actionLabel: "くわしく",
        onAction: () => App.go("family"),
      }),
    ]);
    const row = App.el("div", { class: "family-row" });
    st.family.forEach((m) => {
      row.appendChild(
        App.el("button", { class: "family-card", "aria-label": `${m.name}(${m.status})のようすを更新`, onclick: () => App.openStatusSheet(m) }, [
          App.initialAvatar(m.name, m.id),
          App.el("span", { class: "family-card__name", text: m.name }),
          App.el("span", { class: "badge badge--muted", text: m.status }),
        ])
      );
    });
    familySection.appendChild(row);
    container.appendChild(familySection);

    // ---- 3. 今日やること(最大5件) ----
    const tasksSection = App.el("section", { class: "section" }, [
      App.sectionHeader("今日やること", {
        icon: "check",
        actionLabel: "すべて見る",
        onAction: () => App.go("tasks"),
      }),
    ]);
    // 植物のお世話(水やり期限・お手入れ適期)を先頭に自動合流させる
    const todays = [...App.data.plantCareItems(), ...App.data.todayTasks()].slice(0, 5);
    const taskCard = App.el("div", { class: "card card--lg" });
    if (todays.length === 0) {
      taskCard.appendChild(
        App.emptyState("checkCircle", "今日のやることはありません", "追加するか、ゆっくり休みましょう。")
      );
    } else {
      const ul = App.el("ul");
      todays.forEach((t) => {
        if (t.kind) {
          // 植物由来のタスク:チェックで水やり記録/お手入れ完了になる
          ul.appendChild(App.taskItem(t, { onToggle: App.completePlantCareItem, meta: t.meta }));
          return;
        }
        ul.appendChild(
          App.taskItem(t, {
            onToggle: (task) => {
              App.store.update((s) => {
                const x = s.tasks.find((k) => k.id === task.id);
                if (x) x.done = !x.done;
              });
              const x = App.store.state.tasks.find((k) => k.id === t.id);
              if (x && x.done) App.toast("おつかれさま!1件完了しました");
            },
          })
        );
      });
      taskCard.appendChild(ul);
    }
    // 買い物リストは「今日やること」の中の箱として置く(品目はホームを埋めない)
    const shoppingOpen = st.shopping.filter((s) => !s.done);
    const shoppingSub = shoppingOpen.length
      ? `${shoppingOpen.slice(0, 2).map((s) => s.name).join("、")}${shoppingOpen.length > 2 ? " ほか" : ""} 残り${shoppingOpen.length}件`
      : "リストは空です";
    taskCard.appendChild(
      App.el("button", {
        class: "list-row",
        style: "border-top: 1px solid var(--color-divider); margin-top: var(--spacing-1);",
        "aria-label": `買い物リストを開く(${shoppingSub})`,
        onclick: () => App.go("shopping"),
      }, [
        App.el("span", { class: "list-row__icon", style: "background: var(--cat-shopping-bg); color: var(--cat-shopping);", html: App.icon("cart", 18) }),
        App.el("span", { class: "list-row__body" }, [
          App.el("span", { text: "買い物リスト" }),
          App.el("span", { class: "list-row__sub", text: shoppingSub }),
        ]),
        App.el("span", { class: "chevron", html: App.icon("chevron", 16) }),
      ])
    );
    taskCard.appendChild(
      App.el("button", {
        class: "section-header__action",
        style: "margin-top: var(--spacing-2);",
        html: App.icon("plus", 14) + "<span>やることを追加</span>",
        onclick: () => App.openTaskSheet(),
      })
    );
    tasksSection.appendChild(taskCard);
    container.appendChild(tasksSection);

    // ---- 4. クイックアクセス ----
    // 買い物リストは「今日やること」内の箱に移したので、ここでは重複させない
    const plantsDue = App.data.plantsDue();
    const quick = [
      { label: "植物の記録", sub: plantsDue ? `水やり ${plantsDue}鉢` : "みんな元気です", icon: "leaf", cat: "plant", route: "plants" },
      { label: "メモ・日記", sub: "残しておきたいこと", icon: "note", cat: "note", route: "notes" },
      { label: "AIに相談", sub: "気軽にどうぞ", icon: "sparkle", cat: "ai", route: "ai" },
    ];
    const quickSection = App.el("section", { class: "section" }, [
      App.sectionHeader("きろく・そうだん", { icon: "note" }),
    ]);
    const grid = App.el("div", { class: "quick-grid" });
    quick.forEach((q) => {
      grid.appendChild(
        App.el("button", { class: "quick-card", onclick: () => App.go(q.route) }, [
          App.el("span", {
            class: "quick-card__icon",
            style: `background: var(--cat-${q.cat}-bg); color: var(--cat-${q.cat});`,
            html: App.icon(q.icon, 20),
          }),
          App.el("span", {}, [
            App.el("span", { class: "quick-card__label", text: q.label }),
            App.el("span", { class: "quick-card__sub", text: q.sub }),
          ]),
        ])
      );
    });
    quickSection.appendChild(grid);
    container.appendChild(quickSection);
  },
};
