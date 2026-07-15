// ============================================
// 暮らしnote — バックエンド(Google Apps Script)
// 世帯データ同期 + 毎朝のLINEプッシュ通知(ダイジェスト) + 植物の写真登録(Drive保存)。
// 同期はフロントの store.load()/save() から呼ばれる。プッシュは時間主導
// トリガー(sendDailyDigest)から呼ばれる。
//
// 植物の写真をアップロードする関数(uploadPlantPhoto)を初めて実行すると、
// Google Driveへのアクセス許可を求める画面が出ることがある。その場合は許可すること
// (エディタで保存しただけでは反映されず、「デプロイを管理→編集→新しいバージョン」の
// 手順で再デプロイして初めて、公開中のWebアプリURLにこの変更が反映される点にも注意)。
//
// 秘密情報はここ(スクリプトプロパティ)にだけ置く。フロント(公開リポジトリ)には置かない。
// 必要なスクリプトプロパティ:
//   SHEET_ID                 … データを保存するスプレッドシートのID
//   LINE_LOGIN_CHANNEL_ID    … LIFF(LINEログイン)チャネルのチャネルID(IDトークン検証用)
//   MESSAGING_CHANNEL_TOKEN … LINE公式アカウント(Messaging APIチャネル)のチャネルアクセストークン
//                              (毎朝のプッシュ通知に使用。未設定ならsendDailyDigestは何もしない)
//   WEBHOOK_TOKEN            … LINEからの「完了にする」ボタン(postback)を受け取るための合言葉。
//                              GASのdoPost(e)はHTTPヘッダーを読めない仕様のため、LINEの署名検証の
//                              代わりに「Webhook URLの末尾に付けるクエリ文字列」で正当性を確認する。
//                              適当な英数字の長い文字列を決めてここに設定し、LINE Developersの
//                              Webhook URL欄には「(このGASのURL)?webhookToken=(同じ文字列)」を登録すること。
//
// デプロイ: ウェブアプリ / 実行するユーザー=自分 / アクセスできるユーザー=全員
// セットアップ手順は backend/README.md を参照。
// ============================================

var PROP = PropertiesService.getScriptProperties();
var SHEET_NAME = 'households';
// 列: A householdId | B inviteCode | C members(JSON配列) | D data(JSON) | E updatedAt(ms)
//     | F memberPrefs(JSON、{userId: notifPrefs}。個人ごとの通知オン・オフ)

// 毎朝ダイジェストの末尾に添えるアプリ起動リンク。js/config.jsのLIFF_IDと
// 同じもの(ドメインliff.line.me固定)。LIFF_IDを変更したらここも変更すること
var LIFF_URL = 'https://liff.line.me/2010693415-ddc2Kd3X';

function doGet() {
  return json({ ok: true, service: 'kurashi-note backend', ts: Date.now() });
}

