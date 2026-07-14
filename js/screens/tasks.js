// ============================================
// やること — 時間バケツ(今日/これから/いつでも/完了) + 追加・編集
// ============================================
window.App = window.App || {};
App.screens = App.screens || {};

(function () {
  // タスク追加・編集シート(ホームからも呼ばれる共通部品)
  // opts.prefillTitle : 新規作成時の初期タイトル(メモからの変換など)
  // opts.onCreate(st) : 新規作成の保存時、同じ更新内で追加で行う処理(メモ削除など)
  // opts.successToast : 保存成功時のトースト文言の上書き
  App.openTaskSheet = function (task, opts = {}) {
    const isEdit = !!task;
    const today = App.date.today();
    // due: null=いつでも / 今日と同じ=今日 / それ以外=日付を指定
    let mode = isEdit ? (task.due ? (task.due === today ? "today" : "date") : "none") : "today";

    const titleInput = App.el("input", { type: "text", value: isEdit ? task.title : (opts.prefillTitle || ""), placeholder: "例:保育園の連絡帳を書く" });
    const dateInput = App.el("input", { type: "date", value: isEdit && task.due ? task.due : today });
    const dateField = App.field("日付", dateInput);
    dateField.style.display = mode === "date" ? "" : "none";

    const saveBtn = App.el("button", { class: "btn-primary", text: isEdit ? "変更を保存" : "やることを追加" });

    const content = [
      App.field("やること", titleInput),
      App.el("div", { class: "field" }, [
        App.el("span", { class: "field__label", text: "いつやる?" }),
        App.chipSelect(
          [
            { value: "today", label: "今日" },
            { value: "date", label: "日付を指定" },
            { value: "none", label: "いつでも" },
          ],
          mode,
          (v) => {
            mode = v;
            dateField.style.display = v === "date" ? "" : "none";
          }
        ),
      ]),
      dateField,
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
      // 「日付を指定」で日付が空のときは今日として扱う
      const due = mode === "today" ? today : mode === "date" ? dateInput.value || today : null;
      s.close();
      App.store.update((st) => {
        if (isEdit) {
          const t = st.tasks.find((x) => x.id === task.id);
          if (t) Object.assign(t, { title, due });
        } else {
          st.tasks.push({ id: App.uid(), title, due, done: false, createdAt: Date.now() });
          if (opts.onCreate) opts.onCreate(st);
        }
      });
      App.toast(opts.successToast || (isEdit ? "変更しました" : "やることを追加しました"));
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
      const today = App.date.today();
      const all = App.store.state.tasks;
      const open = all.filter((t) => !t.done);
      const done = all.filter((t) => t.done);

      // 植物のお世話(水やり期限・お手入れ適期)は期限が今日なので「今日」に合流
      const plantItems = App.data.plantCareItems();

      // 時間バケツ
      const todayTasks = open
        .filter((t) => t.due && t.due <= today)
        .sort((a, b) => (a.due || "").localeCompare(b.due || ""));
      const upcoming = open
        .filter((t) => t.due && t.due > today)
        .sort((a, b) => a.due.localeCompare(b.due));
      const someday = open.filter((t) => !t.due);

      // 何もない(未完了も完了もない)ときだけ全体の空状態を出す
      if (plantItems.length + open.length === 0 && done.length === 0) {
        const card = App.el("div", { class: "card card--lg" }, [
          App.emptyState("checkCircle", "やることはありません", "右下の+から追加できます。"),
        ]);
        container.appendChild(App.el("section", { class: "section" }, [card]));
        container.appendChild(App.fab("やることを追加", () => App.openTaskSheet()));
        return;
      }

      // バケツ1つ分のセクションを組む
      const bucket = (label, items, buildItem) => {
        if (items.length === 0) return;
        const card = App.el("div", { class: "card card--lg" });
        const ul = App.el("ul");
        items.forEach((it) => ul.appendChild(buildItem(it)));
        card.appendChild(ul);
        container.appendChild(App.el("section", { class: "section" }, [App.sectionHeader(label), card]));
      };

      // 今日:植物のお世話 + 今日/期限切れのタスク
      const todayItems = [
        ...plantItems.map((p) => ({ __plant: true, item: p })),
        ...todayTasks.map((t) => ({ __plant: false, item: t })),
      ];
      bucket("今日", todayItems, (row) => {
        if (row.__plant) {
          return App.taskItem(row.item, { onToggle: App.completePlantCareItem, meta: row.item.meta });
        }
        const t = row.item;
        return App.taskItem(t, {
          onToggle: toggleTask,
          onEdit: App.openTaskSheet,
          meta: t.due < today ? `期限:${App.fmtDate(t.due)}(すぎています)` : null,
        });
      });

      // これから:未来日付
      bucket("これから", upcoming, (t) =>
        App.taskItem(t, { onToggle: toggleTask, onEdit: App.openTaskSheet, meta: App.fmtDate(t.due) })
      );

      // いつでも:期限なし
      bucket("いつでも", someday, (t) =>
        App.taskItem(t, { onToggle: toggleTask, onEdit: App.openTaskSheet })
      );

      // 完了済み
      if (done.length > 0) {
        bucket(`完了済み(${done.length})`, done, (t) =>
          App.taskItem(t, { onToggle: toggleTask, onEdit: App.openTaskSheet })
        );
      }

      container.appendChild(App.fab("やることを追加", () => App.openTaskSheet()));
    },
  };
})();
