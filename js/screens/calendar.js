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

  // くり返し予定は「ルールを都度計算」ではなく「先の分まで実体の予定を一括作成」方式。
  // できた予定は普通の予定と同じ形なので、既存の表示・編集がそのまま使える。
  // 同じくり返しの回はseriesIdで束ねる(削除時に「この日だけ/すべて」を選べるように)。
  const WD_FULL = ["日", "月", "火", "水", "木", "金", "土"];

  function recurDates(startStr, mode, untilStr) {
    const start = new Date(startStr + "T00:00:00");
    const until = new Date(untilStr + "T00:00:00");
    const dates = [];
    if (mode === "weekly") {
      for (let d = new Date(start); d <= until; d.setDate(d.getDate() + 7)) {
        dates.push(App.date.str(d));
      }
    } else if (mode === "monthly") {
      const day = start.getDate();
      const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cursor <= until) {
        const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
        // 毎月31日など、存在しない月はその月だけスキップする
        if (day <= daysInMonth) {
          const candidate = new Date(cursor.getFullYear(), cursor.getMonth(), day);
          if (candidate >= start && candidate <= until) dates.push(App.date.str(candidate));
        }
        cursor.setMonth(cursor.getMonth() + 1);
      }
    } else if (mode === "yearly") {
      // 誕生日などの登録用。2/29は存在しない年はスキップする
      const month = start.getMonth();
      const day = start.getDate();
      const cursor = new Date(start.getFullYear(), month, 1);
      while (cursor.getFullYear() <= until.getFullYear()) {
        const daysInMonth = new Date(cursor.getFullYear(), month + 1, 0).getDate();
        if (day <= daysInMonth) {
          const candidate = new Date(cursor.getFullYear(), month, day);
          if (candidate >= start && candidate <= until) dates.push(App.date.str(candidate));
        }
        cursor.setFullYear(cursor.getFullYear() + 1);
      }
    }
    return dates;
  }

  // くり返し予定の削除範囲を選ばせる(この日だけ/すべて)
  function confirmDeleteSeries(ev, closeEditSheet) {
    const thisOnlyBtn = App.el("button", { class: "btn-danger-text", text: "この日だけ削除" });
    const allBtn = App.el("button", { class: "btn-danger-text", style: "margin-top: var(--spacing-2);", text: "くり返しをすべて削除" });
    const cancelBtn = App.el("button", { class: "btn-secondary", text: "キャンセル", style: "margin-top: var(--spacing-3);" });
    const s2 = App.sheet("削除する範囲を選んでください", [
      App.el("p", {
        text: `「${ev.title}」はくり返し予定です。`,
        style: "color: var(--color-text-secondary); font-size: var(--text-sub); margin-bottom: var(--spacing-4);",
      }),
      thisOnlyBtn,
      allBtn,
      cancelBtn,
    ]);
    thisOnlyBtn.addEventListener("click", () => {
      s2.close();
      closeEditSheet();
      App.store.update((st) => { st.events = st.events.filter((e) => e.id !== ev.id); });
      App.toast("この日の予定を削除しました", "trash");
    });
    allBtn.addEventListener("click", () => {
      s2.close();
      closeEditSheet();
      App.store.update((st) => { st.events = st.events.filter((e) => e.seriesId !== ev.seriesId); });
      App.toast("くり返しの予定をすべて削除しました", "trash");
    });
    cancelBtn.addEventListener("click", s2.close);
  }

  // ホームの予定詳細シートからも編集できるように公開する(App.openTaskSheetと同じパターン)
  App.openEventSheet = openEventSheet;

  function openEventSheet(ev) {
    const isEdit = !!ev;
    const data = ev
      ? { ...ev, memberIds: [...(ev.memberIds || [])] }
      : { title: "", date: view.selected, time: "", memberIds: App.store.state.family.map((m) => m.id) };

    const titleInput = App.el("input", { type: "text", value: data.title, placeholder: "例:こた めばえ" });
    const dateInput = App.el("input", { type: "date", value: data.date });
    let time = data.time;
    const timeField = App.timeField("時間", time, (v) => (time = v));
    const memberChips = memberSelector(data);

    // 複数日にまたがる予定(夏季休暇など)。endDateがあれば期間扱い
    let recurWrap = null; // くり返しUIのラッパー(このあと!isEditのときだけ生成される)
    let dayMode = data.endDate ? "range" : "single";
    const endDateInput = App.el("input", { type: "date", value: data.endDate || data.date });
    const endDateField = App.field("終了日", endDateInput);
    endDateField.style.display = dayMode === "range" ? "" : "none";
    const dayModeChips = App.chipSelect(
      [{ value: "single", label: "1日だけ" }, { value: "range", label: "複数日にまたがる" }],
      dayMode,
      (v) => {
        dayMode = v;
        endDateField.style.display = v === "range" ? "" : "none";
        if (recurWrap) recurWrap.style.display = v === "range" ? "none" : "";
      }
    );
    // 開始日を変えたら、終了日がそれより前にならないよう追従させる
    dateInput.addEventListener("change", () => {
      if (endDateInput.value < dateInput.value) endDateInput.value = dateInput.value;
    });

    let color = data.color || 0;
    const colorField = App.el("div", { class: "field" }, [
      App.el("span", { class: "field__label", text: "予定の色" }),
      App.colorSwatches(color, (v) => (color = v), { includeStandard: true }),
    ]);

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
      App.el("div", { class: "field" }, [dayModeChips]),
      endDateField,
      timeField,
      App.el("div", { class: "field" }, [
        App.el("span", { class: "field__label", text: "だれの予定?" }),
        memberChips,
      ]),
      colorField,
      memoToggle,
      memoField,
    ];

    // くり返しは新規追加のときだけ選べる(編集は常にその回だけへの変更として扱う)。
    // 複数日にまたがる予定との組み合わせは対象外のため、dayModeChipsでも表示を切り替える
    let recur = "none";
    let recurUntilInput = null;
    if (!isEdit) {
      // 毎年(誕生日など)は「いつまで」をUIで聞かないため、内部で十分先(50年)まで
      // 自動生成しておく。それ以外は1年先を初期値にする
      const defaultUntil = (mode) => {
        const d = new Date(dateInput.value + "T00:00:00");
        d.setFullYear(d.getFullYear() + (mode === "yearly" ? 50 : 1));
        return App.date.str(d);
      };
      recurUntilInput = App.el("input", { type: "date", value: defaultUntil(recur) });
      const recurUntilField = App.field("いつまで", recurUntilInput);
      recurUntilField.style.display = "none";

      const recurLabel = (mode) => {
        const d = new Date(dateInput.value + "T00:00:00");
        if (mode === "weekly") return `毎週${WD_FULL[d.getDay()]}曜日`;
        if (mode === "monthly") return `毎月${d.getDate()}日`;
        if (mode === "yearly") return `毎年${d.getMonth() + 1}月${d.getDate()}日`;
        return "しない";
      };
      const recurChips = App.chipSelect(
        [
          { value: "none", label: "しない" },
          { value: "weekly", label: recurLabel("weekly") },
          { value: "monthly", label: recurLabel("monthly") },
          { value: "yearly", label: recurLabel("yearly") },
        ],
        recur,
        (v) => {
          recur = v;
          // 毎年(誕生日など)は「いつまで」を聞かず、内部で十分先まで自動生成する。
          // 見えない値なので、他モードで手入力した値が残っていても常に上書きする
          recurUntilField.style.display = (v === "none" || v === "yearly") ? "none" : "";
          if (v === "yearly" || !recurUntilInput.dataset.touched) recurUntilInput.value = defaultUntil(v);
        }
      );
      // 日付を変えたら「毎週◯曜日」「毎月◯日」「毎年◯月◯日」の表示も追従させる
      dateInput.addEventListener("change", () => {
        const chipEls = recurChips.querySelectorAll(".chip");
        chipEls[1].textContent = recurLabel("weekly");
        chipEls[2].textContent = recurLabel("monthly");
        chipEls[3].textContent = recurLabel("yearly");
        if (recur === "yearly" || !recurUntilInput.dataset.touched) recurUntilInput.value = defaultUntil(recur);
      });
      recurUntilInput.addEventListener("input", () => { recurUntilInput.dataset.touched = "1"; });

      recurWrap = App.el("div", {}, [
        App.el("div", { class: "field" }, [
          App.el("span", { class: "field__label", text: "くり返し" }),
          recurChips,
        ]),
        recurUntilField,
      ]);
      content.push(recurWrap);
    }

    content.push(saveBtn);

    if (isEdit) {
      const del = App.el("button", { class: "btn-danger-text", html: App.icon("trash", 16) + "<span>この予定を削除</span>" });
      del.addEventListener("click", () => {
        if (ev.seriesId) {
          confirmDeleteSeries(ev, s.close);
          return;
        }
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
      if (!isEdit && recur !== "none" && recurUntilInput.value < dateInput.value) {
        App.toast("「いつまで」は開始日より後にしてください", "info");
        return;
      }
      if (dayMode === "range" && endDateInput.value < dateInput.value) {
        App.toast("終了日は開始日より後にしてください", "info");
        return;
      }
      s.close();
      const memo = memoInput.value.trim();
      const endDate = dayMode === "range" ? endDateInput.value : null;
      App.store.update((st) => {
        if (isEdit) {
          const e = st.events.find((x) => x.id === ev.id);
          if (e) Object.assign(e, { title, date: dateInput.value, endDate, time, memberIds: data.memberIds, memo, color });
        } else if (recur === "none") {
          st.events.push({ id: App.uid(), title, date: dateInput.value, endDate, time, memberIds: data.memberIds, memo, color });
        } else {
          const seriesId = `series-${App.uid()}`;
          recurDates(dateInput.value, recur, recurUntilInput.value).forEach((d) => {
            st.events.push({ id: App.uid(), title, date: d, time, memberIds: data.memberIds, memo, color, seriesId });
          });
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

      // 日付ごとの予定をまとめておく(セルごとに毎回全件走査しない)。
      // endDateがある予定(夏季休暇など複数日にまたがる予定)は、該当する
      // すべての日に登場させる
      const eventsByDate = new Map();
      const addOnDate = (ds, e) => {
        if (!eventsByDate.has(ds)) eventsByDate.set(ds, []);
        eventsByDate.get(ds).push(e);
      };
      App.store.state.events.forEach((e) => {
        if (!e.endDate) { addOnDate(e.date, e); return; }
        for (let d = new Date(e.date + "T00:00:00"); App.date.str(d) <= e.endDate; d.setDate(d.getDate() + 1)) {
          addOnDate(App.date.str(d), e);
        }
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
        // このセルで複数日予定が左/右のどちらかに継続しているか(セル自体の
        // パディングを継ぎ目側だけ詰めて、隣のセルとの隙間を目立たなくする)
        let bridgesLeft = false;
        let bridgesRight = false;
        dayEvents.slice(0, MAX_CHIPS).forEach((e) => {
          const c = App.paletteColor(e.color || 0);
          // 応援チームの試合はホーム/アウェイをひと目で区別:ホーム=塗りつぶし、アウェイ=縁取り
          const isAway = e.kind === "match" && e.venue === "away";
          let style = isAway
            ? `background: transparent; border: 1px solid ${c.fg}; color: ${c.fg};`
            : `background: ${c.bg}; color: ${c.fg};`;
          // 複数日にまたがる予定は、週の中で連続した1本の帯に見えるように
          // 角丸を「その週で見えている範囲の始まり/終わり」だけに絞り、
          // ラベルも帯の先頭にしか出さない(同じ文字が毎日繰り返されて見えるのを防ぐ)
          let label = clipChars(e.title, 4);
          if (e.endDate) {
            const isRunStart = ds === e.date || dow === 1; // 実際の開始日、または週の月曜(継続の折り返し)
            const isRunEnd = ds === e.endDate || dow === 0; // 実際の終了日、または週の日曜
            const leftR = isRunStart ? "4px" : "0";
            const rightR = isRunEnd ? "4px" : "0";
            style += ` border-radius: ${leftR} ${rightR} ${rightR} ${leftR};`;
            if (!isRunStart) { label = " "; bridgesLeft = true; }
            if (!isRunEnd) bridgesRight = true;
          }
          eventsWrap.appendChild(
            App.el("span", { class: "cal-day__chip", style, text: label })
          );
        });

        // 継ぎ目側のセルパディングを0にして隣のセルとの隙間を詰める
        let cellStyle = "";
        if (bridgesLeft) cellStyle += "padding-left: 0;";
        if (bridgesRight) cellStyle += "padding-right: 0;";

        const cell = App.el("button", {
          class: "cal-day" + (inMonth ? "" : " cal-day--other") + (ds === today ? " cal-day--today" : "") + weekendClass,
          style: cellStyle,
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

      // ---- 選択日の予定(常時表示。Yahoo!カレンダーのように上下を同時に見せる)。
      // 予定の追加は、月によって縦に長くなるこの画面ではFAB(固定表示)だと
      // LINEアプリ内ブラウザでスクロール量により位置がずれる不具合があったため、
      // 見出し右側の通常のボタン(常に画面内に流れて表示される)に変更(v0.13.11) ----
      const selectedHoliday = App.holidayName(view.selected);
      const daySectionHeader = App.sectionHeader(`${App.fmtDate(view.selected)}${selectedHoliday ? "・" + selectedHoliday : ""}の予定`, { icon: "calendar" });
      // 「追加」は別画面への遷移ではないため、共通のsectionHeaderの矢印付きアクションは使わず、
      // 他の追加ボタン(やることを追加、等)と同じ「+アイコン+ラベル」の見た目に揃える
      daySectionHeader.appendChild(
        App.el("button", {
          class: "section-header__action",
          html: App.icon("plus", 14) + "<span>予定を追加</span>",
          onclick: () => openEventSheet(null),
        })
      );
      const daySection = App.el("section", { class: "section cal-day-section" }, [daySectionHeader]);
      const selectedEvents = App.data.eventsOn(view.selected);
      const dayCard = App.el("div", { class: "card card--lg cal-day-card" });
      if (selectedEvents.length === 0) {
        dayCard.appendChild(
          App.emptyState("sun", "この日の予定はありません", "上の「予定を追加」から追加できます。")
        );
      } else {
        selectedEvents.forEach((ev) => {
          const avatars = App.memberBadges(ev);
          const titleWrap = App.el("div", { class: "schedule-item__title" }, [
            ev.title,
            ev.memo ? App.el("span", { class: "schedule-item__memo", text: ev.memo }) : null,
          ]);
          const isAway = ev.kind === "match" && ev.venue === "away";
          const dot = App.el("span", {
            class: "schedule-item__dot" + (isAway ? " schedule-item__dot--away" : ""),
            style: `color: ${App.paletteColor(ev.color || 0).fg};`,
          });
          // 複数日にまたがる予定は、時刻の代わりに期間(8/10〜8/18)を表示して
          // 「この日だけの予定ではない」ことが分かるようにする
          const timeLabel = ev.endDate ? `${App.fmtDateShort(ev.date)}〜${App.fmtDateShort(ev.endDate)}` : (ev.time || "終日");
          dayCard.appendChild(
            App.el("button", {
              class: "schedule-item",
              style: "width:100%; text-align:left;",
              "aria-label": `${ev.title}を編集${ev.memo ? "(メモあり)" : ""}`,
              onclick: () => openEventSheet(ev),
            }, [
              dot,
              App.el("span", { class: "schedule-item__time", text: timeLabel }),
              titleWrap,
              avatars,
            ])
          );
        });
      }
      daySection.appendChild(dayCard);
      container.appendChild(daySection);
    },
  };
})();