function doPost(e) {
  // LINEのWebhook(postbackボタン操作等)は、アプリ自身のAPI呼び出しと形が違う
  // ({events:[...]}を持つ・idTokenを持たない)ので、先にそちらを判定して分岐する
  var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  if (body.events) return handleLineWebhook(e, body);

  try {
    var userId = verifyIdToken(body.idToken); // 不正なら例外
    var action = body.action;
    var result;
    if (action === 'create') result = createHousehold(userId, body.data);
    else if (action === 'join') result = joinHousehold(userId, body.inviteCode);
    else if (action === 'pull') result = pull(userId);
    else if (action === 'push') result = push(userId, body.data);
    else if (action === 'leave') result = leaveHousehold(userId);
    else if (action === 'setNotifPrefs') result = setNotifPrefs(userId, body.prefs);
    else if (action === 'uploadPlantPhoto') result = uploadPlantPhoto(userId, body.plantId, body.mimeType, body.dataBase64, body.filename);
    else if (action === 'deletePlantPhoto') result = deletePlantPhoto(userId, body.fileId);
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

// 全行を読み、{row, householdId, inviteCode, members, data, updatedAt, memberPrefs} の
// 配列で返す(ヘッダー除く)。列F(memberPrefs)は既存シートに無くても空扱いで安全に動く
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
      memberPrefs: parseJson(r[5], {}), // { userId: {task,event,plant,match} }
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

// 個人ごとの通知オン・オフ(settings.notifPrefs)をサーバーに保存する。
// 世帯の共有dataとは別に、userIdごとの好みとしてmemberPrefsへ格納
function setNotifPrefs(userId, prefs) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet();
    var target = findByUser(readAll(sh), userId);
    if (!target) throw new Error('世帯に参加していません');
    var allPrefs = target.memberPrefs || {};
    allPrefs[userId] = prefs || {};
    sh.getRange(target.row, 6).setValue(JSON.stringify(allPrefs));
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ============================================
// LINE Webhook — 毎朝のダイジェストに付けた「完了」ボタン(postback)の受け口。
// GASのdoPost(e)はHTTPヘッダーを読めないため、LINEの署名検証の代わりに
// クエリ文字列のWEBHOOK_TOKENで正当性を確認する(ヘッダーが使えない制約への対処)。
// ============================================
function handleLineWebhook(e, body) {
  var expected = PROP.getProperty('WEBHOOK_TOKEN');
  if (!expected || !e.parameter || e.parameter.webhookToken !== expected) {
    // ここでエラーを投げるとLINE側にリトライされ続けるので、静かに200を返す
    Logger.log('webhook token mismatch');
    return json({ ok: true });
  }
  (body.events || []).forEach(function (ev) {
    try { handleLineEvent(ev); } catch (err) { Logger.log('line event failed: ' + err); }
  });
  return json({ ok: true });
}

function handleLineEvent(ev) {
  if (ev.type !== 'postback') return; // テキストメッセージ等には反応しない(通知専用ボットのため)
  var userId = ev.source && ev.source.userId;
  if (!userId) return;
  var data = parsePostbackData(ev.postback && ev.postback.data);
  var msg = null;
  if (data.type === 'task') msg = completeTaskViaLine(userId, data.id);
  else if (data.type === 'water') msg = completePlantWaterViaLine(userId, data.id);
  else if (data.type === 'care') msg = completePlantCareViaLine(userId, data.id, data.cid);
  if (msg && ev.replyToken) {
    var token = PROP.getProperty('MESSAGING_CHANNEL_TOKEN');
    if (token) replyLineText(ev.replyToken, msg, token);
  }
}

// "type=task&id=xxxx" 形式のクエリ文字列をパースする(postback.dataの制約上、
// JSONではなくクエリ文字列形式にしている)
function parsePostbackData(str) {
  var out = {};
  (str || '').split('&').forEach(function (kv) {
    var idx = kv.indexOf('=');
    if (idx < 0) return;
    out[decodeURIComponent(kv.slice(0, idx))] = decodeURIComponent(kv.slice(idx + 1));
  });
  return out;
}

// 世帯データ(households.data)を直接読み書きする共通処理。
// pull/pushはフロントの操作を前提にした形なので、Webhookからの直接更新用に別関数にする
function withHouseholdData(userId, fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet();
    var target = findByUser(readAll(sh), userId);
    if (!target || !target.data) return null;
    var msg = fn(target.data);
    if (msg) sh.getRange(target.row, 4, 1, 2).setValues([[JSON.stringify(target.data), Date.now()]]);
    return msg;
  } finally {
    lock.releaseLock();
  }
}

function completeTaskViaLine(userId, taskId) {
  return withHouseholdData(userId, function (data) {
    var t = (data.tasks || []).filter(function (x) { return x.id === taskId; })[0];
    if (!t) return '見つかりませんでした(既に対応済みかもしれません)';
    if (t.done) return '「' + t.title + '」は既に完了しています';
    t.done = true;
    return '「' + t.title + '」を完了にしました';
  });
}

function completePlantWaterViaLine(userId, plantId) {
  return withHouseholdData(userId, function (data) {
    var p = (data.plants || []).filter(function (x) { return x.id === plantId; })[0];
    if (!p) return '見つかりませんでした(既に対応済みかもしれません)';
    p.wateredAt = todayStrJST();
    return '「' + p.name + '」に水やりしました';
  });
}

function completePlantCareViaLine(userId, plantId, careId) {
  return withHouseholdData(userId, function (data) {
    var p = (data.plants || []).filter(function (x) { return x.id === plantId; })[0];
    if (!p) return '見つかりませんでした(既に対応済みかもしれません)';
    var care = (p.careTasks || []).filter(function (c) { return c.id === careId; })[0];
    if (!care) return '「' + p.name + '」は既に対応済みかもしれません';
    p.careTasks = (p.careTasks || []).filter(function (c) { return c.id !== careId; });
    if (!p.careLog) p.careLog = [];
    p.careLog.push({ label: care.label, doneAt: todayStrJST() });
    return '「' + p.name + '」の' + care.label + 'を完了にしました';
  });
}

// LINE Messaging APIで返信(reply)する。push(sendLinePush)と違い replyToken は
// そのイベント1回限りでしか使えない
function replyLineText(replyToken, text, token) {
  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: text }] }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    Logger.log('LINE reply error: ' + res.getResponseCode() + ' ' + res.getContentText());
  }
}

