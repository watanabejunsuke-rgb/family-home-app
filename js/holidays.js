// ============================================
// 日本の祝日 — 振替休日・国民の休日を含めて計算する。
// 春分/秋分は近似式(2000〜2099年で有効な式)を使用。
// 固定日・ハッピーマンデーの祝日は現行の祝日法(2016年以降)に準拠。
// ============================================
window.App = window.App || {};

(function () {
  const pad = (n) => String(n).padStart(2, "0");
  const toStr = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

  // その月の第n月曜日(1始まり)の日を返す
  function nthMonday(year, month, n) {
    const first = new Date(year, month - 1, 1);
    const offsetToFirstMonday = (8 - first.getDay()) % 7;
    return 1 + offsetToFirstMonday + (n - 1) * 7;
  }

  // 春分の日・秋分の日(国立天文台の計算に概ね一致する近似式)
  function vernalEquinoxDay(year) {
    return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }
  function autumnalEquinoxDay(year) {
    return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }

  function addDays(dateStr, n) {
    const d = new Date(dateStr + "T00:00:00");
    d.setDate(d.getDate() + n);
    return toStr(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  function buildYear(year) {
    const base = [];
    const add = (m, d, name) => base.push({ date: toStr(year, m, d), name });

    add(1, 1, "元日");
    add(1, nthMonday(year, 1, 2), "成人の日");
    add(2, 11, "建国記念の日");
    add(2, 23, "天皇誕生日");
    add(3, vernalEquinoxDay(year), "春分の日");
    add(4, 29, "昭和の日");
    add(5, 3, "憲法記念日");
    add(5, 4, "みどりの日");
    add(5, 5, "こどもの日");
    add(7, nthMonday(year, 7, 3), "海の日");
    add(8, 11, "山の日");
    add(9, nthMonday(year, 9, 3), "敬老の日");
    add(9, autumnalEquinoxDay(year), "秋分の日");
    add(10, nthMonday(year, 10, 2), "スポーツの日");
    add(11, 3, "文化の日");
    add(11, 23, "勤労感謝の日");

    const byDate = new Map(base.map((h) => [h.date, h.name]));

    // 振替休日: 日曜の祝日の直後で、まだ祝日でない最初の平日
    base.forEach((h) => {
      if (new Date(h.date + "T00:00:00").getDay() !== 0) return;
      let cursor = addDays(h.date, 1);
      while (byDate.has(cursor)) cursor = addDays(cursor, 1);
      byDate.set(cursor, "振替休日");
    });

    // 国民の休日: 前後を祝日に挟まれた、日曜以外の平日
    for (let d = new Date(year, 0, 1); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
      const ds = toStr(d.getFullYear(), d.getMonth() + 1, d.getDate());
      if (byDate.has(ds) || d.getDay() === 0) continue;
      if (byDate.has(addDays(ds, -1)) && byDate.has(addDays(ds, 1))) {
        byDate.set(ds, "国民の休日");
      }
    }

    return byDate;
  }

  const cache = {};
  function yearMap(year) {
    if (!cache[year]) cache[year] = buildYear(year);
    return cache[year];
  }

  // 祝日なら名称、そうでなければnullを返す
  App.holidayName = function (dateStr) {
    const year = Number(dateStr.slice(0, 4));
    return yearMap(year).get(dateStr) || null;
  };
})();
