// ============================================
// アプリ本体 — ルーティング・ヘッダー・下部ナビ
// ============================================
window.App = window.App || {};

(function () {
  const NAV_ITEMS = [
    { route: "home", label: "ホーム", icon: "home" },
    { route: "calendar", label: "カレンダー", icon: "calendar" },
    { route: "tasks", label: "やること", icon: "check" },
    { route: "menu", label: "メニュー", icon: "menu" },
  ];

  function currentRoute() {
    const r = (location.hash || "#home").slice(1);
    return App.screens[r] ? r : "home";
  }

  App.go = function (route) {
    if (route === currentRoute()) {
      App.refresh();
      return;
    }
    location.hash = route;
  };

  // ---- ヘッダー ----
  function renderHeader(route) {
    const header = document.getElementById("app-header");
    header.innerHTML = "";
    const screen = App.screens[route];

    // 画面自身が見出しを兼ねるコンテンツを持つ場合(カレンダーの月表示など)、
    // 共通ヘッダーは表示しない。ただしセーフエリア分の余白は#app-headerの
    // paddingとして残るので、ノッチにコンテンツが被ることはない
    if (screen.noHeader) return;

    if (screen.greeting) {
      const g = App.greeting();
      const now = new Date();
      const WD = ["日", "月", "火", "水", "木", "金", "土"];
      header.appendChild(
        App.el("div", { class: "greeting" }, [
          App.el("div", { class: "greeting__body" }, [
            App.el("p", { class: "greeting__date", text: `${now.getMonth() + 1}月${now.getDate()}日 ${WD[now.getDay()]}曜日` }),
            App.el("h1", { class: "greeting__hello", text: g.hello }),
            App.el("p", { class: "greeting__sub", text: g.sub }),
          ]),
          App.el("div", { class: "greeting__actions" }, [
            App.el("button", {
              class: "icon-btn",
              "aria-label": "お知らせ",
              html: App.icon("bell", 22),
              onclick: () => App.toast("新しいお知らせはありません", "bell"),
            }),
            (() => {
              // 頭文字アバター(家族に同名がいればその色に揃える)
              const st = App.store.state;
              const me = st.family.find((f) => f.name === st.settings.userName);
              const c = me ? App.memberColor(me.id) : { fg: "var(--color-primary)", bg: "var(--color-primary-light)" };
              return App.el("button", {
                class: "avatar avatar--initial",
                style: `border: none; cursor: pointer; background: ${c.bg}; color: ${c.fg};`,
                "aria-label": "メニューを開く",
                text: (st.settings.userName || "?").charAt(0),
                onclick: () => App.go("menu"),
              });
            })(),
          ]),
        ])
      );
      return;
    }

    const bar = App.el("div", { class: "app-header" + (screen.back ? " app-header--sub" : "") });
    if (screen.back) {
      bar.appendChild(
        App.el("button", {
          class: "icon-btn",
          "aria-label": "戻る",
          html: App.icon("back", 22),
          onclick: () => {
            if (history.length > 1) history.back();
            else App.go("home");
          },
        })
      );
    }
    bar.appendChild(App.el("h1", { class: "app-header__title", text: screen.title }));
    header.appendChild(bar);
  }

  // ---- 下部ナビ ----
  function renderNav(route) {
    const nav = document.getElementById("bottom-nav");
    nav.innerHTML = "";
    // サブ画面ではホームタブを非選択にせず、直近のタブを推定
    NAV_ITEMS.forEach((item) => {
      const active = App.screens[route].nav === item.route;
      nav.appendChild(
        App.el("button", {
          class: "nav-item",
          "aria-current": active ? "page" : null,
          "aria-label": item.label,
          html: App.icon(item.icon, 22) + `<span>${item.label}</span>`,
          onclick: () => App.go(item.route),
        })
      );
    });
  }

  // ---- 画面描画 ----
  let lastRoute = null;
  function render() {
    const route = currentRoute();
    const main = document.getElementById("screen");
    main.innerHTML = "";
    renderHeader(route);
    renderNav(route);
    App.screens[route].render(main);
    if (route !== lastRoute) {
      main.classList.remove("entering");
      void main.offsetWidth; // アニメーション再発火
      main.classList.add("entering");
      window.scrollTo(0, 0);
    }
    lastRoute = route;
  }

  // データ更新後の再描画(スクロール位置を保つ。縦横とも)
  App.refresh = function () {
    const x = window.scrollX;
    const y = window.scrollY;
    render();
    window.scrollTo(x, y);
  };

  // ---- 起動 ----
  window.addEventListener("hashchange", render);
  document.addEventListener("DOMContentLoaded", () => {
    App.store.load();
    App.initLiff(render);
  });
})();