// ============================================
// 植物の写真登録 — Googleドライブに保存し、URLだけをフロントのplant.photosに持たせる
// (base64のまま同期データに入れるとスプレッドシートの1セル5万文字上限に即当たるため)
// 初回実行時にDriveの認可(スコープ追加)を求められることがある。求められたら許可すること。
// ============================================

// 写真の保存先フォルダ(世帯ごとにサブフォルダを分ける)。無ければ作る
function getPhotoFolder(householdId) {
  var rootName = 'kurashi-note-plant-photos';
  var roots = DriveApp.getFoldersByName(rootName);
  var root = roots.hasNext() ? roots.next() : DriveApp.createFolder(rootName);
  var subs = root.getFoldersByName(householdId);
  return subs.hasNext() ? subs.next() : root.createFolder(householdId);
}

// 画像(base64)をアップロードし、「リンクを知っている全員が閲覧可」で共有してURLを返す
// (LINEアプリ内ブラウザにはGoogleアカウントのログイン状態が無いため、限定共有だと表示できない)
function uploadPlantPhoto(userId, plantId, mimeType, dataBase64, filename) {
  var target = findByUser(readAll(sheet()), userId);
  if (!target) throw new Error('世帯に参加していません');
  if (!plantId || !dataBase64) throw new Error('必要な情報が不足しています');
  var mime = mimeType || 'image/jpeg';
  var bytes = Utilities.base64Decode(dataBase64);
  var blob = Utilities.newBlob(bytes, mime, (filename || 'plant-photo') + '.jpg');
  var folder = getPhotoFolder(target.householdId);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var id = file.getId();
  return { id: id, url: 'https://lh3.googleusercontent.com/d/' + id };
}

// 写真を削除(Driveのゴミ箱へ)。既に無い場合は無視する
function deletePlantPhoto(userId, fileId) {
  var target = findByUser(readAll(sheet()), userId);
  if (!target) throw new Error('世帯に参加していません');
  if (!fileId) throw new Error('fileIdがありません');
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (e) {
    // 既に削除済み・権限エラー等は静かに無視(フロント側の表示からは消える)
  }
  return { deleted: true };
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

// 予定の「誰の予定か」。家族全員が対象(=「みんな」)ならnull(付けない)、
// 一部のメンバーだけが対象なら名前を「・」区切りで返す
function whoSuffix(e, family) {
  var ids = e.memberIds || [];
  if (!family || !family.length) return null;
  var allIncluded = family.every(function (m) { return ids.indexOf(m.id) >= 0; });
  if (allIncluded) return null;
  var names = ids
    .map(function (id) {
      var m = family.filter(function (f) { return f.id === id; })[0];
      return m ? m.name : null;
    })
    .filter(Boolean);
  return names.length ? names.join('・') : null;
}

// ============================================
// 天気ひとこと — 気象庁(JMA)の公式API(無料・キー不要)から、印西市が属する
// 「千葉県北西部」(area code 120010)の今日の降水確率を取ってきて一言にする。
// 失敗しても(通信エラー・JMA側の構造変更等)nullを返すだけで、ダイジェスト自体は動く。
// ============================================
function fetchWeatherOneLiner() {
  try {
    var res = UrlFetchApp.fetch('https://www.jma.go.jp/bosai/forecast/data/forecast/120000.json', { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    var report = JSON.parse(res.getContentText())[0]; // [0]=直近の詳細レポート
    var popSeries = report.timeSeries[1]; // 6時間ごとの降水確率
    var areaIdx = -1;
    for (var i = 0; i < popSeries.areas.length; i++) {
      if (popSeries.areas[i].area.code === '120010') { areaIdx = i; break; } // 千葉県北西部(印西市を含む)
    }
    if (areaIdx < 0) return null;
    var pops = popSeries.areas[areaIdx].pops;
    var timeDefines = popSeries.timeDefines;
    var todayStr = todayStrJST();
    var maxPop = 0;
    for (var j = 0; j < timeDefines.length; j++) {
      var d = Utilities.formatDate(new Date(timeDefines[j]), 'Asia/Tokyo', 'yyyy-MM-dd');
      if (d === todayStr) maxPop = Math.max(maxPop, Number(pops[j]) || 0);
    }
    var text;
    if (maxPop >= 60) text = '☔ 傘を持って出かけると安心です(降水確率' + maxPop + '%)';
    else if (maxPop >= 30) text = '🌂 折りたたみ傘があると安心かも(降水確率' + maxPop + '%)';
    else text = '☀️ 傘は無くても大丈夫そうです(降水確率' + maxPop + '%)';
    return { text: text, date: todayStr };
  } catch (e) {
    Logger.log('weather fetch failed: ' + e);
    return null;
  }
}

// 世帯データに天気を書き込む(毎朝1回。フロントはsync pull経由でweatherを受け取る)
function updateHouseholdWeather(householdId, weather) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet();
    var target = null;
    var rows = readAll(sh);
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].householdId === householdId) { target = rows[i]; break; }
    }
    if (!target || !target.data) return;
    target.data.weather = weather;
    sh.getRange(target.row, 4, 1, 2).setValues([[JSON.stringify(target.data), Date.now()]]);
  } finally {
    lock.releaseLock();
  }
}

