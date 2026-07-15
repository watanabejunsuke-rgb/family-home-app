// ============================================
// 暮らしnote — バックエンド(Google Apps Script)
// 世帯データ同期 + 毎朝のLINEプッシュ通知(ダイジェスト)。
// 同期はフロントの store.load()/save() から呼ばれる。プッシュは時間主導
// トリガー(sendDailyDigest)から呼ばれる。
//
// 秘密情報はここ(スクリプトプロパティ)にだけ置く。フロント(公開リポジトリ)には置かない。
// 必要なスクリプトプロパティ:
//   SHEET_ID                 … データを保存するスプレッドシートのID
//   LINE_LOGIN_CHANNEL_ID    … LIFF(LINEログイン)チャネルのチャネルID(IDトークン検証用)
//   MESSAGING_CHANNEL_TOKEN … LINE公式アカウント(Messaging APIチャネル)のチャネルアクセストークン
//                              (毎朝のプッシュ通知に使用。未設定ならsendDailyDigestは何もしない)
//
// デプロイ: ウェブアプリ / 実行するユーザー=自分 / アクセスできるユーザー=全員
// セットアップ手順は backend/README.md を参照。
// ============================================

var PROP = PropertiesService.getScriptProperties();
var SHEET_NAME = 'households';
// 列: A householdId | B inviteCode | C members(JSON配列) | D data(JSON) | E updatedAt(ms)

function doGet() {
  return json({ ok: true, service: 'kurashi-note backend', ts: Date.now() });
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var userId = verifyIdToken(body.idToken); // 不正なら例外
    var action = body.action;
    var result;
    if (action === 'create') result = createHousehold(userId, body.data);
    else if (action === 'join') result = joinHousehold(userId, body.inviteCode);
    else if (action === 'pull') result = pull(userId);
    else if (action === 'push') result = push(userId, body.data);
    else if (action === 'leave') result = leaveHousehold(userId);
    else throw new Error('unknown action: ' + action);
    return json(Object.assign({ ok: true }, result));
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- 認証: LINE IDトークンを検証して userId(sub) を得る ----
function verifyIdToken(idToken) {
  if (!idToken) throw new Error('idTokenがありません');
  var channelId = PROP.getProperty('LINE_LOGIN_CHANNEL_ID');
  if (!channelId) throw new Error('LINE_LOGIN_CHANNEL_ID 未設定');
  var res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post',
    payload: { id_token: idToken, client_id: channelId },
    muteHttpExceptions: true,
  });
  var data = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() !== 200 || !data.sub) {
    // 原因切り分け用: LINE側の実際の応答を実行ログに残す(「実行数」から確認できる)
    Logger.log('verify failed: code=' + res.getResponseCode() + ' body=' + res.getContentText());
    throw new Error('IDトークンの検証に失敗しました: ' + res.getContentText());
  }
  return data.sub; // LINE userId
}

// ---- シート操作 ----
function sheet() {
  var id = PROP.getProperty('SHEET_ID');
  if (!id) throw new Error('SHEET_ID 未設定');
  var sh = SpreadsheetApp.openById(id).getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('シート "' + SHEET_NAME + '" がありません');
  return sh;
}

// 全行を読み、{row, householdId, inviteCode, members, data, updatedAt} の配列で返す(ヘッダー除く)
function readAll(sh) {
  var values = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (!r[0]) continue;
    out.push({
      row: i + 1,
      householdId: String(r[0]),
      inviteCode: String(r[1]),
      members: parseJson(r[2], []),
      data: parseJson(r[3], null),
      updatedAt: Number(r[4]) || 0,
    });
  }
  return out;
}

function parseJson(s, fallback) {
  try { return s ? JSON.parse(s) : fallback; } catch (e) { return fallback; }
}

function findByUser(rows, userId) {
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].members.indexOf(userId) >= 0) return rows[i];
  }
  return null;
}

function newInviteCode() {
  // 紛らわしい文字(0/O,1/I)を除いた6桁
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var s = '';
  for (var i = 0; i < 6; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

// ---- アクション ----
function createHousehold(userId, data) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet();
    var rows = readAll(sh);
    // 既にどこかの世帯にいるなら、それを返す(二重作成を防ぐ)
    var existing = findByUser(rows, userId);
    if (existing) return { householdId: existing.householdId, inviteCode: existing.inviteCode, data: existing.data, updatedAt: existing.updatedAt, already: true };

    var householdId = Utilities.getUuid();
    var codes = rows.map(function (r) { return r.inviteCode; });
    var code;
    do { code = newInviteCode(); } while (codes.indexOf(code) >= 0);
    var now = Date.now();
    sh.appendRow([householdId, code, JSON.stringify([userId]), JSON.stringify(data || null), now]);
    return { householdId: householdId, inviteCode: code, data: data || null, updatedAt: now };
  } finally {
    lock.releaseLock();
  }
}

