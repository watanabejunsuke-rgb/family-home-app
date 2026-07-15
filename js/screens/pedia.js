// ============================================
// 植物図鑑 — 月別のお世話ごよみの閲覧(まだ家に無い植物も含む)
// データは js/plantpedia.js の App.PLANTPEDIA(静的)。store・同期には影響しない。
// ============================================
window.App = window.App || {};
App.screens = App.screens || {};

(function () {
  let cat = "all"; // 絞り込み中のカテゴリ
  let pendingOpenId = null; // 他画面から特定の植物ページを開きたいときの予約

  const CATS = ["観葉植物", "野菜", "ハーブ", "果物", "花"];
  const DIFF_LABEL = { easy: "そだてやすい", normal: "ふつう", hard: "手ごたえあり" };

  // うちの植物として登録済みか(名前のゆるい一致)
  function isOwned(p) {
    return App.store.state.plants.some(
      (pl) => pl.name && (pl.name.includes(p.name) || p.name.includes(pl.name))
    );
  }

  // 12ヶ月のこよみピル(適期=色付き、今月=枠で強調)
  function monthPills(months) {
    const row = App.el("div", { class: "pedia-months" });
    const cur = new Date().getMonth() + 1;
    for (let m = 1; m <= 12; m++) {
      row.appendChild(
        App.el("span", {
          class:
            "pedia-month" +
            (months.indexOf(m) >= 0 ? " is-active" : "") +
            (m === cur ? " is-current" : ""),
          text: String(m),
        })
      );
    }
    return row;
  }

  function openPediaSheet(p) {
    const cur = new Date().getMonth() + 1;
    const nowTasks = p.tasks.filter((t) => t.months.indexOf(cur) >= 0);

    const row = (label, value) =>
      App.el("div", { class: "field", style: "margin-bottom: var(--spacing-3);" }, [
        App.el("span", { class: "field__label", text: label }),
        App.el("p", { text: value }),
      ]);

    const content = [
      App.el("div", { style: "display: flex; gap: var(--spacing-2); margin-bottom: var(--spacing-3); flex-wrap: wrap;" }, [
        App.el("span", { class: "badge badge--muted", text: p.category }),
        App.el("span", { class: "badge", text: DIFF_LABEL[p.difficulty] || p.difficulty }),
        isOwned(p) ? App.el("span", { class: "badge badge--success", text: "うちにある" }) : null,
      ]),
      row("置き場所", p.place),
      row("水やり", p.water),
      App.el("div", { class: "field", style: "margin-bottom: var(--spacing-3);" }, [
        App.el("span", { class: "field__label", text: "育て方のコツ" }),
        App.el("p", { style: "font-size: var(--text-sub); line-height: var(--line-height);", text: p.tips }),
      ]),
    ];

    // 今月やること(あれば)
    if (nowTasks.length) {
      content.push(
        App.el("div", {
          style: "background: var(--cat-plant-bg); border-radius: var(--radius-sm); padding: var(--spacing-3); margin-bottom: var(--spacing-3);",
        }, [
          App.el("p", { style: "font-size: var(--text-sub); font-weight: 600; color: var(--cat-plant);", text: `今月(${cur}月)の適期` }),
          App.el("p", { style: "font-size: var(--text-sub); margin-top: 2px;", text: nowTasks.map((t) => t.label).join("・") }),
        ])
      );
    }

    // お世話ごよみ(作業ごとに12ヶ月ピル)
    const calendar = App.el("div", { class: "field" }, [
      App.el("span", { class: "field__label", text: "お世話ごよみ" }),
    ]);
    p.tasks.forEach((t) => {
      calendar.appendChild(
        App.el("div", { class: "pedia-task" }, [
          App.el("p", { class: "pedia-task__label" }, [
            t.label,
            t.freq ? App.el("span", { class: "pedia-task__freq", text: `頻度:${t.freq}` }) : null,
          ]),
          monthPills(t.months),
          t.note ? App.el("p", { class: "pedia-task__note", text: t.note }) : null,
        ])
      );
    });
    content.push(calendar);

    // うちの植物に追加(既にあれば表示しない)
    if (!isOwned(p)) {
      const addBtn = App.el("button", {
        class: "btn-primary",
        html: App.icon("plus", 18) + "<span>うちの植物に追加</span>",
      });
      addBtn.addEventListener("click", () => {
        s.close();
        App.openPlantSheet(null, { name: p.name, cycleDays: p.cycleDays });
      });
      content.push(addBtn);
    }

    const s = App.sheet(p.name, content);
  }

  // 植物の記録画面などから、特定の植物の図鑑ページへ直接遷移する
  App.openPediaFor = function (pediaId) {
    const p = App.PLANTPEDIA.find((e) => e.id === pediaId);
    if (!p) {
      App.toast("図鑑に該当する情報が見つかりませんでした", "info");
      return;
    }
    pendingOpenId = pediaId;
    App.go("pedia");
  };

  App.screens.pedia = {
    title: "植物図鑑",
    back: true,

    render(container) {
      // 他画面からの直接遷移予約があれば、詳細シートを開く
      if (pendingOpenId) {
        const target = App.PLANTPEDIA.find((e) => e.id === pendingOpenId);
        pendingOpenId = null;
        if (target) openPediaSheet(target);
      }

      // 注意書き(データはAI下書きベースの一般的な目安)
      container.appendChild(
        App.el("p", {
          class: "section",
          style: "font-size: var(--text-caption); color: var(--color-text-muted);",
          text: "関東平野部を基準にした一般的な目安です。品種やお住まいの環境に合わせて調整してください。",
        })
      );

      // カテゴリ絞り込み
      container.appendChild(
        App.el("div", { class: "section", style: "margin-top: var(--spacing-2);" }, [
          App.chipSelect(
            [{ value: "all", label: "すべて" }].concat(CATS.map((c) => ({ value: c, label: c }))),
            cat,
            (v) => { cat = v; App.refresh(); }
          ),
        ])
      );

      const list = App.PLANTPEDIA.filter((p) => cat === "all" || p.category === cat);

      const card = App.el("div", { class: "card card--lg" });
      if (list.length === 0) {
        card.appendChild(App.emptyState("leaf", "該当する植物がありません", ""));
      }
      list.forEach((p) => {
        card.appendChild(
          App.el("button", {
            class: "list-row",
            "aria-label": `${p.name}の育て方を見る`,
            onclick: () => openPediaSheet(p),
          }, [
            App.el("span", { class: "list-row__icon", style: "background: var(--cat-plant-bg); color: var(--cat-plant);", html: App.icon("leaf", 18) }),
            App.el("span", { class: "list-row__body" }, [
              App.el("span", {}, [
                p.name,
                isOwned(p) ? App.el("span", { class: "badge badge--success", style: "margin-left: var(--spacing-2); font-size: 10px; padding: 1px 8px;", text: "うちにある" }) : null,
              ]),
              App.el("span", { class: "list-row__sub", text: `${p.category}・${DIFF_LABEL[p.difficulty] || ""}` }),
            ]),
            App.el("span", { class: "chevron", html: App.icon("chevron", 16) }),
          ])
        );
      });
      container.appendChild(App.el("section", { class: "section", style: "margin-top: var(--spacing-2);" }, [card]));
    },
  };
})();