// 世帯1件分のデータから、あるメンバー向けの今日のダイジェスト文面を組み立てる
// (何も無ければnull)。prefsは受信者本人のsettings.notifPrefs相当
// (js/store.jsのnotifications()と同じ判定基準)
function buildDigestText(data, todayStr, tomorrowStr, prefs) {
  prefs = prefs || {};
  var on = function (cat) { return prefs[cat] !== false; };
  var lines = { task: [], event: [], plant: [], match: [] };

  if (on('task')) {
    (data.tasks || [])
      .filter(function (x) { return !x.done && x.due && x.due <= todayStr; })
      .sort(function (a, b) { return (a.due || '').localeCompare(b.due || ''); })
      .forEach(function (x) {
        var meta = x.due < todayStr ? ('期限切れ・' + fmtDateJP(x.due)) : '今日まで';
        lines.task.push(x.title + '(' + meta + ')');
      });
  }

  (data.events || [])
    .filter(function (e) { return eventCoversDate(e, todayStr); })
    .sort(function (a, b) { return (a.time || '').localeCompare(b.time || ''); })
    .forEach(function (e) {
      var isMatch = e.kind === 'match';
      if (isMatch ? !on('match') : !on('event')) return;
      var title = e.title.replace(/^⚽\s*/, '');
      var who = whoSuffix(e, data.family);
      var meta = '今日 ' + (e.time || '終日') + (who ? '・' + who : '');
      (isMatch ? lines.match : lines.event).push(title + '(' + meta + ')');
    });

  if (on('plant')) {
    plantCareItemsJST(data.plants, todayStr).forEach(function (p) {
      lines.plant.push(p.title + '(' + p.meta + ')');
    });
  }

  if (on('match')) {
    (data.events || [])
      .filter(function (e) { return e.kind === 'match' && e.date === tomorrowStr; })
      .forEach(function (e) {
        var title = e.title.replace(/^⚽\s*/, '');
        var who = whoSuffix(e, data.family);
        lines.match.push(title + '(明日 ' + (e.time || '') + (who ? '・' + who : '') + ')');
      });
  }

  var sections = [];
  if (lines.task.length) sections.push('📋 やること\n' + lines.task.map(function (t) { return '・' + t; }).join('\n'));
  if (lines.event.length) sections.push('📅 予定\n' + lines.event.map(function (t) { return '・' + t; }).join('\n'));
  if (lines.plant.length) sections.push('🌱 植物\n' + lines.plant.map(function (t) { return '・' + t; }).join('\n'));
  if (lines.match.length) sections.push('⚽ 試合\n' + lines.match.map(function (t) { return '・' + t; }).join('\n'));
  if (!sections.length) return null;
  return 'おはようございます。今日の暮らしnoteです。\n\n' + sections.join('\n\n') + '\n\n▶ アプリを開く\n' + LIFF_URL;
}

