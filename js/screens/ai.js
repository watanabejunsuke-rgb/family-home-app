// ============================================
// AIに相談 — 現在はデモ応答(将来AI API連携予定)
// ============================================
window.App = window.App || {};
App.screens = App.screens || {};

(function () {
  const SUGGESTIONS = ["今晩の献立を考えて", "寝かしつけのコツは?", "週末どこに行こう?"];

  // デモ応答:キーワードに応じた定型文を返す
  function mockReply(text) {
    if (/献立|ごはん|夕飯|レシピ/.test(text))
      return "今晩は「豚肉と夏野菜の生姜炒め」はどうでしょう?15分で作れて、なす・ピーマンを消費できます。副菜は冷やしトマトで十分。買い物リストに足りない食材を追加しておくと安心です。";
    if (/寝かしつけ|夜泣き|寝ない/.test(text))
      return "おつかれさまです。寝かしつけは「部屋を暗く→同じ入眠ルーティン→大人が先に静かになる」の順が効きやすいです。うまくいかない日があって当たり前なので、抱え込まないでくださいね。";
    if (/週末|おでかけ|公園|遊び/.test(text))
      return "今週末は気温が高めの予報です。午前中の水遊びできる公園か、屋内の児童館コースがおすすめ。カレンダーに「家族でおでかけ」の予定を入れておくと、みんなで共有できますよ。";
    if (/疲れ|しんど|大変|イライラ/.test(text))
      return "毎日おつかれさまです。それだけがんばっている証拠です。今日やることは最小限にして、ひとつでも自分の時間を確保してみてください。明日のことは明日の自分に任せましょう。";
    return "なるほど、教えてくれてありがとうございます。今はデモ応答ですが、正式版ではその内容に合わせて具体的にお手伝いできるようになります。献立・寝かしつけ・週末の過ごし方などを聞くとサンプル応答が見られます。";
  }

  function bubble(msg) {
    const isUser = msg.role === "user";
    const el = App.el("div", { class: `ai-msg ${isUser ? "ai-msg--user" : "ai-msg--ai"} appear` });
    if (!isUser) el.appendChild(App.el("span", { class: "ai-msg__avatar", html: App.icon("sparkle", 15) }));
    el.appendChild(App.el("div", { class: "ai-msg__bubble", text: msg.text }));
    return el;
  }

  App.screens.ai = {
    title: "AIに相談",
    back: true,

    render(container) {
      const wrap = App.el("div", { class: "ai-screen" });

      wrap.appendChild(
        App.el("div", { class: "ai-notice" }, [
          App.el("span", { html: App.icon("info", 15) }),
          App.el("span", { text: "現在はデモ応答です。正式版でAIとつながります。" }),
        ])
      );

      const log = App.el("div", { class: "ai-log" });
      App.store.state.aiChat.forEach((m) => log.appendChild(bubble(m)));

      // 提案チップ(会話が少ないときだけ)
      if (App.store.state.aiChat.length <= 2) {
        const chips = App.el("div", { class: "chip-row", style: "margin-bottom: var(--spacing-3);" });
        SUGGESTIONS.forEach((sug) => {
          chips.appendChild(App.el("button", { class: "chip", text: sug, onclick: () => send(sug) }));
        });
        log.appendChild(chips);
      }
      wrap.appendChild(log);

      // ---- 入力 ----
      const input = App.el("input", { type: "text", placeholder: "メッセージを入力", "aria-label": "相談内容" });
      const sendBtn = App.el("button", { "aria-label": "送信", html: App.icon("send", 20) });
      const inputRow = App.el("div", { class: "ai-input" }, [input, sendBtn]);
      wrap.appendChild(inputRow);
      container.appendChild(wrap);

      const scrollToEnd = () => {
        requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));
      };

      function send(text) {
        const msg = (text || input.value).trim();
        if (!msg) return;
        input.value = "";
        sendBtn.disabled = true;

        // 提案チップを消す
        const chipRow = log.querySelector(".chip-row");
        if (chipRow) chipRow.remove();

        const userMsg = { role: "user", text: msg, at: Date.now() };
        App.store.state.aiChat.push(userMsg);
        App.store.save();
        log.appendChild(bubble(userMsg));
        scrollToEnd();

        // 入力中インジケーター → デモ応答
        const typing = App.el("div", { class: "ai-msg ai-msg--ai" }, [
          App.el("span", { class: "ai-msg__avatar", html: App.icon("sparkle", 15) }),
          App.el("div", { class: "ai-msg__bubble", html: '<span class="ai-typing"><span></span><span></span><span></span></span>' }),
        ]);
        log.appendChild(typing);
        scrollToEnd();

        setTimeout(() => {
          typing.remove();
          const aiMsg = { role: "ai", text: mockReply(msg), at: Date.now() };
          App.store.state.aiChat.push(aiMsg);
          App.store.save();
          log.appendChild(bubble(aiMsg));
          sendBtn.disabled = false;
          scrollToEnd();
        }, 900);
      }

      sendBtn.addEventListener("click", () => send());
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
      scrollToEnd();
    },
  };
})();