function joinHousehold(userId, inviteCode) {
  if (!inviteCode) throw new Error('招待コードがありません');
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet();
    var rows = readAll(sh);
    var target = null;
    var code = String(inviteCode).trim().toUpperCase();
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].inviteCode.toUpperCase() === code) { target = rows[i]; break; }
    }
    if (!target) throw new Error('招待コードが見つかりません');
    if (target.members.indexOf(userId) < 0) {
      target.members.push(userId);
      sh.getRange(target.row, 3).setValue(JSON.stringify(target.members));
    }
    return { householdId: target.householdId, inviteCode: target.inviteCode, data: target.data, updatedAt: target.updatedAt };
  } finally {
    lock.releaseLock();
  }
}

function pull(userId) {
  var sh = sheet();
  var target = findByUser(readAll(sh), userId);
  if (!target) return { household: null };
  return { householdId: target.householdId, inviteCode: target.inviteCode, data: target.data, updatedAt: target.updatedAt };
}

function push(userId, data) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet();
    var target = findByUser(readAll(sh), userId);
    if (!target) throw new Error('世帯に参加していません');
    var now = Date.now();
    sh.getRange(target.row, 4, 1, 2).setValues([[JSON.stringify(data), now]]);
    return { updatedAt: now };
  } finally {
    lock.releaseLock();
  }
}

function leaveHousehold(userId) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet();
    var target = findByUser(readAll(sh), userId);
    if (!target) return { left: false };
    var members = target.members.filter(function (m) { return m !== userId; });
    sh.getRange(target.row, 3).setValue(JSON.stringify(members));
    return { left: true };
  } finally {
    lock.releaseLock();
  }
}

// ============================================
// 毎朝のLINEプッシュ通知(ダイジェスト)
// フロントの App.data.notifications()(js/store.js)と同じ判定基準を
// サーバー側に移植したもの。算出仕様が食い違わないよう、変更する場合は
// 両方に反映すること。
// ============================================

