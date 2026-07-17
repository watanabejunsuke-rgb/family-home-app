// ============================================
// 未整理(LINE家族インボックス) — LINEに送ったメッセージの受け皿
// 下部ナビにタブは増やさず、ホーム・メニュー・お知らせから開くサブ画面。
// 登録(予定・やること)は既存の編集シートを再利用し、保存が完了した時だけ
// インボックス項目を「処理済み」にする(途中でやめたら未整理のまま残る)。
// ============================================
window.App = window.App || {};
App.screens = App.screens || {};

(function () {
  function markProcessed(itemId, targetType, targetId) {
    App.store.update((st) => {
      const it = (st.inboxItems || []).find((x) => x.id === itemId);
      if (!it) return;
      it.status = "processed";
      it.processedAt = Date.now();
      it.targetType = targetType;
      if (targetId) it.targetId = targetId;
    });
  }

  function fmtReceived(ms) {
    if (!ms) return "";
    const d = new Date(ms);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function openItemSheet(item) {
    const parsed = App.parseJaDateTime(item.text);
    const title = (parsed.cleaned || item.text).trim() || item.text;

    const actionBtn = (label, icon, onclick, primary) => {
      const b = App.el("button", {
        class: primary ? "btn-primary" : "btn-secondary",
        style: "margin-top: var(--spacing-2);",
        html: App.icon(icon, 16) + `<span>${label}</span>`,
      });
      b.addEventListener("click", onclick);
      return b;
    };

    const content = [
      App.el("p", {
        style: "white-space: pre-wrap; color: var(--color-text-secondary); font-size: var(--text-sub); margin-bottom: var(--spacing-3);",
        html: App.linkify(item.text),
      }),
      App.el("p", {
        style: "font-size: var(--text-caption); color: var(--color-text-muted); margin-bottom: var(--spacing-3);",
        text: `LINEで受け取り:${fmtReceived(item.receivedAt)}`,
      }),
    ];

    const s = App.sheet("どこに登録しますか?", content);
    const sheetNode = s.node;

    sheetNode.appendChild(actionBtn("予定にする", "calendar", () => {
      s.close();
      App.openEventSheet(null, {
        prefill: { title, date: parsed.date || App.date.today(), time: parsed.time || "" },
        onSaved: (eventId) => {
          markProcessed(item.id, "event", eventId);
          if (App.track) App.track("inbox_converted", { to: "event", chars: item.text.length });
        },
      });
    }, true));

    sheetNode.appendChild(actionBtn("やることにする", "check", () => {
      s.close();
      App.openTaskSheet(null, {
        prefillTitle: title,
        onCreate: (st, newTask) => {
          const it = (st.inboxItems || []).find((x) => x.id === item.id);
          if (it) {
            it.status = "processed";
            it.processedAt = Date.now();
            it.targetType = "task";
            if (newTask) it.targetId = newTask.id;
          }
        },
      });
      if (App.track) App.track("inbox_converted", { to: "task", chars: item.text.length });
    }));

    sheetNode.appendChild(actionBtn("買い物にする", "cart", () => {
      s.close();
      let newId = null;
      App.store.update((st) => {
        newId = App.uid();
        st.shopping.unshift({ id: newId, name: title, done: false });
        if (!st.shoppingFrequent) st.shoppingFrequent = [];
        const entry = st.shoppingFrequent.find((e) => e.name === title);
        if (entry) entry.count++;
        else st.shoppingFrequent.push({ name: title, count: 1 });
        const it = (st.inboxItems || []).find((x) => x.id === item.id);
        if (it) {
          it.status = "processed";
          it.processedAt = Date.now();
          it.targetType = "shopping";
          it.targetId = newId;
        }
      });
      if (App.track) App.track("inbox_converted", { to: "shopping", chars: item.text.length });
      App.toast(`「${title}」を買い物リストに追加しました`, "cart");
    }));

    sheetNode.appendChild(actionBtn("メモとして残す", "note", () => {
      s.close();
      let newId = null;
      App.store.update((st) => {
        newId = App.uid();
        st.notes.unshift({ id: newId, type: "memo", date: App.date.today(), title: "", body: item.text, updatedAt: Date.now() });
        const it = (st.inboxItems || []).find((x) => x.id === item.id);
        if (it) {
          it.status = "processed";
          it.processedAt = Date.now();
          it.targetType = "note";
          it.targetId = newId;
        }
      });
      if (App.track) App.track("inbox_converted", { to: "note", chars: item.text.length });
      App.toast("メモに残しました", "note");
    }));

    sheetNode.appendChild(actionBtn("処理済みにする", "checkCircle", () => {
      s.close();
      markProcessed(item.id, "archived");
      if (App.track) App.track("inbox_archived", {});
      App.toast("処理済みにしました");
    }));

    const delBtn = App.el("button", {
      class: "btn-danger-text",
      style: "margin-top: var(--spacing-3);",
      html: App.icon("trash", 16) + "<span>削除する</span>",
    });
    delBtn.addEventListener("click", () => {
      App.confirm({
        title: "このメモを削除しますか?",
        message: "LINEから届いた内容をこの一覧から削除します。この操作は取り消せません。",
        okLabel: "削除する",
        danger: true,
        onOk: () => {
          s.close();
          App.store.update((st) => {
            st.inboxItems = (st.inboxItems || []).filter((x) => x.id !== item.id);
          });
          App.toast("削除しました", "trash");
        },
      });
    });
    sheetNode.appendChild(delBtn);
  }

  App.screens.inbox = {
    title: "未整理",
    back: true,

    render(container) {
      const pending = App.data.inboxPending();

      if (pending.length === 0) {
        container.appendChild(
          App.el("section", { class: "section" }, [
            App.el("div", { class: "card card--lg" }, [
              App.emptyState("checkCircle", "未整理のメモはありません", "LINEの公式アカウントにメッセージを送ると、ここに届きます。"),
            ]),
          ])
        );
        return;
      }

      const section = App.el("section", { class: "section" }, [
        App.sectionHeader(`LINEから届いたメモ(${pending.length})`, { icon: "note" }),
      ]);
      const card = App.el("div", { class: "card card--lg" });
      pending.forEach((item) => {
        card.appendChild(
          App.el("button", {
            class: "list-row",
            "aria-label": `「${item.text}」を整理する`,
            onclick: () => openItemSheet(item),
          }, [
            App.el("span", { class: "list-row__icon", style: "background: var(--cat-note-bg); color: var(--cat-note);", html: App.icon("note", 18) }),
            App.el("span", { class: "list-row__body" }, [
              App.el("span", { style: "white-space: pre-wrap; word-break: break-word;", text: item.text }),
              App.el("span", { class: "list-row__sub", text: `${fmtReceived(item.receivedAt)}${item.status === "later" ? "・あとで整理" : ""}` }),
            ]),
            App.el("span", { class: "chevron", html: App.icon("chevron", 16) }),
          ])
        );
      });
      section.appendChild(card);
      container.appendChild(section);

      container.appendChild(
        App.el("p", {
          style: "font-size: var(--text-caption); color: var(--color-text-muted); text-align: center; margin-top: var(--spacing-3);",
          text: "「買い物:牛乳」のように書くと、LINEからそのまま登録されます。",
        })
      );
    },
  };
})();