// postbackのdata文字列を組み立てる("type=task&id=xxxx"形式。JSONではなくクエリ文字列)
function buildPostbackData(action) {
  var parts = ['type=' + encodeURIComponent(action.type), 'id=' + encodeURIComponent(action.id)];
  if (action.cid) parts.push('cid=' + encodeURIComponent(action.cid));
  return parts.join('&');
}

// buildDigestTextと同じ内容を、LINEから直接「完了」を押せるFlex Message(カード形式)で組み立てる。
// やること・植物のお世話には完了ボタンを付け、予定・試合は情報表示のみ(操作不要なため)
function buildDigestFlex(data, todayStr, tomorrowStr, prefs, weather) {
  prefs = prefs || {};
  var on = function (cat) { return prefs[cat] !== false; };
  var sections = []; // [{icon, label, rows:[{text, action|null}]}]

  var taskRows = [];
  if (on('task')) {
    (data.tasks || [])
      .filter(function (x) { return !x.done && x.due && x.due <= todayStr; })
      .sort(function (a, b) { return (a.due || '').localeCompare(b.due || ''); })
      .forEach(function (x) {
        var meta = x.due < todayStr ? ('期限切れ・' + fmtDateJP(x.due)) : '今日まで';
        taskRows.push({ text: x.title + '(' + meta + ')', action: { type: 'task', id: x.id } });
      });
  }
  if (taskRows.length) sections.push({ icon: '📋', label: 'やること', rows: taskRows });

  var eventRows = [];
  var matchRows = [];
  (data.events || [])
    .filter(function (e) { return eventCoversDate(e, todayStr); })
    .sort(function (a, b) { return (a.time || '').localeCompare(b.time || ''); })
    .forEach(function (e) {
      var isMatch = e.kind === 'match';
      if (isMatch ? !on('match') : !on('event')) return;
      var title = e.title.replace(/^⚽\s*/, '');
      var who = whoSuffix(e, data.family);
      var meta = '今日 ' + (e.time || '終日') + (who ? '・' + who : '');
      (isMatch ? matchRows : eventRows).push({ text: title + '(' + meta + ')', action: null });
    });
  if (eventRows.length) sections.push({ icon: '📅', label: '予定', rows: eventRows });

  var plantRows = [];
  if (on('plant')) {
    (data.plants || []).forEach(function (p) {
      var left = plantDaysLeftJST(p, todayStr);
      if (left <= 0) {
        plantRows.push({
          text: '「' + p.name + '」に水やり(' + (left === 0 ? '今日が目安日です' : ('目安日から' + (-left) + '日')) + ')',
          action: { type: 'water', id: p.id },
        });
      }
      (p.careTasks || []).forEach(function (c) {
        var started = c.mode === 'range' ? c.startDate <= todayStr : c.date <= todayStr;
        if (!started) return;
        var meta;
        if (c.mode === 'range') {
          meta = todayStr <= c.endDate ? ('いま適期・' + fmtShortJP(c.startDate) + '〜' + fmtShortJP(c.endDate)) : ('適期すぎ・〜' + fmtShortJP(c.endDate));
        } else {
          meta = c.date === todayStr ? '今日が予定日です' : ('予定日すぎ・' + fmtShortJP(c.date));
        }
        plantRows.push({ text: '「' + p.name + '」の' + c.label + '(' + meta + ')', action: { type: 'care', id: p.id, cid: c.id } });
      });
    });
  }
  if (plantRows.length) sections.push({ icon: '🌱', label: '植物', rows: plantRows });

  if (on('match')) {
    (data.events || [])
      .filter(function (e) { return e.kind === 'match' && e.date === tomorrowStr; })
      .forEach(function (e) {
        var title = e.title.replace(/^⚽\s*/, '');
        var who = whoSuffix(e, data.family);
        matchRows.push({ text: title + '(明日 ' + (e.time || '') + (who ? '・' + who : '') + ')', action: null });
      });
  }
  if (matchRows.length) sections.push({ icon: '⚽', label: '試合', rows: matchRows });

  if (!sections.length && !weather) return null;

  var bodyContents = [];
  if (weather && weather.text) {
    bodyContents.push({ type: 'text', text: weather.text, size: 'sm', wrap: true, color: '#5E7B71' });
  }
  sections.forEach(function (sec, i) {
    if (bodyContents.length) bodyContents.push({ type: 'separator', margin: 'lg' });
    bodyContents.push({ type: 'text', text: sec.icon + ' ' + sec.label, weight: 'bold', size: 'sm', margin: bodyContents.length ? 'lg' : 'none' });
    sec.rows.forEach(function (r) {
      if (r.action) {
        bodyContents.push({
          type: 'box', layout: 'horizontal', margin: 'sm', alignItems: 'center',
          contents: [
            { type: 'text', text: r.text, size: 'sm', wrap: true, flex: 5 },
            { type: 'button', style: 'primary', color: '#5E7B71', height: 'sm', flex: 2,
              action: { type: 'postback', label: '完了', data: buildPostbackData(r.action), displayText: '完了にしました' } },
          ],
        });
      } else {
        bodyContents.push({ type: 'text', text: r.text, size: 'sm', wrap: true, margin: 'sm' });
      }
    });
  });

  return {
    type: 'bubble',
    header: {
      type: 'box', layout: 'vertical',
      contents: [
        { type: 'text', text: 'おはようございます', weight: 'bold', size: 'md' },
        { type: 'text', text: '今日の暮らしnoteです', size: 'xs', color: '#9A9A96' },
      ],
    },
    body: { type: 'box', layout: 'vertical', contents: bodyContents },
    footer: {
      type: 'box', layout: 'vertical',
      contents: [{ type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: 'アプリを開く', uri: LIFF_URL } }],
    },
  };
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

