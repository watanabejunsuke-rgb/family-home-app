// ============================================
// わが家ホーム — バックエンド(Google Apps Script)
// 世帯データ同期。フロントの store.load()/save() から呼ばれる。
//
// 秘密情報はここ(スクリプトプロパティ)にだけ置く。フロント(公開リポジトリ)には置かない。
// 必要なスクリプトプロパティ:
//   SHEET_ID               … データを保存するスプレッドシートのID
//   LINE_LOGIN_CHANNEL_ID  … LIFF(LINEログイン)チャネルのチャネルID(IDトークン検証用)
// (プッシュ通知を足すときに MESSAGING_CHANNEL_TOKEN を追加する)
//
// デプロイ: ウェブアプリ / 実行するユーザー=自分 / アクセスできるユーザー=全員
// セットアップ手順は backend/README.md を参照。
// ============================================

var PROP = PropertiesService.getScriptProperties();
var SHEET_NAME = 'households';
// 列: A householdId | B inviteCode | C members(JSON配列) | D data(JSON) | E updatedAt(ms)

function doGet() {
  return json({ ok: true, service: 'wagaya-home backend', ts: Date.now() });
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
    throw new Error('IDトークンの検証に失敗しました');
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
