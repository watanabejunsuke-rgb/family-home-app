// ============================================
// カレンダー — 月表示 + 選択日の予定
// ============================================
window.App = window.App || {};
App.screens = App.screens || {};

(function () {
  // 画面をまたいで保持する表示状態
  const view = {
    year: null,
    month: null, // 0始まり
    selected: null,
  };

  function ensureView() {
    if (view.selected) return;
    const t = new Date();
    view.year = t.getFullYear();
    view.month = t.getMonth();
    view.selected = App.date.today();
  }

  // 「みんな」は全選択の一括操作、個別メンバーは選択の粒度が異なるため段を分けて表示する。
  // 家族の予定が基本なので全員選択を既定にする。
  function memberSelector(data) {
    const fam = App.store.state.family;
    const allChip = App.el("button", {
      class: "member-selector__all",
      type: "button",
      html: App.icon("users", 18) + "<span>みんな(全員)</span>",
    });
    const row = App.el("div", { class: "chip-row", role: "group" });
    const memberChips = [];
    const sync = () => {
      const allSelected = fam.length > 0 && fam.every((m) => data.memberIds.includes(m.id));
      allChip.setAttribute("aria-pressed", String(allSelected));
      memberChips.forEach((c, i) => c.setAttribute("aria-pressed", String(data.memberIds.includes(fam[i].id))));
    };
    allChip.addEventListener("click", () => {
      const allSelected = fam.every((m) => data.memberIds.includes(m.id));
      data.memberIds = allSelected ? [] : fam.map((m) => m.id);
      sync();
    });
    fam.forEach((m) => {
      const c = App.el("button", { class: "chip", type: "button", text: m.name });
      c.addEventListener("click", () => {
        data.memberIds = data.memberIds.includes(m.id)
          ? data.memberIds.filter((x) => x !== m.id)
          : [...data.memberIds, m.id];
        sync();
      });
      memberChips.push(c);
      row.appendChild(c);
    });
    sync();
    return App.el("div", { class: "member-selector" }, [
      allChip,
      App.el("span", { class: "member-selector__divider", text: "個別にえらぶ" }),
      row,
    ]);
  }

  // ホームの予定詳細シートからも編集できるように公開する(App.openTaskSheetと同じパターン)
  App.openEventSheet = openEventSheet;

  function openEventSheet(ev) {
    const isEdit = !!ev;
    const data = ev
      ? { ...ev, memberIds: [...(ev.memberIds || [])] }
      : { title: "", date: view.selected, time: "", memberIds: App.store.state.family.map((m) => m.id) };

    const titleInput = App.el("input", { type: "text", value: data.title, placeholder: "例:はると スイミング" });
    const dateInput = App.el("input", { type: "date", value: data.date });
    let time = data.time;
    const timeField = App.timeField("時間", time, (v) => (time = v));
    const memberChips = memberSelector(data);

    // メモは毎回必要なわけではないので、既に内容がある時だけ最初から開き、
    // 無ければ「メモを追加」を押した時だけ出す(常時表示にして画面を圧迫しない)
    const memoInput = App.el("textarea", { style: "min-height: 64px;", placeholder: "持ち物・場所など、忘れたくないことがあれば。" });
    if (data.memo) memoInput.value = data.memo;
    const memoField = App.field("メモ", memoInput);
    const memoToggle = App.el("button", {
      class: "section-header__action",
      html: App.icon("plus", 14) + "<span>メモを追加</span>",
    });
    memoField.style.display = data.memo ? "" : "none";
    memoToggle.style.display = data.memo ? "none" : "";
    memoToggle.addEventListener("click", () => {
      memoToggle.style.display = "none";
      memoField.style.display = "";
      memoInput.focus();
    });

    const saveBtn = App.el("button", { class: "btn-primary", text: isEdit ? "変更を保存" : "予定を追加" });
    const content = [
      App.field("予定の名前", titleInput),
      App.field("日付", dateInput),
      timeField,
      App.el("div", { class: "field" }, [
        App.el("span", { class: "field__label", text: "だれの予定?" }),
        memberChips,
      ]),
      memoToggle,
      memoField,
      saveBtn,
    ];
    if (isEdit) {
      const del = App.el("button", { class: "btn-danger-text", html: App.icon("trash", 16) + "<span>この予定を削除</span>" });
      del.addEventListener("click", () => {
        App.confirm({
          title: "予定を削除しますか?",
          message: `「${ev.title}」を削除します。この操作は取り消せません。`,
          okLabel: "削除する",
          danger: true,
          onOk: () => {
            s.close();
            App.store.update((st) => {
              st.events = st.events.filter((e) => e.id !== ev.id);
            });
            App.toast("予定を削除しました", "trash");
          },
        });
      });
      content.push(del);
    }

    const s = App.sheet(isEdit ? "予定を編集" : "予定を追加", content);
    saveBtn.addEventListener("click", () => {
      const title = titleInput.value.trim();
      if (!title) {
        titleInput.focus();
        App.toast("予定の名前を入力してください", "info");
        return;
      }
      s.close();
      App.store.update((st) => {
        const memo = memoInput.value.trim();
        if (isEdit) {
          const e = st.events.find((x) => x.id === ev.id);
          if (e) Object.assign(e, { title, date: dateInput.value, time, memberIds: data.memberIds, memo });
        } else {
          st.events.push({ id: App.uid(), title, date: dateInput.value, time, memberIds: data.memberIds, memo });
        }
      });
      view.selected = dateInput.value;
      App.toast(isEdit ? "予定を変更しました" : "予定を追加しました");
    });
  }

  App.screens.calendar = {
    title: "カレンダー",
    nav: "calendar",

    render(container) {
      ensureView();
      const today = App.date.today();

      // ---- 月ナビゲーション ----
      const nav = App.el("div", { class: "cal-nav section" }, [
        App.el("button", {
          class: "icon-btn", "aria-label": "前の月",
          html: App.icon("back", 20),
          onclick: () => {
            view.month--;
            if (view.month < 0) { view.month = 11; view.year--; }
            App.refresh();
          },
        }),
        App.el("span", { class: "cal-nav__label", text: `${view.year}年${view.month + 1}月` }),
        App.el("button", {
          class: "icon-btn", "aria-label": "次の月",
          html: App.icon("chevron", 20),
          onclick: () => {
            view.month++;
            if (view.month > 11) { view.month = 0; view.year++; }
            App.refresh();
          },
        }),
      ]);
      container.appendChild(nav);

      // ---- 月グリッド ----
      const grid = App.el("div", { class: "cal-grid card card--lg", role: "grid" });
      ["日", "月", "火", "水", "木", "金", "土"].forEach((w) =>
        grid.appendChild(App.el("span", { class: "cal-grid__wd", text: w }))
      );
      const first = new Date(view.year, view.month, 1);
      const start = new Date(first);
      start.setDate(1 - first.getDay());
      for (let i = 0; i < 42; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const ds = App.date.str(d);
        const inMonth = d.getMonth() === view.month;
        const hasEvents = App.store.state.events.some((e) => e.date === ds);
        const cell = App.el("button", {
          class: "cal-day" + (inMonth ? "" : " cal-day--other") + (ds === today ? " cal-day--today" : ""),
          "aria-pressed": String(ds === view.selected),
          "aria-label": `${d.getMonth() + 1}月${d.getDate()}日${hasEvents ? "(予定あり)" : ""}`,
          onclick: () => { view.selected = ds; App.refresh(); },
        }, [
          App.el("span", { text: String(d.getDate()) }),
          hasEvents ? App.el("span", { class: "cal-day__dot" }) : null,
        ]);
        grid.appendChild(cell);
      }
      container.appendChild(grid);

      // ---- 選択日の予定 ----
      const daySection = App.el("section", { class: "section" }, [
        App.sectionHeader(`${App.fmtDate(view.selected)}の予定`, { icon: "calendar" }),
      ]);
      const events = App.data.eventsOn(view.selected);
      const card = App.el("div", { class: "card card--lg" });
      if (events.length === 0) {
        card.appendChild(
          App.emptyState("sun", "この日の予定はありません", "右下の+から追加できます。")
        );
      } else {
        events.forEach((ev) => {
          const avatars = App.memberBadges(ev);
          const titleWrap = App.el("div", { class: "schedule-item__title" }, [
            ev.title,
            ev.memo ? App.el("span", { class: "schedule-item__memo", text: ev.memo }) : null,
          ]);
          const rowEl = App.el("button", {
            class: "schedule-item",
            style: "width:100%; text-align:left;",
            "aria-label": `${ev.title}を編集${ev.memo ? "(メモあり)" : ""}`,
            onclick: () => openEventSheet(ev),
          }, [
            App.el("span", { class: "schedule-item__time", text: ev.time || "終日" }),
            titleWrap,
            avatars,
          ]);
          card.appendChild(rowEl);
        });
      }
      daySection.appendChild(card);
      container.appendChild(daySection);

      container.appendChild(App.fab("予定を追加", () => openEventSheet(null)));
    },
  };
})();
