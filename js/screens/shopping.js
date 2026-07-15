// ============================================
// 買い物リスト — その場で追加、タップで購入済み
// ============================================
window.App = window.App || {};
App.screens = App.screens || {};

(function () {
  // 「よく買うもの」の集計(件数)。購入済みを消しても件数は残るので、
  // 増減の激しい買い物リスト本体とは別に保持する
  function bumpFrequent(name) {
    App.store.update((st) => {
      if (!st.shoppingFrequent) st.shoppingFrequent = [];
      const entry = st.shoppingFrequent.find((e) => e.name === name);
      if (entry) entry.count++;
      else st.shoppingFrequent.push({ name, count: 1 });
    });
  }

  // 上位N件(現在すでにリストにあるものは提案しない)
  function topFrequent(excludeNames, limit = 6) {
    return [...(App.store.state.shoppingFrequent || [])]
      .filter((e) => !excludeNames.includes(e.name))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

App.screens.shopping = {
  title: "買い物リスト",
  back: true,

  render(container) {
    // ---- 追加フォーム ----
    const input = App.el("input", { type: "text", placeholder: "例:牛乳", "aria-label": "買うもの" });
    const addBtn = App.el("button", { "aria-label": "リストに追加", html: App.icon("plus", 22) });
    const addName = (name) => {
      App.store.update((st) => {
        st.shopping.unshift({ id: App.uid(), name, done: false });
      });
      bumpFrequent(name);
      App.toast(`「${name}」を追加しました`);
    };
    const add = () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      input.value = "";
      addName(name);
    };
    addBtn.addEventListener("click", add);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
    container.appendChild(
      App.el("div", { class: "field", style: "margin-top: var(--spacing-4); margin-bottom: 0;" }, [
        App.el("label", { class: "field__label", for: "shopping-input", text: "買うものを追加" }),
      ])
    );
    input.id = "shopping-input";
    container.appendChild(App.el("div", { class: "shopping-add", style: "margin-top: var(--spacing-2);" }, [input, addBtn]));

    // ---- よく買うもの(過去の追加履歴から上位を提案。既にリストにあるものは出さない) ----
    const items0 = App.store.state.shopping;
    const openNames = items0.filter((i) => !i.done).map((i) => i.name);
    const frequent = topFrequent(openNames);
    if (frequent.length) {
      const chipRow = App.el("div", { class: "chip-row", style: "margin-top: var(--spacing-3);" });
      frequent.forEach((f) => {
        chipRow.appendChild(
          App.el("button", {
            class: "chip",
            html: App.icon("plus", 14) + `<span>${f.name}</span>`,
            onclick: () => addName(f.name),
          })
        );
      });
      container.appendChild(
        App.el("div", { class: "field", style: "margin-top: var(--spacing-2); margin-bottom: 0;" }, [
          App.el("span", { class: "field__label", text: "よく買うもの" }),
          chipRow,
        ])
      );
    }

    const items = App.store.state.shopping;
    const open = items.filter((i) => !i.done);
    const done = items.filter((i) => i.done);

    const toggle = (item) => {
      App.store.update((st) => {
        const x = st.shopping.find((k) => k.id === item.id);
        if (x) x.done = !x.done;
      });
      const x = App.store.state.shopping.find((k) => k.id === item.id);
      if (x && x.done) App.toast(`「${item.name}」を買いました`, "cart");
    };

    // ---- 買うもの ----
    const openSection = App.el("section", { class: "section" }, [
      App.sectionHeader(`買うもの(${open.length})`, { icon: "cart" }),
    ]);
    const card = App.el("div", { class: "card card--lg" });
    if (open.length === 0) {
      card.appendChild(App.emptyState("cart", "リストは空です", "上の入力欄からすぐに追加できます。"));
    } else {
      const ul = App.el("ul");
      open.forEach((i) => ul.appendChild(App.taskItem({ id: i.id, title: i.name, done: i.done }, { onToggle: () => toggle(i) })));
      card.appendChild(ul);
    }
    openSection.appendChild(card);
    container.appendChild(openSection);

    // ---- 購入済み ----
    if (done.length > 0) {
      const clearBtn = App.el("button", {
        class: "btn-danger-text",
        style: "margin-top: var(--spacing-2);",
        html: App.icon("trash", 16) + "<span>購入済みをまとめて削除</span>",
        onclick: () =>
          App.confirm({
            title: "購入済みを削除しますか?",
            message: `${done.length}件の購入済みアイテムをリストから削除します。`,
            okLabel: "削除する",
            danger: true,
            onOk: () => {
              App.store.update((st) => {
                st.shopping = st.shopping.filter((i) => !i.done);
              });
              App.toast("購入済みを削除しました", "trash");
            },
          }),
      });
      const doneSection = App.el("section", { class: "section" }, [
        App.sectionHeader(`購入済み(${done.length})`),
      ]);
      const doneCard = App.el("div", { class: "card card--lg" });
      const ul = App.el("ul");
      done.forEach((i) => ul.appendChild(App.taskItem({ id: i.id, title: i.name, done: i.done }, { onToggle: () => toggle(i) })));
      doneCard.appendChild(ul);
      doneCard.appendChild(clearBtn);
      doneSection.appendChild(doneCard);
      container.appendChild(doneSection);
    }
  },
};
})();
