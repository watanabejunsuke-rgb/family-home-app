// ============================================
// メモ・日記 — 残しておきたいことを気軽に
// ============================================
window.App = window.App || {};
App.screens = App.screens || {};

(function () {
  let tab = "memo"; // "memo" | "diary"

  function openNoteSheet(note) {
    const isEdit = !!note;
    const type = isEdit ? note.type : tab;
    const isDiary = type === "diary";

    const titleInput = App.el("input", { type: "text", value: isEdit ? note.title : "", placeholder: "例:保育園の夏祭り" });
    const dateInput = App.el("input", { type: "date", value: isEdit ? note.date : App.date.today() });
    const bodyInput = App.el("textarea", { placeholder: isDiary ? "今日あったこと、感じたことを自由に。" : "内容をメモしておきましょう。" });
    if (isEdit) bodyInput.value = note.body;
    const saveBtn = App.el("button", { class: "btn-primary", text: isEdit ? "変更を保存" : "保存する" });

    const content = [];
    if (isDiary) content.push(App.field("日付", dateInput));
    else content.push(App.field("タイトル", titleInput));
    content.push(App.field(isDiary ? "今日のできごと" : "内容", bodyInput));
    content.push(saveBtn);

    // メモは「やること」に近い内容になることがあるので、ワンタップで移せる導線を置く
    if (isEdit && !isDiary) {
      const convert = App.el("button", {
        class: "btn-secondary",
        style: "margin-top: var(--spacing-3);",
        html: App.icon("checkCircle", 16) + "<span>このメモをやることにする</span>",
      });
      convert.addEventListener("click", () => {
        const title = (titleInput.value.trim() || bodyInput.value.trim().split("\n")[0] || "").slice(0, 60);
        if (!title) { App.toast("内容を入力してください", "info"); return; }
        s.close();
        // やること追加シートを開いて日付(今日/日付を指定/いつでも)を選んでもらう。
        // 保存されたときだけ元メモを削除する(キャンセルすればメモは残る)
        App.openTaskSheet(null, {
          prefillTitle: title,
          onCreate: (st) => { st.notes = st.notes.filter((n) => n.id !== note.id); },
          successToast: "やることに移しました",
        });
      });
      content.push(convert);
    }

    if (isEdit) {
      const del = App.el("button", { class: "btn-danger-text", html: App.icon("trash", 16) + "<span>削除する</span>" });
      del.addEventListener("click", () => {
        App.confirm({
          title: isDiary ? "日記を削除しますか?" : "メモを削除しますか?",
          message: "この操作は取り消せません。",
          okLabel: "削除する",
          danger: true,
          onOk: () => {
            s.close();
            App.store.update((st) => {
              st.notes = st.notes.filter((n) => n.id !== note.id);
            });
            App.toast("削除しました", "trash");
          },
        });
      });
      content.push(del);
    }

    const s = App.sheet(
      isEdit ? (isDiary ? "日記を編集" : "メモを編集") : isDiary ? "今日の日記" : "メモを追加",
      content
    );
    saveBtn.addEventListener("click", () => {
      const body = bodyInput.value.trim();
      const title = titleInput.value.trim();
      if (!body && !title) {
        (isDiary ? bodyInput : titleInput).focus();
        App.toast("内容を入力してください", "info");
        return;
      }
      s.close();
      App.store.update((st) => {
        if (isEdit) {
          const n = st.notes.find((x) => x.id === note.id);
          if (n) Object.assign(n, { title, body, date: isDiary ? dateInput.value : n.date, updatedAt: Date.now() });
        } else {
          st.notes.unshift({
            id: App.uid(),
            type,
            title: isDiary ? "" : title,
            body,
            date: isDiary ? dateInput.value : App.date.today(),
            updatedAt: Date.now(),
          });
        }
      });
      App.toast("保存しました");
    });
  }

  App.screens.notes = {
    title: "メモ・日記",
    back: true,

    render(container) {
      const segment = App.el("div", { class: "segment", role: "tablist" });
      [
        { key: "memo", label: "メモ" },
        { key: "diary", label: "日記" },
      ].forEach((t) => {
        segment.appendChild(
          App.el("button", {
            class: "segment__btn",
            role: "tab",
            "aria-pressed": String(tab === t.key),
            text: t.label,
            onclick: () => { tab = t.key; App.refresh(); },
          })
        );
      });
      container.appendChild(segment);

      const notes = App.store.state.notes
        .filter((n) => n.type === tab)
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

      const section = App.el("section", { class: "section", style: "margin-top: 0;" });
      if (notes.length === 0) {
        section.appendChild(
          App.el("div", { class: "card card--lg" }, [
            tab === "memo"
              ? App.emptyState("note", "メモはまだありません", "覚えておきたいことを気軽に残しましょう。")
              : App.emptyState("heart", "日記はまだありません", "一行だけでも、あとで宝物になります。"),
          ])
        );
      } else if (tab === "memo") {
        // メモ:タイトル主役の付箋ボード(北欧トーンの色を並び順で循環)
        const board = App.el("div", { class: "note-board" });
        notes.forEach((n, i) => {
          const c = App.paletteColor((i % 6) + 1);
          board.appendChild(
            App.el("button", {
              class: "note-sticky",
              style: `background: ${c.bg};`,
              "aria-label": `${n.title || "メモ"}を開く`,
              onclick: () => openNoteSheet(n),
            }, [
              n.title ? App.el("p", { class: "note-sticky__title", style: `color: ${c.fg};`, text: n.title }) : null,
              App.el("p", { class: "note-sticky__body", text: n.body }),
            ])
          );
        });
        section.appendChild(board);
      } else {
        // 日記:日付主役のタイムライン
        notes.forEach((n) => {
          section.appendChild(
            App.el("button", {
              class: "card card--lg card--tappable note-card",
              style: "width: 100%; text-align: left; display: block;",
              "aria-label": `${App.fmtDate(n.date)}の日記を開く`,
              onclick: () => openNoteSheet(n),
            }, [
              App.el("p", { class: "note-card__date", text: App.fmtDate(n.date) }),
              App.el("p", { class: "note-card__body", text: n.body }),
            ])
          );
        });
      }
      container.appendChild(section);

      container.appendChild(App.fab(tab === "memo" ? "メモを追加" : "日記を書く", () => openNoteSheet(null)));
    },
  };
})();
