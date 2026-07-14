// ============================================
// 家族と共有 — 世帯の作成・参加・同期(GAS)
// SYNC_URL 未設定 or LINE未接続のときは案内だけ出す
// ============================================
window.App = window.App || {};
App.screens = App.screens || {};

(function () {
  function card(children) {
    return App.el("div", { class: "card card--lg" }, children);
  }
  function note(text) {
    return App.el("p", {
      style: "font-size: var(--text-sub); color: var(--color-text-secondary); line-height: var(--line-height);",
      text,
    });
  }
  // 非同期処理の共通ラッパー(ボタン連打防止＋エラーはトースト)
  async function run(btn, busyText, fn, okMsg) {
    const original = btn.textContent;
    btn.setAttribute("disabled", "");
    btn.textContent = busyText;
    try {
      await fn();
      if (okMsg) App.toast(okMsg, "checkCircle");
      App.refresh();
    } catch (e) {
      btn.removeAttribute("disabled");
      btn.textContent = original;
      App.toast(e && e.message ? e.message : "うまくいきませんでした", "info");
    }
  }

  App.screens.householdShare = {
    title: "家族と共有",
    back: true,

    render(container) {
      const st = App.store.state;

      // 1) 同期先が未設定(バックエンド準備前)
      if (!App.sync.configured()) {
        container.appendChild(App.el("section", { class: "section" }, [
          card([
            App.emptyState("users", "共有はまだ準備中です", "バックエンドの接続後に、この画面から家族と共有できるようになります。"),
          ]),
        ]));
        return;
      }

      // 2) LINE未接続(ブラウザ単体/デモ)では本人確認ができない
      if (!App.sync.inLiff()) {
        container.appendChild(App.el("section", { class: "section" }, [
          card([
            App.emptyState("info", "LINEから開いてください", "家族との共有には本人確認が必要です。LINEアプリ内でこのミニアプリを開くと設定できます。"),
          ]),
        ]));
        return;
      }

      // 3) まだ世帯に参加していない → 作成 or 参加
      if (!App.sync.hasHousehold()) {
        // -- 新規作成 --
        const createBtn = App.el("button", { class: "btn-primary", text: "この端末で家庭を作成" });
        createBtn.addEventListener("click", () =>
          run(createBtn, "作成中…", () => App.sync.create(), "家庭を作成しました")
        );
        container.appendChild(App.el("section", { class: "section" }, [
          App.sectionHeader("はじめる", { icon: "users" }),
          card([
            note("まずどちらか片方の端末で「家庭」を作成し、表示される招待コードをもう片方に伝えます。今ある予定・やること等がそのまま共有データになります。"),
            App.el("div", { style: "margin-top: var(--spacing-3);" }, [createBtn]),
          ]),
        ]));

        // -- 参加 --
        const codeInput = App.el("input", { type: "text", placeholder: "例:ABC234", "aria-label": "招待コード", style: "text-transform: uppercase;" });
        const joinBtn = App.el("button", { class: "btn-secondary", text: "このコードで参加" });
        joinBtn.addEventListener("click", () => {
          const code = codeInput.value.trim();
          if (!code) { codeInput.focus(); App.toast("招待コードを入力してください", "info"); return; }
          run(joinBtn, "参加中…", () => App.sync.join(code), "家族に参加しました");
        });
        container.appendChild(App.el("section", { class: "section" }, [
          App.sectionHeader("もう片方の端末はこちら", { icon: "plus" }),
          card([
            note("先に作成した側の招待コードを入力すると、同じ家庭のデータが共有されます。"),
            App.field("招待コード", codeInput),
            joinBtn,
          ]),
        ]));
        return;
      }

      // 4) 参加済み → 状態・招待コード・同期・解除
      const syncedAt = st.settings.syncedAt
        ? new Date(st.settings.syncedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : "まだ同期していません";

      container.appendChild(App.el("section", { class: "section" }, [
        App.sectionHeader("共有中", { icon: "users" }),
        card([
          App.el("div", { class: "list-row" }, [
            App.el("span", { class: "list-row__icon", style: "background: var(--color-success-bg); color: var(--color-success);", html: App.icon("check", 18) }),
            App.el("span", { class: "list-row__body" }, [
              App.el("span", { text: "家族と連携中" }),
              App.el("span", { class: "list-row__sub", text: `最終同期:${syncedAt}` }),
            ]),
          ]),
        ]),
      ]));

      // 招待コード(まだ相手が参加していないとき用に常に表示)
      if (st.settings.inviteCode) {
        container.appendChild(App.el("section", { class: "section" }, [
          App.sectionHeader("招待コード", { icon: "plus" }),
          card([
            note("もう片方の端末で、このコードを入力して参加してもらいます。"),
            App.el("p", {
              style: "font-size: 28px; font-weight: 700; letter-spacing: 0.15em; text-align: center; color: var(--color-primary); margin: var(--spacing-3) 0;",
              text: st.settings.inviteCode,
            }),
          ]),
        ]));
      }

      const syncBtn = App.el("button", { class: "btn-primary", html: App.icon("bell", 18) + "<span>今すぐ同期</span>" });
      syncBtn.addEventListener("click", () =>
        run(syncBtn, "同期中…", async () => { await App.sync.pull(); await App.sync._pushNow(); }, "同期しました")
      );

      const leaveBtn = App.el("button", { class: "btn-danger-text", style: "margin-top: var(--spacing-3);", html: App.icon("trash", 16) + "<span>共有をやめる</span>" });
      leaveBtn.addEventListener("click", () => {
        App.confirm({
          title: "共有をやめますか?",
          message: "この端末を家庭から外します。この端末のデータは残りますが、以後この端末の変更は共有されません。",
          okLabel: "共有をやめる",
          danger: true,
          onOk: () => run(leaveBtn, "解除中…", () => App.sync.leave(), "共有を解除しました"),
        });
      });

      container.appendChild(App.el("section", { class: "section" }, [
        card([syncBtn, leaveBtn]),
      ]));
    },
  };
})();
