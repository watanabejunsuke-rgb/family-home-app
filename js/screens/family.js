// ============================================
// 家族のようす — 本人が自分で更新するステータス
// (位置情報の自動追跡は行わない)
// ============================================
window.App = window.App || {};
App.screens = App.screens || {};

(function () {
  function timeAgo(ts) {
    const min = Math.floor((Date.now() - ts) / 60000);
    if (min < 1) return "たった今";
    if (min < 60) return `${min}分前`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}時間前`;
    return `${Math.floor(h / 24)}日前`;
  }

  // 色スウォッチ(1〜6)。選択中は縁取りで示す
  function colorSwatches(selected, onChange) {
    const row = App.el("div", { class: "color-swatch-row", role: "group", "aria-label": "メンバーの色" });
    for (let n = 1; n <= 6; n++) {
      const b = App.el("button", {
        type: "button",
        class: "color-swatch",
        style: `background: var(--member-${n}-bg); color: var(--member-${n});`,
        "aria-label": `色${n}`,
        "aria-pressed": String(n === selected),
        html: `<span class="color-swatch__dot"></span>`,
      });
      b.addEventListener("click", () => {
        onChange(n);
        row.querySelectorAll(".color-swatch").forEach((c, i) => c.setAttribute("aria-pressed", String(i + 1 === n)));
      });
      row.appendChild(b);
    }
    return row;
  }

  // アイコンは名前の頭文字から自動で決まるため、絵文字ピッカーは廃止(v0.5.1)
  function openMemberSheet(member) {
    const isEdit = !!member;
    const fam = App.store.state.family;
    let color = isEdit
      ? member.color || (fam.findIndex((f) => f.id === member.id) % 6) + 1
      : (fam.length % 6) + 1;
    const nameInput = App.el("input", { type: "text", value: isEdit ? member.name : "", placeholder: "例:はると" });
    const saveBtn = App.el("button", { class: "btn-primary", text: isEdit ? "変更を保存" : "家族を追加" });

    // 他のメンバーが使っている色(明示指定 or 自動割り当て)を把握し、重複選択時にそっと知らせる
    const usedBy = {};
    fam.forEach((f, i) => {
      if (isEdit && f.id === member.id) return;
      const n = f.color || (i % 6) + 1;
      usedBy[n] = usedBy[n] ? `${usedBy[n]}・${f.name}` : f.name;
    });
    const colorHint = App.el("p", {
      style: "font-size: var(--text-caption); color: var(--color-text-muted); margin-top: var(--spacing-2); min-height: 1.4em;",
    });
    const syncHint = () => {
      colorHint.textContent = usedBy[color] ? `${usedBy[color]}と同じ色です(そのままでも大丈夫)` : "";
    };
    syncHint();

    const content = [
      App.field("なまえ", nameInput),
      App.el("div", { class: "field" }, [
        App.el("span", { class: "field__label", text: "この人の色" }),
        colorSwatches(color, (v) => { color = v; syncHint(); }),
        colorHint,
      ]),
      saveBtn,
    ];
    if (isEdit && App.store.state.family.length > 1) {
      const del = App.el("button", { class: "btn-danger-text", html: App.icon("trash", 16) + "<span>この家族を削除</span>" });
      del.addEventListener("click", () => {
        App.confirm({
          title: "家族を削除しますか?",
          message: `「${member.name}」をようす一覧から削除します。予定の記録は残ります。`,
          okLabel: "削除する",
          danger: true,
          onOk: () => {
            s.close();
            App.store.update((st) => {
              st.family = st.family.filter((f) => f.id !== member.id);
            });
            App.toast("削除しました", "trash");
          },
        });
      });
      content.push(del);
    }

    const s = App.sheet(isEdit ? "家族の情報を編集" : "家族を追加", content);
    saveBtn.addEventListener("click", () => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); App.toast("なまえを入力してください", "info"); return; }
      s.close();
      App.store.update((st) => {
        if (isEdit) {
          const m = st.family.find((f) => f.id === member.id);
          if (m) Object.assign(m, { name, color });
        } else {
          st.family.push({ id: App.uid(), name, color, status: "在宅", updatedAt: Date.now() });
        }
      });
      App.toast(isEdit ? "変更しました" : `「${name}」を追加しました`);
    });
  }

  App.screens.family = {
    title: "家族のようす",
    back: true,

    render(container) {
      container.appendChild(
        App.el("p", {
          class: "section",
          style: "font-size: var(--text-sub); color: var(--color-text-secondary);",
          text: "ようすは家族それぞれが自分で更新します。位置情報の自動追跡はしません。",
        })
      );

      const section = App.el("section", { class: "section" });
      App.store.state.family.forEach((m) => {
        const row = App.el("div", { class: "card card--tappable", style: "margin-bottom: var(--spacing-3); display: flex; align-items: center; gap: var(--spacing-3);" }, [
          App.initialAvatar(m.name, m.id),
          App.el("div", { style: "flex: 1; min-width: 0;" }, [
            App.el("p", { style: "font-weight: 600;", text: m.name }),
            App.el("p", { style: "font-size: var(--text-caption); color: var(--color-text-muted);", text: `更新:${timeAgo(m.updatedAt)}` }),
          ]),
          App.el("button", {
            class: "badge",
            style: "min-height: var(--tap-target); padding: 0 var(--spacing-4); font-size: var(--text-sub);",
            text: m.status,
            "aria-label": `${m.name}のようす(${m.status})を変更`,
            onclick: () => App.openStatusSheet(m),
          }),
          App.el("button", {
            class: "icon-btn",
            "aria-label": `${m.name}の情報を編集`,
            html: App.icon("edit", 18),
            onclick: () => openMemberSheet(m),
          }),
        ]);
        section.appendChild(row);
      });
      container.appendChild(section);

      container.appendChild(App.fab("家族を追加", () => openMemberSheet(null)));
    },
  };
})();
