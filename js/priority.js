// ============================================
// 「まず確認」候補の生成 — テスト可能な純粋関数群
// ホーム(js/screens/home.js)と朝ダイジェストの考え方を揃えるための共通ロジック。
// App.priority.collect(state, opts) は状態を一切変更しない(読み取りのみ)。
// 見送り・確認の記録は settings.priorityHidden(端末ローカル・利用者ごと)に持つ。
// ============================================
window.App = window.App || {};

(function () {
  // ---- 日本語の日付・時刻のゆるい解釈(LINEインボックスの「予定にする」でも使う) ----
  // AI・外部APIは使わず、説明可能なパターンだけで解釈する。見つからなければnull。
  // 戻り値: { date: "YYYY-MM-DD"|null, time: "HH:MM"|null, cleaned: 日時表現を除いた本文 }
  App.parseJaDateTime = function (text, todayStr) {
    const t = todayStr || App.date.today();
    const base = new Date(t + "T00:00:00");
    let date = null;
    let time = null;
    let cleaned = String(text || "");

    const consume = (m) => { cleaned = cleaned.replace(m, " "); };
    const dstr = (d) => App.date.str(d);

    // 相対日(今日・明日・明後日)
    let m = cleaned.match(/今日|きょう/);
    if (m) { date = t; consume(m[0]); }
    if (!date && (m = cleaned.match(/明後日|あさって/))) {
      const d = new Date(base); d.setDate(d.getDate() + 2); date = dstr(d); consume(m[0]);
    }
    if (!date && (m = cleaned.match(/明日|あした|あす/))) {
      const d = new Date(base); d.setDate(d.getDate() + 1); date = dstr(d); consume(m[0]);
    }

    // M月D日
    if (!date && (m = cleaned.match(/(\d{1,2})月(\d{1,2})日/))) {
      const mo = Number(m[1]); const da = Number(m[2]);
      if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
        let y = base.getFullYear();
        const cand = new Date(y, mo - 1, da);
        if (dstr(cand) < t) cand.setFullYear(y + 1); // 過去なら来年扱い
        date = dstr(cand); consume(m[0]);
      }
    }
    // M/D(2026/07/20 や 7/20)
    if (!date && (m = cleaned.match(/(?:(\d{4})[\/年])?(\d{1,2})\/(\d{1,2})(?!\d)/))) {
      const y = m[1] ? Number(m[1]) : base.getFullYear();
      const mo = Number(m[2]); const da = Number(m[3]);
      if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
        const cand = new Date(y, mo - 1, da);
        if (!m[1] && dstr(cand) < t) cand.setFullYear(y + 1);
        date = dstr(cand); consume(m[0]);
      }
    }
    // (来週)◯曜(日)
    if (!date && (m = cleaned.match(/(来週)?(月|火|水|木|金|土|日)曜日?/))) {
      const WD = ["日", "月", "火", "水", "木", "金", "土"];
      const target = WD.indexOf(m[2]);
      const d = new Date(base);
      let diff = (target - d.getDay() + 7) % 7;
      if (diff === 0) diff = 7; // 「金曜」は次の金曜と解釈
      if (m[1]) diff += diff <= 0 ? 7 : 0;
      d.setDate(d.getDate() + diff);
      date = dstr(d); consume(m[0]);
    }

    // 時刻 HH:MM / H時(半)
    if ((m = cleaned.match(/(\d{1,2})[::](\d{2})/))) {
      const h = Number(m[1]); const mi = Number(m[2]);
      if (h <= 23 && mi <= 59) { time = `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`; consume(m[0]); }
    }
    if (!time && (m = cleaned.match(/(午前|午後|朝|夜)?\s*(\d{1,2})時(半)?/))) {
      let h = Number(m[2]);
      if ((m[1] === "午後" || m[1] === "夜") && h < 12) h += 12;
      if (h <= 23) { time = `${String(h).padStart(2, "0")}:${m[3] ? "30" : "00"}`; consume(m[0]); }
    }

    cleaned = cleaned.replace(/\s+/g, " ").trim();
    return { date, time, cleaned };
  };

  // ---- 自分(表示名と同名の家族メンバー)のID。見つからなければnull ----
  function myMemberId(state) {
    const name = state.settings && state.settings.userName;
    if (!name) return null;
    const me = (state.family || []).find((f) => f.name === name);
    return me ? me.id : null;
  }

  // ---- 「まず確認」候補の生成(純粋関数) ----
  // state: App.store.state 相当 / opts: { today, nowMinutes, hidden(Set of key), limit }
  // 戻り値: [{ key, refType, refId, title, timeLabel, reason, memberIds, kind }]
  //   kind: "event-soon" | "event-changed" | "event-important" | "event-unassigned"
  //       | "prep-items" | "task-due" | "task-mine" | "plant-care"
  function collect(state, opts) {
    opts = opts || {};
    const today = opts.today || App.date.today();
    const now = opts.nowMinutes !== undefined
      ? opts.nowMinutes
      : new Date().getHours() * 60 + new Date().getMinutes();
    const hidden = opts.hidden || new Set();
    const limit = opts.limit || 3;
    const me = myMemberId(state);
    const yesterdayMs = new Date(today + "T00:00:00").getTime() - 86400000;

    const covers = (e, ds) => (e.endDate ? e.date <= ds && ds <= e.endDate : e.date === ds);
    const timeToMin = (hm) => {
      const p = (hm || "").split(":");
      return p.length === 2 ? Number(p[0]) * 60 + Number(p[1]) : null;
    };
    const out = [];
    const seen = new Set(); // 同じ予定・タスクを別理由で重複させない(先勝ち=スコア順で追加する)
    const add = (c) => {
      const dedupe = c.refType + ":" + c.refId;
      if (seen.has(dedupe) || hidden.has(c.key)) return;
      seen.add(dedupe);
      out.push(c);
    };

    const events = state.events || [];
    const tasks = state.tasks || [];
    const todayEvents = events
      .filter((e) => covers(e, today))
      .sort((a, b) => (a.time || "").localeCompare(b.time || ""));

    // 1. 明示的に重要指定された今日の予定
    todayEvents.forEach((e) => {
      if (!e.important) return;
      add({
        key: "imp-" + e.id, refType: "event", refId: e.id, kind: "event-important",
        title: e.title, timeLabel: e.time || "終日", reason: "大事な予定",
        memberIds: e.memberIds || [], event: e,
      });
    });

    // 2. 前日以降に変更された今日の予定(変更のたびにkeyが変わり、確認後もまた出る)
    todayEvents.forEach((e) => {
      if (!e.updatedAt || e.updatedAt < yesterdayMs) return;
      add({
        key: "chg-" + e.id + "-" + e.updatedAt, refType: "event", refId: e.id, kind: "event-changed",
        title: e.title, timeLabel: e.time || "終日", reason: "今日変更あり",
        memberIds: e.memberIds || [], event: e,
      });
    });

    // 3. 2時間以内に始まる今日の予定
    todayEvents.forEach((e) => {
      const start = timeToMin(e.time);
      if (start === null) return;
      const diff = start - now;
      if (diff < 0 || diff > 120) return;
      add({
        key: "soon-" + e.id + "-" + today, refType: "event", refId: e.id, kind: "event-soon",
        title: e.title, timeLabel: e.time, reason: "もうすぐ",
        memberIds: e.memberIds || [], event: e,
      });
    });

    // 4. 自分が担当のやること(今日期限または期限切れ)・自分が担当の今日の予定準備
    if (me) {
      tasks.forEach((tk) => {
        if (tk.done || tk.assignedTo !== me) return;
        if (tk.due && tk.due > today) return;
        add({
          key: "mine-" + tk.id + "-" + today, refType: "task", refId: tk.id, kind: "task-mine",
          title: tk.title, timeLabel: tk.due ? "今日まで" : "いつでも", reason: "あなたの担当",
          memberIds: [me], task: tk,
        });
      });
      todayEvents.forEach((e) => {
        if (!e.preparation || e.preparation.assignedTo !== me) return;
        if (e.preparation.status === "completed" || e.preparation.status === "skipped") return;
        add({
          key: "mine-ev-" + e.id + "-" + today, refType: "event", refId: e.id, kind: "event-important",
          title: e.title + "の準備", timeLabel: e.time || "終日", reason: "あなたの担当",
          memberIds: [me], event: e,
        });
      });
    }

    // 5. 未確認の持ち物(今日・明日の予定で、チェックされていない持ち物が残っている)
    const tomorrow = (() => { const d = new Date(today + "T00:00:00"); d.setDate(d.getDate() + 1); return App.date.str(d); })();
    events.forEach((e) => {
      const p = e.preparation;
      if (!p || !(p.items || []).length) return;
      if (p.status === "completed" || p.status === "skipped") return;
      if (!covers(e, today) && !covers(e, tomorrow)) return;
      const unchecked = p.items.filter((it) => !it.checked).length;
      if (!unchecked) return;
      add({
        key: "prep-" + e.id + "-" + today, refType: "event", refId: e.id, kind: "prep-items",
        title: e.title + "の持ち物(のこり" + unchecked + "つ)",
        timeLabel: covers(e, today) ? (e.time || "今日") : "明日", reason: "準備を確認",
        memberIds: e.memberIds || [], event: e,
      });
    });

    // 6. 担当未定の重要予定(今日〜3日先)
    events.forEach((e) => {
      if (!e.important) return;
      const in3days = (() => { const d = new Date(today + "T00:00:00"); d.setDate(d.getDate() + 3); return App.date.str(d); })();
      if (e.date < today || e.date > in3days) return;
      const assigned = e.preparation && e.preparation.assignedTo;
      if (assigned) return;
      add({
        key: "unassigned-" + e.id + "-" + today, refType: "event", refId: e.id, kind: "event-unassigned",
        title: e.title, timeLabel: e.date === today ? (e.time || "今日") : App.fmtDateShort(e.date),
        reason: "準備を確認", memberIds: e.memberIds || [], event: e,
      });
    });

    // 7. 今日が期限(または期限切れ)の未完了やること
    tasks
      .filter((tk) => !tk.done && tk.due && tk.due <= today)
      .sort((a, b) => (a.due || "").localeCompare(b.due || ""))
      .forEach((tk) => {
        add({
          key: "due-" + tk.id + "-" + today, refType: "task", refId: tk.id, kind: "task-due",
          title: tk.title, timeLabel: tk.due < today ? "期限を確認" : "今日まで",
          reason: "今日が期限", memberIds: tk.assignedTo ? [tk.assignedTo] : [], task: tk,
        });
      });

    // 8. 今日必要な植物のお世話
    (App.data && App.data.plantCareItems ? App.data.plantCareItems() : []).forEach((p) => {
      add({
        key: "plant-" + p.id + "-" + today, refType: "plant", refId: p.id, kind: "plant-care",
        title: p.title, timeLabel: "今日", reason: "今日のお世話",
        memberIds: [], plant: p,
      });
    });

    return out.slice(0, limit);
  }

  // ---- 見送り・確認の記録(端末ローカル。同じ日のあいだだけ有効) ----
  function hiddenSet(state, today) {
    const t = today || App.date.today();
    return new Set(
      ((state.settings && state.settings.priorityHidden) || [])
        .filter((h) => h.date === t)
        .map((h) => h.key)
    );
  }

  // key を今日の分として非表示にする(古い日の記録は同時に掃除する)
  function hide(key, kind) {
    const t = App.date.today();
    App.store.update((st) => {
      const list = (st.settings.priorityHidden || []).filter((h) => h.date === t);
      if (!list.some((h) => h.key === key)) list.push({ date: t, key, kind: kind || "dismiss" });
      st.settings.priorityHidden = list;
    });
  }

  App.priority = { collect, hiddenSet, hide, myMemberId };
})();
