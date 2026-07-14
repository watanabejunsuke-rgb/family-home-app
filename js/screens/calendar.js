// ============================================
// カレンダー — 月表示 + 選択日の予定
// ============================================
window.App = window.App || {};
App.screens = App.screens || {};

(function () {
  // マス内の予定名は「…」で削ると実質2〜3文字しか見えなくなるため、固定文字数で切り落とす。
  // 単純なスプレッド([...text])はコードポイント単位の分割で、性別記号付きの絵文字
  // (👨‍🏊‍♀️ 等、内部は複数コードポイントの結合)を複数文字として数えてしまい、
  // 絵文字だけで4文字分を使い切って後ろの文字が消える不具合になる。
  // Intl.Segmenterで「人が見て1文字に見える単位(書記素)」ごとに数える。
  function clipChars(text, n) {
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map((s) => s.segment);
      return graphemes.length > n ? graphemes.slice(0, n).join("") : text;
    }
    const chars = [...text];
    return chars.length > n ? chars.slice(0, n).join("") : text;
  }

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
    // 「カレンダー」という見出しは下部ナビのタブと重複して冗長なため、
    // 共通ヘッダーは出さず、月ナビ(2026年7月 など)自体を見出しとして扱う
    noHeader: true,

    render(container) {
      ensureView();
      const today = App.date.today();

      // ---- 月ナビゲーション(このページの見出しを兼ねる) ----
      const nav = App.el("div", { class: "cal-nav" }, [
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

      // ---- 月グリッド(月曜始まり) ----
      const grid = App.el("div", { class: "cal-grid card card--lg", role: "grid" });
      ["月", "火", "水", "木", "金", "土", "日"].forEach((w, i) => {
        const cls = i === 5 ? " cal-grid__wd--sat" : i === 6 ? " cal-grid__wd--sun" : "";
        grid.appendChild(App.el("span", { class: "cal-grid__wd" + cls, text: w }));
      });

      // 日付ごとの予定をまとめておく(セルごとに毎回全件走査しない)
      const eventsByDate = new Map();
      App.store.state.events.forEach((e) => {
        if (!eventsByDate.has(e.date)) eventsByDate.set(e.date, []);
        eventsByDate.get(e.date).push(e);
      });

      const first = new Date(view.year, view.month, 1);
      const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
      const offsetToMonday = (first.getDay() + 6) % 7; // 月曜始まりでの1日のズレ
      const totalCells = Math.ceil((offsetToMonday + daysInMonth) / 7) * 7;
      const start = new Date(first);
      start.setDate(1 - offsetToMonday);

      const MAX_CHIPS = 3;
      for (let i = 0; i < totalCells; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const ds = App.date.str(d);
        const inMonth = d.getMonth() === view.month;
        const dow = d.getDay(); // 0=日〜6=土
        const holidayName = App.holidayName(ds);
        const dayEvents = (eventsByDate.get(ds) || []).sort((a, b) => (a.time || "").localeCompare(b.time || ""));

        let weekendClass = "";
        if (dow === 0) weekendClass = " cal-day--sun";
        else if (dow === 6) weekendClass = " cal-day--sat";
        else if (holidayName) weekendClass = " cal-day--holiday";

        // 最大3件まで表示。それ以上は「+n件」を出さず切り捨てる
        // (全件は下の「選択日の予定」パネルで確認できるため)
        const eventsWrap = App.el("div", { class: "cal-day__events" });
        dayEvents.slice(0, MAX_CHIPS).forEach((e) =>
          eventsWrap.appendChild(App.el("span", { class: "cal-day__chip", text: clipChars(e.title, 4) }))
        );

        const cell = App.el("button", {
          class: "cal-day" + (inMonth ? "" : " cal-day--other") + (ds === today ? " cal-day--today" : "") + weekendClass,
          "aria-pressed": String(ds === view.selected),
          "aria-label": `${d.getMonth() + 1}月${d.getDate()}日${holidayName ? "・" + holidayName : ""}${dayEvents.length ? "(予定あり)" : ""}`,
          onclick: () => { view.selected = ds; App.refresh(); },
        }, [
          App.el("span", { class: "cal-day__date", text: String(d.getDate()) }),
          eventsWrap,
        ]);
        grid.appendChild(cell);
      }
      container.appendChild(grid);

      // ---- 選択日の予定(常時表示。Yahoo!カレンダーのように上下を同時に見せる) ----
      const selectedHoliday = App.holidayName(view.selected);
      const daySection = App.el("section", { class: "section cal-day-section" }, [
        App.sectionHeader(`${App.fmtDate(view.selected)}${selectedHoliday ? "・" + selectedHoliday : ""}の予定`, { icon: "calendar" }),
      ]);
      const selectedEvents = App.data.eventsOn(view.selected);
      const dayCard = App.el("div", { class: "card card--lg cal-day-card" });
      if (selectedEvents.length === 0) {
        dayCard.appendChild(
          App.emptyState("sun", "この日の予定はありません", "右下の+から追加できます。")
        );
      } else {
        selectedEvents.forEach((ev) => {
          const avatars = App.memberBadges(ev);
          const titleWrap = App.el("div", { class: "schedule-item__title" }, [
            ev.title,
            ev.memo ? App.el("span", { class: "schedule-item__memo", text: ev.memo }) : null,
          ]);
          dayCard.appendChild(
            App.el("button", {
              class: "schedule-item",
              style: "width:100%; text-align:left;",
              "aria-label": `${ev.title}を編集${ev.memo ? "(メモあり)" : ""}`,
              onclick: () => openEventSheet(ev),
            }, [
              App.el("span", { class: "schedule-item__time", text: ev.time || "終日" }),
              titleWrap,
              avatars,
            ])
          );
        });
      }
      daySection.appendChild(dayCard);
      container.appendChild(daySection);

      container.appendChild(App.fab("予定を追加", () => openEventSheet(null)));
    },
  };
})();