// LINE Messaging APIでFlex Message(カード+ボタン)をpush送信。altTextは通知プレビュー用の代替文
function sendLineFlex(userId, altText, flex, token) {
  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ to: userId, messages: [{ type: 'flex', altText: altText, contents: flex }] }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    Logger.log('LINE flex push error (' + userId + '): ' + res.getResponseCode() + ' ' + res.getContentText());
  }
}

// 時間主導トリガーの実行対象。全世帯を見て、天気を書き込み(通知トークン未設定でもここは行う)、
// 今日ダイジェストがある世帯だけメンバーごとに、本人の通知設定(memberPrefs)に応じた
// Flex Message(「完了」ボタン付き)を送る(世帯共通ではなく受信者ごとに文面が変わりうる)
function sendDailyDigest() {
  var token = PROP.getProperty('MESSAGING_CHANNEL_TOKEN');
  var todayStr = todayStrJST();
  var tomorrowStr = tomorrowStrJST();
  var weather = fetchWeatherOneLiner(); // 取得できなければnull(ダイジェスト自体は止めない)
  var rows = readAll(sheet());
  rows.forEach(function (r) {
    if (!r.data || !r.members || !r.members.length) return;
    if (weather) updateHouseholdWeather(r.householdId, weather);
    if (!token) return; // MESSAGING_CHANNEL_TOKEN未設定なら天気の書き込みだけ行いプッシュはしない
    r.members.forEach(function (userId) {
      var prefs = (r.memberPrefs && r.memberPrefs[userId]) || {};
      var flex = buildDigestFlex(r.data, todayStr, tomorrowStr, prefs, weather);
      if (!flex) return;
      try { sendLineFlex(userId, 'おはようございます。今日の暮らしnoteです。', flex, token); }
      catch (e) { Logger.log('push failed for ' + userId + ': ' + e); }
    });
  });
}

// 【セットアップ用】この関数を1回だけ手動実行すると、毎朝6時台(6:00〜7:00の
// 間のどこか。GASの時間主導トリガーは分単位を指定できない仕様)に
// sendDailyDigestを呼ぶトリガーが登録される。何度実行しても、先に同じ
// トリガーがあれば削除してから作り直すので二重登録にはならない。
// 時刻はGASプロジェクトのタイムゾーン設定に従う(プロジェクトの設定で
// Asia/Tokyoになっているか確認しておくこと)。
// ※時刻だけ変えたい場合は、コードを直さずGAS画面の「トリガー」一覧から
// 該当トリガーを編集するだけでも変更できる。
function createDailyDigestTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDailyDigest') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDailyDigest').timeBased().atHour(6).everyDays(1).create();
  Logger.log('毎朝6時台のトリガーを作成しました');
}
