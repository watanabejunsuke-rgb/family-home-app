// ============================================
// 家族のようす — 今日の予定(カレンダーのmemberIds)から自動表示
// (位置情報の自動追跡は行わない。以前の「本人が手動で申告するステータス」は
// こまめな更新が現実的でなく使われないため、v0.20.0で自動導出方式に置き換えた)
// ============================================
window.App = window.App || {};
App.screens = App.screens || {};

(function () {
  function todaySummaryText(memberId) {
    const s = App.data.memberTodaySummary(memberId);
    if (!s) return "今日の予定はありません";
    const extra = s.moreCount > 0 ? ` ほか${s.moreCount}件` : "";
    return `今日 ${s.time} ${s.title}${extra}`;
  }

  // 生年月日から年齢を計算(3歳未満は「◯歳◯ヶ月」、以降は「◯歳」)。
  // 月齢が育児の話題として重要な低年齢のうちだけ精度を上げる
  function ageLabel(birthday) {
    if (!birthday) return null;
    const b = new Date(birthday + "T00:00:00");
    if (isNaN(b)) return null;
    const now = new Date();
    let years = now.getFullYear() - b.getFullYear();
    let months = now.getMonth() - b.getMonth();
    if (now.getDate() < b.getDate()) months--;
    if (months < 0) { years--; months += 12; }
    if (years < 0) return null; // 未来の日付が入っていた場合は表示しない
    return years < 3 ? (months > 0 ? `${years}歳${months}ヶ月` : `${years}歳`) : `${years}歳`;
  }

  // ---- 成長記録(できるようになったこと・印象的な出来事を自由記述で残す) ----
  function growthLogOf(m) {
    if (!m.growthLog) m.growthLog = [];
    return m.growthLog;
  }

  function openGrowthEntrySheet(member) {
    const dateInput = App.el("input", { type: "date", value: App.date.today() });
    const bodyInput = App.el("textarea", { placeholder: "例:はじめて自転車の補助輪なしで走れた/お昼寝をいやがってぐずった" });
    const saveBtn = App.el("button", { class: "btn-primary", text: "記録する" });
    const s = App.sheet(`${member.name}の成長記録`, [
      App.field("日付", dateInput),
      App.field("できごと", bodyInput),
      saveBtn,
    ]);
    saveBtn.addEventListener("click", () => {
      const body = bodyInput.value.trim();
      if (!body) { bodyInput.focus(); App.toast("内容を入力してください", "info"); return; }
      s.close();
      App.store.update((st) => {
        const m = st.family.find((f) => f.id === member.id);
        if (!m) return;
        growthLogOf(m).unshift({ id: App.uid(), date: dateInput.value, body, createdAt: Date.now() });
      });
      App.toast("記録しました", "sparkle");
    });
  }

  function openGrowthEntryDeleteSheet(member, entry) {
    const delBtn = App.el("button", { class: "btn-danger-text", html: App.icon("trash", 16) + "<span>この記録を削除</span>" });
    const s = App.sheet(App.fmtDate(entry.date, { weekday: false }), [
      App.el("p", { style: "white-space: pre-wrap; font-size: var(--text-sub); margin-bottom: var(--spacing-3);", text: entry.body }),
      delBtn,
    ]);
    delBtn.addEventListener("click", () => {
      s.close();
      App.store.update((st) => {
        const m = st.family.find((f) => f.id === member.id);
        if (m) m.growthLog = growthLogOf(m).filter((g) => g.id !== entry.id);
      });
      App.toast("削除しました", "trash");
    });
  }

  // アイコンは名前の頭文字から自動で決まるため、絵文字ピッカーは廃止(v0.5.1)
  function openMemberSheet(member) {
    const isEdit = !!member;
    const fam = App.store.state.family;
    let color = isEdit
      ? member.color || (fam.findIndex((f) => f.id === member.id) % 6) + 1
      : (fam.length % 6) + 1;
    const nameInput = App.el("input", { type: "text", value: isEdit ? member.name : "", placeholder: "例:はると" });
    const birthdayInput = App.el("input", { type: "date", value: isEdit ? (member.birthday || "") : "" });
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
      App.field("生年月日(任意。年齢の自動表示に使います)", birthdayInput),
      App.el("div", { class: "field" }, [
        App.el("span", { class: "field__label", text: "この人の色" }),
        App.colorSwatches(color, (v) => { color = v; syncHint(); }),
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
      const birthday = birthdayInput.value || undefined;
      App.store.update((st) => {
        if (isEdit) {
          const m = st.family.find((f) => f.id === member.id);
          if (m) Object.assign(m, { name, color, birthday });
        } else {
          st.family.push({ id: App.uid(), name, color, birthday });
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
          text: "今日の予定(カレンダー)から自動で表示します。位置情報の自動追跡や手動でのステータス更新はありません。",
        })
      );

      const section = App.el("section", { class: "section" });
      App.store.state.family.forEach((m) => {
        const age = ageLabel(m.birthday);
        const card = App.el("div", { class: "card card--lg", style: "margin-bottom: var(--spacing-3);" });
        card.appendChild(
          App.el("div", { style: "display: flex; align-items: center; gap: var(--spacing-3);" }, [
            App.initialAvatar(m.name, m.id),
            App.el("div", { style: "flex: 1; min-width: 0;" }, [
              App.el("p", { style: "font-weight: 600;", text: age ? `${m.name}(${age})` : m.name }),
              App.el("p", { style: "font-size: var(--text-caption); color: var(--color-text-muted);", text: todaySummaryText(m.id) }),
            ]),
            App.el("button", {
              class: "icon-btn",
              "aria-label": `${m.name}の情報を編集`,
              html: App.icon("edit", 18),
              onclick: () => openMemberSheet(m),
            }),
          ])
        );

        // 成長記録(折りたたみ。できるようになったこと・印象的な出来事を自由記述で)
        const log = [...growthLogOf(m)].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        const growthBox = App.el("div", {
          style: "display: none; margin-top: var(--spacing-3); border-top: 1px solid var(--color-divider); padding-top: var(--spacing-3);",
        });
        if (log.length === 0) {
          growthBox.appendChild(App.emptyState("sparkle", "まだ記録はありません", "できるようになったこと、印象的だった出来事を残せます。"));
        } else {
          log.slice(0, 10).forEach((g) => {
            growthBox.appendChild(
              App.el("button", {
                class: "list-row", style: "display: block; padding: var(--spacing-2) 0;",
                "aria-label": `${App.fmtDate(g.date, { weekday: false })}の記録を見る`,
                onclick: () => openGrowthEntryDeleteSheet(m, g),
              }, [
                App.el("p", { style: "font-size: var(--text-caption); color: var(--color-text-muted);", text: App.fmtDate(g.date, { weekday: false }) }),
                App.el("p", { style: "font-size: var(--text-sub);", text: g.body }),
              ])
            );
          });
        }
        growthBox.appendChild(
          App.el("button", {
            class: "section-header__action", style: "margin-top: var(--spacing-2);",
            html: App.icon("plus", 14) + "<span>記録を追加</span>",
            onclick: () => openGrowthEntrySheet(m),
          })
        );
        const growthToggle = App.el("button", {
          class: "section-header__action", style: "margin-top: var(--spacing-3);",
          html: App.icon("sparkle", 14) + `<span>成長記録を見る${log.length ? `(${log.length}件)` : ""}</span>`,
          onclick: () => { growthToggle.style.display = "none"; growthBox.style.display = ""; },
        });
        card.appendChild(growthToggle);
        card.appendChild(growthBox);

        section.appendChild(card);
      });
      container.appendChild(section);

      container.appendChild(App.fab("家族を追加", () => openMemberSheet(null)));
    },
  };
})();
