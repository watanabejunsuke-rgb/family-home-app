// ============================================
// 共通UIビルダー — カード・シート・トースト・フォーム部品
// ============================================
window.App = window.App || {};

(function () {
  // ---- DOM生成ヘルパー ----
  App.el = function (tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on") && typeof v === "function")
        node.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) node.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
      if (c === null || c === undefined) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  };

  // ---- 日付表示 ----
  const WD = ["日", "月", "火", "水", "木", "金", "土"];
  App.fmtDate = function (dateStr, { weekday = true } = {}) {
    const d = new Date(dateStr + "T00:00:00");
    if (isNaN(d)) return dateStr;
    const base = `${d.getMonth() + 1}月${d.getDate()}日`;
    return weekday ? `${base}(${WD[d.getDay()]})` : base;
  };
  App.weekdayOf = (dateStr) => WD[new Date(dateStr + "T00:00:00").getDay()];

  // ---- 時間帯あいさつ ----
  App.greeting = function () {
    const h = new Date().getHours();
    if (h < 4) return { hello: "こんばんは", sub: "夜ふかしの日もありますよね。" };
    if (h < 11) return { hello: "おはようございます", sub: "今日も無理せず、一日ずつ。" };
    if (h < 17) return { hello: "こんにちは", sub: "ひと息つきながらいきましょう。" };
    return { hello: "こんばんは", sub: "今日もおつかれさまでした。" };
  };

  // ---- セクションヘッダー ----
  App.sectionHeader = function (title, { icon, actionLabel, onAction } = {}) {
    const h = App.el("div", { class: "section-header" }, [
      App.el("h2", { class: "section-header__title", html: (icon ? App.icon(icon, 18) : "") + `<span>${title}</span>` }),
    ]);
    if (actionLabel) {
      h.appendChild(
        App.el("button", {
          class: "section-header__action",
          html: `${actionLabel}${App.icon("chevron", 14)}`,
          onclick: onAction,
        })
      );
    }
    return h;
  };

  // ---- 空状態 ----
  App.emptyState = function (icon, title, sub) {
    return App.el("div", { class: "empty-state appear" }, [
      App.el("div", { html: App.icon(icon, 24) }),
      App.el("p", { class: "empty-state__title", text: title }),
      sub ? App.el("p", { class: "empty-state__sub", text: sub }) : null,
    ]);
  };

  // ---- トースト ----
  App.toast = function (message, icon = "checkCircle") {
    const root = document.getElementById("toast-root");
    const t = App.el("div", { class: "toast", html: App.icon(icon, 18) + `<span></span>` });
    t.querySelector("span:last-child").textContent = message;
    root.appendChild(t);
    setTimeout(() => {
      t.classList.add("leaving");
      setTimeout(() => t.remove(), 300);
    }, 2200);
  };

  // ---- Bottom Sheet ----
  App.sheet = function (title, contentNodes) {
    const root = document.getElementById("overlay-root");
    const sheet = App.el("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title, tabindex: "-1" }, [
      App.el("div", { class: "sheet__grip" }),
      App.el("h2", { class: "sheet__title", text: title }),
      ...[].concat(contentNodes),
    ]);
    const overlay = App.el("div", { class: "overlay" }, [sheet]);
    const close = () => {
      overlay.classList.add("closing");
      setTimeout(() => overlay.remove(), 260);
    };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") {
        close();
        document.removeEventListener("keydown", esc);
      }
    });
    root.appendChild(overlay);
    // 入力欄に自動フォーカスするとiPhoneでキーボードが即開き、
    // シート先頭(タイトル)が見えないまま入力欄へ強制スクロールされてしまうため、
    // フォーカスはシート自体に留める(キーボードは出さない)
    sheet.focus();
    return { close, node: sheet };
  };

  // ---- 確認ダイアログ(Bottom Sheet型) ----
  App.confirm = function ({ title, message, okLabel = "OK", danger = false, onOk }) {
    const okBtn = App.el("button", {
      class: "btn-primary",
      text: okLabel,
      style: danger ? "background: var(--color-error);" : "",
    });
    const cancelBtn = App.el("button", {
      class: "btn-secondary",
      text: "キャンセル",
      style: "margin-top: var(--spacing-3);",
    });
    const s = App.sheet(title, [
      App.el("p", { text: message, style: "color: var(--color-text-secondary); font-size: var(--text-sub);" }),
      okBtn,
      cancelBtn,
    ]);
    okBtn.addEventListener("click", () => {
      s.close();
      onOk && onOk();
    });
    cancelBtn.addEventListener("click", s.close);
  };

  // ---- フォーム部品 ----
  App.field = function (labelText, inputEl) {
    const id = App.uid();
    inputEl.id = id;
    return App.el("div", { class: "field" }, [
      App.el("label", { class: "field__label", for: id, text: labelText }),
      inputEl,
    ]);
  };

  App.chipSelect = function (options, selected, onChange, { multi = false } = {}) {
    const state = new Set([].concat(selected).filter(Boolean));
    const row = App.el("div", { class: "chip-row", role: "group" });
    options.forEach((opt) => {
      const value = opt.value !== undefined ? opt.value : opt;
      const label = opt.label !== undefined ? opt.label : opt;
      const chip = App.el("button", {
        class: "chip",
        type: "button",
        text: label,
        "aria-pressed": String(state.has(value)),
      });
      chip.addEventListener("click", () => {
        if (multi) {
          state.has(value) ? state.delete(value) : state.add(value);
        } else {
          state.clear();
          state.add(value);
        }
        row.querySelectorAll(".chip").forEach((c, i) => {
          const v = options[i].value !== undefined ? options[i].value : options[i];
          c.setAttribute("aria-pressed", String(state.has(v)));
        });
        onChange(multi ? [...state] : [...state][0]);
      });
      row.appendChild(chip);
    });
    return row;
  };

  // ---- 時間選択(ブラウザネイティブの time input は見た目を制御できず浮いて見えるため、
  //      Bottom Sheet型の自作ピッカーに置き換える) ----
  App.timeField = function (labelText, initialValue, onChange) {
    let value = initialValue || "";
    const trigger = App.el("button", {
      type: "button",
      class: "time-trigger",
      html: App.icon("clock", 18) + `<span class="time-trigger__label">${value || "終日"}</span>`,
    });
    trigger.addEventListener("click", () => openTimePickerSheet(value, (v) => {
      value = v;
      trigger.querySelector(".time-trigger__label").textContent = value || "終日";
      onChange(value);
    }));
    return App.el("div", { class: "field" }, [
      App.el("span", { class: "field__label", text: labelText }),
      trigger,
    ]);
  };

  function openTimePickerSheet(current, onPick) {
    const [ch, cm] = current ? current.split(":") : ["", ""];
    let h = ch || null;
    let m = cm || null;

    const hourCol = App.el("div", { class: "time-picker__col", role: "listbox", "aria-label": "時" });
    const minuteCol = App.el("div", { class: "time-picker__col", role: "listbox", "aria-label": "分" });
    const hourBtns = [];
    const minuteBtns = [];
    for (let i = 0; i < 24; i++) {
      const v = String(i).padStart(2, "0");
      const b = App.el("button", { type: "button", class: "time-picker__item", text: v, "aria-pressed": String(v === h) });
      // 時だけ選んで決定した時に終日扱いになるのは不親切なので、分が未選択なら「00」を自動選択する
      b.addEventListener("click", () => { h = v; if (m === null) m = "00"; syncPressed(); });
      hourBtns.push(b);
      hourCol.appendChild(b);
    }
    for (let i = 0; i < 60; i += 5) {
      const v = String(i).padStart(2, "0");
      const b = App.el("button", { type: "button", class: "time-picker__item", text: v, "aria-pressed": String(v === m) });
      b.addEventListener("click", () => { m = v; syncPressed(); });
      minuteBtns.push(b);
      minuteCol.appendChild(b);
    }
    const syncPressed = () => {
      hourBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.textContent === h)));
      minuteBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.textContent === m)));
    };

    // 押した瞬間に「終日」で確定して閉じる(すでに終日でも閉じる反応を返す)
    const clearBtn = App.el("button", {
      type: "button",
      class: "section-header__action",
      html: App.icon("x", 14) + "<span>終日にする</span>",
    });
    clearBtn.addEventListener("click", () => {
      s.close();
      onPick("");
    });

    const okBtn = App.el("button", { class: "btn-primary", text: "決定" });
    const s = App.sheet("時間を選ぶ", [
      App.el("div", { class: "time-picker" }, [hourCol, App.el("span", { class: "time-picker__colon", text: ":" }), minuteCol]),
      clearBtn,
      okBtn,
    ]);
    okBtn.addEventListener("click", () => {
      // 分だけ選ばれている場合は勝手に終日にせず、時を選ぶよう案内して開いたままにする
      if (m !== null && h === null) {
        App.toast("何時にするかも選んでください", "info");
        return;
      }
      s.close();
      onPick(h !== null && m !== null ? `${h}:${m}` : "");
    });

    // 現在値を中央付近にスクロール表示
    const scrollToSelected = (col, btns, val, fallbackIndex) => {
      const idx = val ? btns.findIndex((b) => b.textContent === val) : fallbackIndex;
      const target = btns[idx >= 0 ? idx : fallbackIndex];
      if (target) target.scrollIntoView({ block: "center" });
    };
    scrollToSelected(hourCol, hourBtns, h, 8);
    scrollToSelected(minuteCol, minuteBtns, m, 0);
  }

  // ---- タスク行(チェックアニメーション付き) ----
  App.taskItem = function (task, { onToggle, onEdit, meta } = {}) {
    const li = App.el("li", { class: "task-item" + (task.done ? " is-done" : "") });
    const check = App.el("button", {
      class: "task-item__check",
      "aria-label": task.done ? `「${task.title}」を未完了に戻す` : `「${task.title}」を完了にする`,
      html: `<span class="task-item__box">${App.icon("check", 16)}</span>`,
    });
    check.addEventListener("click", () => {
      li.classList.toggle("is-done");
      // アニメーションを見せてからデータ更新
      setTimeout(() => onToggle && onToggle(task), 250);
    });
    li.appendChild(check);
    const body = App.el("div", { class: "task-item__body" }, [
      App.el("p", { class: "task-item__title", text: task.title }),
      meta ? App.el("p", { class: "task-item__meta", text: meta }) : null,
    ]);
    li.appendChild(body);
    if (onEdit) {
      li.appendChild(
        App.el("button", {
          class: "icon-btn task-item__edit",
          "aria-label": `「${task.title}」を編集`,
          html: App.icon("edit", 18),
          onclick: () => onEdit(task),
        })
      );
    }
    return li;
  };

  // ---- 予定のメンバー表示(全員なら「みんな」バッジ、一部なら頭文字バッジ) ----
  // 絵文字アバターは小さいと色味が似て判別しづらいため、名前の頭文字+メンバー別の色で表す
  // 本人が選んだ色(member.color: 1〜6)があればそれを使い、無ければ並び順から自動割り当て
  App.memberColor = function (memberId) {
    const fam = App.store.state.family;
    const i = fam.findIndex((f) => f.id === memberId);
    if (i < 0) return { fg: "var(--member-1)", bg: "var(--member-1-bg)" };
    const n = fam[i].color || (i % 6) + 1;
    return { fg: `var(--member-${n})`, bg: `var(--member-${n}-bg)` };
  };
  // 頭文字アバター(大)。memberIdを渡すとメンバー色、無ければプライマリ系の色になる
  App.initialAvatar = function (name, memberId) {
    const c = memberId ? App.memberColor(memberId) : { fg: "var(--color-primary)", bg: "var(--color-primary-light)" };
    return App.el("span", {
      class: "avatar avatar--initial",
      style: `background: ${c.bg}; color: ${c.fg};`,
      text: (name || "?").charAt(0),
    });
  };
  App.memberBadges = function (ev) {
    const fam = App.store.state.family;
    const ids = ev.memberIds || [];
    if (fam.length > 0 && fam.every((m) => ids.includes(m.id))) {
      return App.el("span", { class: "badge", text: "みんな" });
    }
    const stack = App.el("div", { class: "avatar-stack" });
    ids.forEach((id) => {
      const m = App.data.member(id);
      if (!m) return;
      const c = App.memberColor(id);
      stack.appendChild(
        App.el("span", {
          class: "avatar avatar--sm avatar--initial",
          style: `background: ${c.bg}; color: ${c.fg};`,
          text: (m.name || "?").charAt(0),
          title: m.name,
        })
      );
    });
    return stack;
  };

  // ---- FAB ----
  App.fab = function (label, onClick) {
    return App.el("button", {
      class: "fab",
      "aria-label": label,
      html: App.icon("plus", 26),
      onclick: onClick,
    });
  };

  // ---- 家族ステータス選択シート(共通) ----
  App.STATUS_OPTIONS = ["在宅", "外出中", "仕事中", "保育園", "学校", "おでかけ", "お昼寝中", "就寝中"];
  App.openStatusSheet = function (member) {
    let selected = member.status;
    const s = App.sheet(`${member.name}のようす`, [
      App.el("p", {
        text: "いまの状態を選んでください(本人が自分で更新する想定です)",
        style: "font-size: var(--text-sub); color: var(--color-text-secondary); margin-bottom: var(--spacing-4);",
      }),
      App.chipSelect(App.STATUS_OPTIONS, selected, (v) => (selected = v)),
      App.el("button", {
        class: "btn-primary",
        text: "更新する",
        onclick: () => {
          s.close();
          App.store.update((st) => {
            const m = st.family.find((f) => f.id === member.id);
            if (m) {
              m.status = selected;
              m.updatedAt = Date.now();
            }
          });
          App.toast(`${member.name}のようすを「${selected}」にしました`);
        },
      }),
    ]);
  };
})();