// ---- 日付ユーティリティ(Asia/Tokyo基準。GASプロジェクトのタイムゾーン設定に依存しない) ----
function todayStrJST() { return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd'); }
function tomorrowStrJST() { return Utilities.formatDate(new Date(Date.now() + 86400000), 'Asia/Tokyo', 'yyyy-MM-dd'); }
function fmtDateJP(dateStr) {
  var d = new Date(dateStr + 'T00:00:00');
  return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}
function fmtShortJP(dateStr) {
  var d = new Date(dateStr + 'T00:00:00');
  return (d.getMonth() + 1) + '/' + d.getDate();
}
// 予定がdateStrを含むか(endDateがあれば期間、無ければ単日)。js/store.jsのeventCoversDateと同一仕様
function eventCoversDate(e, dateStr) {
  return e.endDate ? (e.date <= dateStr && dateStr <= e.endDate) : e.date === dateStr;
}
// 水やり残日数(0以下=そろそろ)。js/store.jsのApp.plantDaysLeftと同一仕様
function plantDaysLeftJST(p, todayStr) {
  var watered = new Date(p.wateredAt + 'T00:00:00');
  var next = new Date(watered);
  next.setDate(next.getDate() + p.cycleDays);
  var now = new Date(todayStr + 'T00:00:00');
  return Math.round((next - now) / 86400000);
}
// 植物由来の項目(水やり期限・お手入れ適期)。js/store.jsのplantCareItemsと同一仕様
function plantCareItemsJST(plants, todayStr) {
  var items = [];
  (plants || []).forEach(function (p) {
    var left = plantDaysLeftJST(p, todayStr);
    if (left <= 0) {
      items.push({
        title: '「' + p.name + '」に水やり',
        meta: left === 0 ? '今日が目安日です' : ('目安日から' + (-left) + '日たっています'),
      });
    }
    (p.careTasks || []).forEach(function (c) {
      var started = c.mode === 'range' ? c.startDate <= todayStr : c.date <= todayStr;
      if (!started) return;
      var meta;
      if (c.mode === 'range') {
        meta = todayStr <= c.endDate
          ? ('いま適期(' + fmtShortJP(c.startDate) + '〜' + fmtShortJP(c.endDate) + ')')
          : ('適期をすぎています(〜' + fmtShortJP(c.endDate) + ')');
      } else {
        meta = c.date === todayStr ? '今日が予定日です' : ('予定日をすぎています(' + fmtShortJP(c.date) + ')');
      }
      items.push({ title: '「' + p.name + '」の' + c.label, meta: meta });
    });
  });
  return items;
}

// 世帯1件分のデータから、今日のダイジェスト文面を組み立てる(何も無ければnull)
function buildDigestText(data, todayStr, tomorrowStr) {
  var lines = { task: [], event: [], plant: [], match: [] };

  (data.tasks || [])
    .filter(function (x) { return !x.done && x.due && x.due <= todayStr; })
    .sort(function (a, b) { return (a.due || '').localeCompare(b.due || ''); })
    .forEach(function (x) {
      var meta = x.due < todayStr ? ('期限切れ・' + fmtDateJP(x.due)) : '今日まで';
      lines.task.push(x.title + '(' + meta + ')');
    });

  (data.events || [])
    .filter(function (e) { return eventCoversDate(e, todayStr); })
    .sort(function (a, b) { return (a.time || '').localeCompare(b.time || ''); })
    .forEach(function (e) {
      var isMatch = e.kind === 'match';
      var title = e.title.replace(/^⚽\s*/, '');
      var meta = '今日 ' + (e.time || '終日');
      (isMatch ? lines.match : lines.event).push(title + '(' + meta + ')');
    });

  plantCareItemsJST(data.plants, todayStr).forEach(function (p) {
    lines.plant.push(p.title + '(' + p.meta + ')');
  });

  (data.events || [])
    .filter(function (e) { return e.kind === 'match' && e.date === tomorrowStr; })
    .forEach(function (e) {
      var title = e.title.replace(/^⚽\s*/, '');
      lines.match.push(title + '(明日 ' + (e.time || '') + ')');
    });

  var sections = [];
  if (lines.task.length) sections.push('📋 やること\n' + lines.task.map(function (t) { return '・' + t; }).join('\n'));
  if (lines.event.length) sections.push('📅 予定\n' + lines.event.map(function (t) { return '・' + t; }).join('\n'));
  if (lines.plant.length) sections.push('🌱 植物\n' + lines.plant.map(function (t) { return '・' + t; }).join('\n'));
  if (lines.match.length) sections.push('⚽ 試合\n' + lines.match.map(function (t) { return '・' + t; }).join('\n'));
  if (!sections.length) return null;
  return 'おはようございます。今日の暮らしnoteです。\n\n' + sections.join('\n\n');
}

// LINE Messaging APIでテキストをpush送信
function sendLinePush(userId, text, token) {
  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ to: userId, messages: [{ type: 'text', text: text }] }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    Logger.log('LINE push error (' + userId + '): ' + res.getResponseCode() + ' ' + res.getContentText());
  }
}

// 時間主導トリガーの実行対象。全世帯を見て、今日ダイジェストがある世帯だけ
// メンバー全員にpush送信する(何も無い世帯には送らない)
function sendDailyDigest() {
  var token = PROP.getProperty('MESSAGING_CHANNEL_TOKEN');
  if (!token) { Logger.log('MESSAGING_CHANNEL_TOKEN 未設定のため送信をスキップしました'); return; }
  var todayStr = todayStrJST();
  var tomorrowStr = tomorrowStrJST();
  var rows = readAll(sheet());
  rows.forEach(function (r) {
    if (!r.data || !r.members || !r.members.length) return;
    var text = buildDigestText(r.data, todayStr, tomorrowStr);
    if (!text) return;
    r.members.forEach(function (userId) {
      try { sendLinePush(userId, text, token); }
      catch (e) { Logger.log('push failed for ' + userId + ': ' + e); }
    });
  });
}

// 【セットアップ用】この関数を1回だけ手動実行すると、毎朝7時に
// sendDailyDigestを呼ぶトリガーが登録される。何度実行しても、先に同じ
// トリガーがあれば削除してから作り直すので二重登録にはならない。
// 時刻はGASプロジェクトのタイムゾーン設定に従う(プロジェクトの設定で
// Asia/Tokyoになっているか確認しておくこと)。
function createDailyDigestTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDailyDigest') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDailyDigest').timeBased().atHour(7).everyDays(1).create();
  Logger.log('毎朝7時のトリガーを作成しました');
}
