// ============================================
// やること — 今日/すべての切替 + 追加・編集
// ============================================
window.App = window.App || {};
App.screens = App.screens || {};

(function () {
  let tab = "today"; // "today" | "all"

  // タスク追加・編集シート(ホームからも呼ばれる共通部品)
  App.openTaskSheet = function (task) {
    const isEdit = !!task;
    let due = isEdit ? (task.due ? "today" : "none") : "today";
    const titleInput = App.el("input", { type: "text", value: isEdit ? task.title : "", placeholder: "例:保育園の連絡帳を書く" });
    const saveBtn = App.el("button", { class: "btn-primary", text: isEdit ? "変更を保存" : "やることを追加" });

    const content = [
      App.field("やること", titleInput),
      App.el("div", { class: "field" }, [
        App.el("span", { class: "field__label", text: "いつやる?" }),
        App.chipSelect(
          [{ value: "today", label: "今日やる" }, { value: "none", label: "いつでも" }],
          due,
          (v) => (due = v)
        ),
      ]),
      saveBtn,
    ];
    if (isEdit) {
      const del = App.el("button", { class: "btn-danger-text", html: App.icon("trash", 16) + "<span>このやることを削除</span>" });
      del.addEventListener("click", () => {
        App.confirm({
          title: "やることを削除しますか?",
          message: `「${task.title}」を削除します。この操作は取り消せません。`,
          okLabel: "削除する",
          danger: true,
          onOk: () => {
            s.close();
            App.store.update((st) => {
              st.tasks = st.tasks.filter((t) => t.id !== task.id);
            });
            App.toast("やることを削除しました", "trash");
          },
        });
      });
      content.push(del);
    }

    const s = App.sheet(isEdit ? "やることを編集" : "やることを追加", content);
    saveBtn.addEventListener("click", () => {
      const title = titleInput.value.trim();
      if (!title) {
        titleInput.focus();
        App.toast("内容を入力してください", "info");
        return;
      }
      s.close();
      App.store.update((st) => {
        if (isEdit) {
          const t = st.tasks.find((x) => x.id === task.id);
          if (t) Object.assign(t, { title, due: due === "today" ? App.date.today() : null });
        } else {
          st.tasks.push({ id: App.uid(), title, due: due === "today" ? App.date.today() : null, done: false, createdAt: Date.now() });
        }
      });
      App.toast(isEdit ? "変更しました" : "やることを追加しました");
    });
  };

  function toggleTask(task) {
    App.store.update((st) => {
      const t = st.tasks.find((x) => x.id === task.id);
      if (t) t.done = !t.done;
    });
    const t = App.store.state.tasks.find((x) => x.id === task.id);
    if (t && t.done) App.toast("おつかれさま!1件完了しました");
  }

  App.screens.tasks = {
    title: "やること",
    nav: "tasks",

    render(container) {
      // ---- 切替 ----
      const segment = App.el("div", { class: "segment", role: "tablist" });
      [
        { key: "today", label: "今日" },
        { key: "all", label: "すべて" },
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

      const today = App.date.today();
      const all = App.store.state.tasks;
      const list = tab === "today" ? all.filter((t) => t.due && t.due <= today) : all;
      const open = list.filter((t) => !t.done);
      const done = list.filter((t) => t.done);
      // 植物のお世話(水やり期限・お手入れ適期)は期限が今日なので両タブに出す
      const plantItems = App.data.plantCareItems();

      // ---- 未完了 ----
      const card = App.el("div", { class: "card card--lg" });
      if (plantItems.length === 0 && open.length === 0 && done.length === 0) {
        card.appendChild(
          App.emptyState("checkCircle", tab === "today" ? "今日のやることはありません" : "やることはありません", "右下の+から追加できます。")
        );
      } else if (plantItems.length === 0 && open.length === 0) {
        card.appendChild(App.emptyState("checkCircle", "ぜんぶ完了しました!", "今日もおつかれさまでした。"));
      } else {
        const ul = App.el("ul");
        plantItems.forEach((t) =>
          ul.appendChild(App.taskItem(t, { onToggle: App.completePlantCareItem, meta: t.meta }))
        );
        open.forEach((t) =>
          ul.appendChild(
            App.taskItem(t, {
              onToggle: toggleTask,
              onEdit: App.openTaskSheet,
              meta: t.due ? (t.due < today ? `期限:${App.fmtDate(t.due)}(すぎています)` : "今日") : "いつでも",
            })
          )
        );
        card.appendChild(ul);
      }
      container.appendChild(App.el("section", { class: "section" }, [card]));

      // ---- 完了済み ----
      if (done.length > 0) {
        const doneSection = App.el("section", { class: "section" }, [
          App.sectionHeader(`完了済み(${done.length})`),
        ]);
        const doneCard = App.el("div", { class: "card card--lg" });
        const ul = App.el("ul");
        done.forEach((t) => ul.appendChild(App.taskItem(t, { onToggle: toggleTask, onEdit: App.openTaskSheet })));
        doneCard.appendChild(ul);
        doneSection.appendChild(doneCard);
        container.appendChild(doneSection);
      }

      container.appendChild(App.fab("やることを追加", () => App.openTaskSheet()));
    },
  };
})();
