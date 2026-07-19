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
//   AI_CONSULT_TOKEN          … ChatGPT(GPT Actions)からの植物相談の読み書きを許可する合言葉。
//                              LINEログインを経由できないChatGPT側は、これをリクエストに含めて認証する
//                              (詳細は backend/plant-consult-gpt-setup.md)。適当な英数字の長い文字列でよい。
//   AI_CONSULT_HOUSEHOLD_ID   … 任意。世帯が複数ある場合のみ、相談を紐付ける対象の世帯IDを指定する。
//                              世帯が1件しか無ければ未設定でよい(自動でその世帯を使う)。
//
// ---- v0.36.0 で追加された任意のプロパティ(未設定=すべてOFF=従来どおりの動作) ----
//   FLAG_LINE_INBOX          … 'true' でLINEのテキストメッセージ受信(家族インボックス)を有効化
//   FLAG_LINE_MESSAGE_QUOTA  … 'true' で月200通クォータの管理(共通送信関数・送信ログ)を有効化
//   FLAG_PRODUCT_ANALYTICS   … 'true' で匿名の利用計測(product_eventsシート)を有効化
//   QUOTA_COUNT_REPLIES      … 'false' にすると返信(reply)をクォータに数えない。
//                              既定は数える(安全側)。LINEの仕様変更時にここだけ変えればよい
//   QUOTA_MONTHLY_LIMIT      … 月の上限通数の上書き(既定200)。プラン変更時用
//
// 新機能を使う前に、エディタから setupNewFeatures() を1回実行すること
// (message_quota / line_message_log / webhook_events / product_events シートを作る。
//  何度実行しても壊れない・既存シートは削除しない)。
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

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (!action) return json({ ok: true, service: 'kurashi-note backend', ts: Date.now() });

  // ChatGPT(GPT Actions)からの読み取り専用アクセス。LINEログインが無いのでトークンで認証する
  try {
    verifyConsultToken(e.parameter.token);
    var result;
    if (action === 'listPlants') result = { plants: listPlantsForConsult(e.parameter.query) };
    else if (action === 'getPlantContext') result = { context: getPlantContextForConsult(e.parameter.plantId) };
    else throw new Error('unknown action: ' + action);
    return json(Object.assign({ ok: true }, result));
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    // LINEのWebhook(postbackボタン操作等)は、アプリ自身のAPI呼び出しと形が違う
    // ({events:[...]}を持つ・idTokenを持たない)ので、先にそちらを判定して分岐する
    if (body.events) return handleLineWebhook(e, body);

    // ChatGPT(GPT Actions)からの植物相談の保存。LINEログインを経由できないため、
    // idTokenではなく専用トークン(AI_CONSULT_TOKEN)で認証する
    if (body.action === 'addConsultation') {
      verifyConsultToken(body.token);
      return json(Object.assign({ ok: true }, addConsultation(body)));
    }

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
    else if (action === 'listConsultations') result = { consultations: listConsultationsForApp(userId, body.plantId, body.limit, body.before) };
    else if (action === 'logEvent') result = logEventFromApp(userId, body.event, body.props);
    else if (action === 'getQuotaStatus') result = getQuotaStatus(userId);
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
  return {
    householdId: target.householdId,
    inviteCode: target.inviteCode,
    data: target.data,
    updatedAt: target.updatedAt,
    // 世帯の最初のメンバー=作成者を管理者として扱う(クォータの利用状況表示の出し分け用)
    admin: target.members.length > 0 && target.members[0] === userId,
  };
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
  // Webhookは同じイベントが複数回届くことがある(LINE側のリトライ等)。
  // webhookEventId を専用シートに記録し、二度目以降は処理しない。
  // シート未作成(setupNewFeatures未実行)の場合は従来どおり素通しする
  var webhookEventId = ev.webhookEventId || (ev.message && ev.message.id ? 'msg-' + ev.message.id : null);
  if (webhookEventId && isDuplicateWebhookEventAndMark_(webhookEventId, ev.type)) {
    Logger.log('duplicate webhook event skipped: ' + webhookEventId);
    return;
  }

  var userId = ev.source && ev.source.userId;
  if (!userId) return;

  // テキストメッセージ → 家族インボックス(フラグOFFなら従来どおり反応しない)
  if (ev.type === 'message') {
    if (getFlag('LINE_INBOX') && ev.message && ev.message.type === 'text') {
      handleInboxMessage_(ev, userId);
    }
    return;
  }

  if (ev.type !== 'postback') return;
  var data = parsePostbackData(ev.postback && ev.postback.data);

  // インボックスの「どこに登録?」ボタン
  if (data.type === 'inbox') {
    if (getFlag('LINE_INBOX')) handleInboxPostback_(ev, userId, data);
    return;
  }

  // 従来からの「完了」ボタン(タスク・水やり・お手入れ)
  var msg = null;
  if (data.type === 'task') msg = completeTaskViaLine(userId, data.id);
  else if (data.type === 'water') msg = completePlantWaterViaLine(userId, data.id);
  else if (data.type === 'care') msg = completePlantCareViaLine(userId, data.id, data.cid);
  if (msg && ev.replyToken) {
    replyViaQuota_(ev, msg);
    logProductEventForUser_(userId, 'digest_action_clicked', { action: data.type });
  }
}

// postbackへの返信を共通送信関数(クォータ管理)経由にする。
// FLAG_LINE_MESSAGE_QUOTA が未設定・OFFなら従来どおり直接返信する
function replyViaQuota_(ev, textOrMessages, extra) {
  var token = PROP.getProperty('MESSAGING_CHANNEL_TOKEN');
  if (!token || !ev.replyToken) return { ok: false, reason: 'no_token' };
  var messages = typeof textOrMessages === 'string'
    ? [{ type: 'text', text: textOrMessages }]
    : textOrMessages;
  if (!getFlag('LINE_MESSAGE_QUOTA')) {
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ replyToken: ev.replyToken, messages: messages }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) Logger.log('LINE reply error: ' + res.getResponseCode() + ' ' + res.getContentText());
    return { ok: res.getResponseCode() === 200 };
  }
  return sendLineMessageWithQuotaCheck(Object.assign({
    channel: 'reply',
    replyToken: ev.replyToken,
    messages: messages,
    purpose: 'reply',
    messageType: messages[0] && messages[0].type,
    lineUserId: ev.source && ev.source.userId,
  }, extra || {}));
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
// pull/pushはフロントの操作を前提にした形なので、Webhookからの直接更新用に別関数にする。
// fnには data に加えて target(householdId・memberPrefs等)も渡す(使わない呼び出し元は無視してよい)
function withHouseholdData(userId, fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet();
    var target = findByUser(readAll(sh), userId);
    if (!target || !target.data) return null;
    var msg = fn(target.data, target);
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
    t.doneAt = todayStrJST();
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
// AI植物相談(ChatGPT / GPT Actions連携) — Phase 1(保存)+ Phase 2(アプリ内閲覧)
// ChatGPTで相談した内容を「保存」の一操作でスプレッドシート(consultations)に蓄積し、
// ミニアプリの植物詳細画面で時系列に閲覧できる。書き込みはGPT側のみ(アプリは読み取り専用)。
// 詳細設計: docs/plan-ai-consult-history.md / セットアップ: backend/plant-consult-gpt-setup.md
// ============================================
var CONSULT_SHEET_NAME = 'consultations';
// 列: A id | B plantId | C consultedAt | D category | E question | F answer | G summary
//     | H diagnosis | I recommendation | J nextCheckDate | K tags(カンマ区切り) | L photoUrls(カンマ区切り)
//     | M transcript | N source | O createdAt | P updatedAt

// LINEログインを経由できないChatGPT側の認証。合言葉(AI_CONSULT_TOKEN)が一致するかだけを見る
function verifyConsultToken(token) {
  var expected = PROP.getProperty('AI_CONSULT_TOKEN');
  if (!expected) throw new Error('AI_CONSULT_TOKEN が未設定です');
  if (!token || token !== expected) throw new Error('トークンが正しくありません');
}

function consultSheet() {
  var id = PROP.getProperty('SHEET_ID');
  if (!id) throw new Error('SHEET_ID 未設定');
  var sh = SpreadsheetApp.openById(id).getSheetByName(CONSULT_SHEET_NAME);
  if (!sh) throw new Error('シート "' + CONSULT_SHEET_NAME + '" がありません(backend/plant-consult-gpt-setup.md の手順1を参照)');
  return sh;
}

// このAPIが対象とする世帯を1つ決める。世帯が1件しか無ければ自動でそれを使い、
// 複数ある場合だけ AI_CONSULT_HOUSEHOLD_ID での明示指定を必須にする
// (このアプリは基本的に1家族=1世帯での利用を想定しているため)
function resolveConsultHousehold() {
  var rows = readAll(sheet());
  var explicitId = PROP.getProperty('AI_CONSULT_HOUSEHOLD_ID');
  if (explicitId) {
    var found = rows.filter(function (r) { return r.householdId === explicitId; })[0];
    if (!found) throw new Error('AI_CONSULT_HOUSEHOLD_ID に該当する世帯が見つかりません');
    return found;
  }
  if (rows.length === 0) throw new Error('世帯データがありません(アプリで「家族と共有」を先に設定してください)');
  if (rows.length > 1) throw new Error('世帯が複数あるため、スクリプトプロパティ AI_CONSULT_HOUSEHOLD_ID で対象を指定してください');
  return rows[0];
}

// ChatGPTが相談対象のplantIdを特定するための検索(名前の一部一致)
function listPlantsForConsult(query) {
  var hh = resolveConsultHousehold();
  var plants = (hh.data && hh.data.plants) || [];
  var q = (query || '').trim();
  var filtered = q ? plants.filter(function (p) { return p.name && p.name.indexOf(q) >= 0; }) : plants;
  return filtered.map(function (p) { return { id: p.id, name: p.name, place: p.place || '' }; });
}

// 植物カルテ(Phase 3) — 相談開始時にGPTがまず呼ぶことで、過去の相談内容を
// 毎回ユーザーに説明させずに文脈として引き継げるようにする
function getPlantContextForConsult(plantId) {
  if (!plantId) throw new Error('plantIdが必要です');
  var hh = resolveConsultHousehold();
  var plants = (hh.data && hh.data.plants) || [];
  var plant = plants.filter(function (p) { return p.id === plantId; })[0];
  if (!plant) throw new Error('該当する植物が見つかりません');
  var rows = readConsultRows().filter(function (r) { return r.plantId === plantId; });
  rows.sort(function (a, b) { return String(b.consultedAt).localeCompare(String(a.consultedAt)); });
  var recent = rows.slice(0, 5).map(function (r) {
    return { consultedAt: r.consultedAt, category: r.category, summary: r.summary, nextCheckDate: r.nextCheckDate || null };
  });
  var last = rows[0] || null;
  return {
    plant: { id: plant.id, name: plant.name, place: plant.place || '', cycleDays: plant.cycleDays, wateredAt: plant.wateredAt },
    recentConsultations: recent,
    lastDiagnosis: last ? (last.diagnosis || '') : '',
    lastRecommendation: last ? (last.recommendation || '') : '',
    lastCheckDate: last ? (last.nextCheckDate || null) : null,
    consultCount: rows.length,
  };
}

// 相談を1件保存する。plantId/category/question/answer/summaryは必須(GPT Actionsのスキーマ側でも必須にする)
function addConsultation(payload) {
  payload = payload || {};
  if (!payload.plantId) throw new Error('plantIdが必要です');
  if (!payload.category) throw new Error('categoryが必要です');
  if (!payload.question) throw new Error('questionが必要です');
  if (!payload.answer) throw new Error('answerが必要です');
  if (!payload.summary) throw new Error('summaryが必要です');
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = consultSheet();
    var now = new Date().toISOString();
    var id = 'c-' + Utilities.getUuid();
    sh.appendRow([
      id,
      payload.plantId,
      payload.consultedAt || now,
      payload.category,
      payload.question,
      payload.answer,
      payload.summary,
      payload.diagnosis || '',
      payload.recommendation || '',
      payload.nextCheckDate || '',
      (payload.tags || []).join(','),
      (payload.photoUrls || []).join(','),
      payload.transcript || '',
      payload.source || 'chatgpt',
      now,
      now,
    ]);
    return { id: id };
  } finally {
    lock.releaseLock();
  }
}

// 相談シートの全行をオブジェクト配列として読む(見出し行を除く)
function readConsultRows() {
  var sh = consultSheet();
  var values = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (!r[0]) continue;
    out.push({
      id: r[0], plantId: r[1], consultedAt: r[2], category: r[3],
      question: r[4], answer: r[5], summary: r[6], diagnosis: r[7],
      recommendation: r[8], nextCheckDate: r[9],
      tags: r[10] ? String(r[10]).split(',') : [],
      photoUrls: r[11] ? String(r[11]).split(',') : [],
      transcript: r[12], source: r[13], createdAt: r[14], updatedAt: r[15],
    });
  }
  return out;
}

// ミニアプリ側(Phase 2)から特定の植物の相談履歴を新しい順で取得する。
// GPT向けのlistPlants/addConsultationと違い、こちらはLINEログイン(idToken)で認証する
// ——アプリのJSは公開リポジトリにあるため、AI_CONSULT_TOKENをフロントには絶対に埋め込まないこと
function listConsultationsForApp(userId, plantId, limit, before) {
  var target = findByUser(readAll(sheet()), userId);
  if (!target) throw new Error('世帯に参加していません');
  if (!plantId) throw new Error('plantIdが必要です');
  var rows = readConsultRows().filter(function (r) { return r.plantId === plantId; });
  if (before) rows = rows.filter(function (r) { return r.consultedAt < before; });
  rows.sort(function (a, b) { return String(b.consultedAt).localeCompare(String(a.consultedAt)); });
  var lim = Math.min(Number(limit) || 20, 50);
  return rows.slice(0, lim);
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

// 前日リマインド用の直近成績。resultが手動記録された過去の試合を新しい順に最大3件拾い、
// ○(win)/●(loss)/△(draw)の記号にして「古い→新しい」の時系列順で返す(無ければnull)
function recentFormJST(events, beforeDate) {
  var marks = { win: '○', loss: '●', draw: '△' };
  var played = (events || [])
    .filter(function (e) { return e.kind === 'match' && e.result && e.date < beforeDate; })
    .sort(function (a, b) { return b.date.localeCompare(a.date); })
    .slice(0, 3)
    .map(function (e) { return marks[e.result] || '?'; });
  return played.length ? played.reverse().join('') : null;
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
        // 担当が決まっているやることは、誰の分か分かるように名前を添える
        var assignee = assigneeNameGs_(data.family, x.assignedTo);
        if (assignee) meta += '・担当:' + assignee;
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
  if (matchRows.length) sections.push({ icon: '⚽', label: '試合', rows: matchRows });

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

  // 前日リマインド(充実版) — 今日の試合と混ぜず専用セクションにし、節・会場・直近成績を添える。
  // 対戦相手のロゴ・順位表は公式の無料APIが無く外部取得はしない(規約上グレーな取得は避ける方針)ので、
  // 手入力済みのデータ(memo・venue)とアプリ内で記録済みの結果(result)だけで充実させる
  var tomorrowMatchRows = [];
  if (on('match')) {
    (data.events || [])
      .filter(function (e) { return e.kind === 'match' && e.date === tomorrowStr; })
      .forEach(function (e) {
        var title = e.title.replace(/^⚽\s*/, '');
        var who = whoSuffix(e, data.family);
        var venueLabel = e.venue === 'away' ? 'アウェイ' : 'ホーム';
        var lines = [title + '\n明日 ' + (e.time || '時間未定') + '・' + venueLabel + (who ? '・' + who : '')];
        if (e.memo) lines.push(e.memo);
        var form = recentFormJST(data.events, tomorrowStr);
        if (form) lines.push('直近3試合: ' + form + '(古い→新しい)');
        tomorrowMatchRows.push({ text: lines.join('\n'), action: null });
      });
  }
  if (tomorrowMatchRows.length) sections.push({ icon: '⚽', label: '明日は試合です', rows: tomorrowMatchRows });

  // 中身が何も無い日は送らない(天気だけを理由に送信しない)
  if (!sections.length) return null;

  // 「重要日だけ受け取る」がONの人には、大事な予定(important)がある日だけ送る
  if (prefs.importantOnly === true) {
    var hasImportant = (data.events || []).some(function (e) {
      return e.important && (eventCoversDate(e, todayStr) || e.date === tomorrowStr);
    });
    if (!hasImportant) return null;
  }

  // 1通の項目数は全体で5件までに抑える(多すぎる朝の通知は読まれない)。
  // 超えた分はセクションの後ろから削り、最後に「ほか◯件」を添える
  var MAX_DIGEST_ROWS = 5;
  var totalRows = sections.reduce(function (n, s) { return n + s.rows.length; }, 0);
  var omitted = 0;
  if (totalRows > MAX_DIGEST_ROWS) {
    var budget = MAX_DIGEST_ROWS;
    sections = sections.map(function (sec) {
      var keep = sec.rows.slice(0, Math.max(budget, 0));
      budget -= sec.rows.length;
      return { icon: sec.icon, label: sec.label, rows: keep };
    }).filter(function (sec) { return sec.rows.length > 0; });
    omitted = totalRows - MAX_DIGEST_ROWS;
  }

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
  if (omitted > 0) {
    bodyContents.push({ type: 'text', text: 'ほか' + omitted + '件はアプリで確認できます', size: 'xs', color: '#9A9A96', margin: 'lg' });
  }

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
    var sentCount = 0;
    r.members.forEach(function (userId) {
      var prefs = (r.memberPrefs && r.memberPrefs[userId]) || {};
      if (prefs.digest === false) return; // 朝ダイジェストをオフにしている人には送らない
      var flex = buildDigestFlex(r.data, todayStr, tomorrowStr, prefs, weather);
      if (!flex) return;
      if (getFlag('LINE_MESSAGE_QUOTA')) {
        // 共通送信関数を通す:同じ日に手動実行しても dedupe_key で再送されない。
        // クォータ超過で送れない場合はアプリ内のお知らせ(notificationCenter)へ残す
        var res = sendLineMessageWithQuotaCheck({
          channel: 'push',
          to: userId,
          messages: [{ type: 'flex', altText: 'おはようございます。今日の暮らしnoteです。', contents: flex }],
          purpose: 'digest',
          messageType: 'flex',
          householdId: r.householdId,
          lineUserId: userId,
          targetType: 'digest',
          targetId: todayStr,
          dedupeKey: 'digest-' + r.householdId + '-' + userId + '-' + todayStr,
          autoSuppress: prefs.autoSuppress !== false,
          fallbackNotice: {
            title: '今朝のダイジェストはアプリでどうぞ',
            meta: 'LINEの無料枠にゆとりがないため、今日はここにまとめています',
          },
        });
        if (res && res.ok) sentCount++;
      } else {
        try { sendLineFlex(userId, 'おはようございます。今日の暮らしnoteです。', flex, token); sentCount++; }
        catch (e) { Logger.log('push failed for ' + userId + ': ' + e); }
      }
    });
    if (sentCount > 0) logProductEventInternal_(r.householdId, '', 'digest_sent', { recipients: sentCount });
  });
}

// 家族配列からassignedTo(memberId)の名前を引く。見つからなければnull
function assigneeNameGs_(family, memberId) {
  if (!memberId) return null;
  var m = (family || []).filter(function (f) { return f.id === memberId; })[0];
  return m ? m.name : null;
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

// ============================================
// v0.36.0 追加分 — 機能フラグ / セットアップ / 月200通クォータ /
// LINE家族インボックス / 匿名の利用計測
// すべてフラグ(Script Propertiesの FLAG_*)がOFFなら従来どおり動く。
// ============================================

// ---- 機能フラグ(Script Properties)。未設定=OFF=従来動作 ----
function getFlag(name) {
  var v = PROP.getProperty('FLAG_' + name);
  if (v === null || v === undefined || v === '') return false;
  v = String(v).toLowerCase();
  return v === 'true' || v === '1' || v === 'on';
}

// ---- 追加シートの名前とヘッダー(列はヘッダー名で解決する) ----
var QUOTA_SHEET_NAME = 'message_quota';
var LOG_SHEET_NAME = 'line_message_log';
var WEBHOOK_SHEET_NAME = 'webhook_events';
var PRODUCT_EVENTS_SHEET_NAME = 'product_events';

var QUOTA_HEADERS = [
  'current_month', 'monthly_limit', 'warning_threshold', 'critical_threshold', 'reserve_quota',
  'sent_count', 'remaining_count',
  'digest_budget', 'immediate_budget', 'reply_budget', 'reserve_budget', 'test_budget',
  'updated_at',
];
var LOG_HEADERS = [
  'log_id', 'household_id', 'user_id', 'line_user_id', 'message_type', 'send_channel',
  'purpose', 'target_type', 'target_id', 'dedupe_key', 'counted_as_quota',
  'estimated_message_count', 'sent_at', 'status', 'suppressed_reason', 'error_message',
];
var WEBHOOK_HEADERS = ['webhook_event_id', 'received_at', 'event_type', 'handled'];
var PRODUCT_EVENTS_HEADERS = ['event_id', 'occurred_at', 'household_id', 'user_hash', 'event_name', 'props_json', 'source'];

// 【セットアップ用】新機能に必要なシートとヘッダーを作る。何度実行しても壊れない。
// ・既存シートは削除しない ・既存列の意味は変えない(足りない列だけ右へ追記)
// ・本番データ(households/consultations)には一切触らない
function setupNewFeatures() {
  var ss = openSpreadsheet_();
  ensureSheetWithHeaders_(ss, QUOTA_SHEET_NAME, QUOTA_HEADERS);
  ensureSheetWithHeaders_(ss, LOG_SHEET_NAME, LOG_HEADERS);
  ensureSheetWithHeaders_(ss, WEBHOOK_SHEET_NAME, WEBHOOK_HEADERS);
  ensureSheetWithHeaders_(ss, PRODUCT_EVENTS_SHEET_NAME, PRODUCT_EVENTS_HEADERS);
  getOrCreateQuotaRow_(); // 今月の行(初期値)を用意しておく
  Logger.log('setupNewFeatures 完了: ' + [QUOTA_SHEET_NAME, LOG_SHEET_NAME, WEBHOOK_SHEET_NAME, PRODUCT_EVENTS_SHEET_NAME].join(', ') + ' を確認・作成しました');
}

function openSpreadsheet_() {
  var id = PROP.getProperty('SHEET_ID');
  if (!id) throw new Error('SHEET_ID 未設定');
  return SpreadsheetApp.openById(id);
}

function sheetByName_(name) {
  try { return openSpreadsheet_().getSheetByName(name); } catch (e) { return null; }
}

function ensureSheetWithHeaders_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  var width = Math.max(sh.getLastColumn(), headers.length);
  var firstRow = sh.getRange(1, 1, 1, width).getValues()[0];
  var empty = firstRow.every(function (c) { return c === '' || c === null; });
  if (empty) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sh;
  }
  // 既存ヘッダーは書き換えない。不足している列だけ右端に追加する
  headers.forEach(function (h) {
    var current = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    if (current.indexOf(h) < 0) sh.getRange(1, sh.getLastColumn() + 1).setValue(h);
  });
  return sh;
}

function headerList_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
}

// ============================================
// 月200通クォータ — 送信の共通口
// message_quota シートに「月ごとに1行」。月が変わったら送信時にも自動で
// 新しい月の行を作る(月初トリガーには依存しない。Asia/Tokyo基準)。
// ============================================
function currentMonthJST_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM');
}
function nowStrJST_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss");
}

function quotaDefaults_() {
  var limit = Number(PROP.getProperty('QUOTA_MONTHLY_LIMIT')) || 200;
  return {
    monthly_limit: limit,
    warning_threshold: 160,
    critical_threshold: 190,
    reserve_quota: 20,
    sent_count: 0,
    remaining_count: limit,
    digest_budget: 60,
    immediate_budget: 40,
    reply_budget: 50,
    reserve_budget: 30,
    test_budget: 20,
  };
}

// 今月の行を取得(無ければ初期値で作成)。message_quotaシートが無ければnull
function getOrCreateQuotaRow_() {
  var sh = sheetByName_(QUOTA_SHEET_NAME);
  if (!sh || sh.getLastColumn() === 0) return null;
  var headers = headerList_(sh);
  var monthCol = headers.indexOf('current_month') + 1;
  if (!monthCol) return null;
  var month = currentMonthJST_();
  var rowIndex = -1;
  if (sh.getLastRow() > 1) {
    var vals = sh.getRange(2, monthCol, sh.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      if (String(vals[i][0]) === month) { rowIndex = i + 2; break; }
    }
  }
  if (rowIndex < 0) {
    var d = quotaDefaults_();
    var row = headers.map(function (h) {
      if (h === 'current_month') return month;
      if (h === 'updated_at') return nowStrJST_();
      return d[h] !== undefined ? d[h] : '';
    });
    sh.appendRow(row);
    rowIndex = sh.getLastRow();
  }
  var values = sh.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  var obj = {};
  headers.forEach(function (h, i) { obj[h] = values[i]; });
  return {
    obj: obj,
    set: function (name, value) {
      var c = headers.indexOf(name);
      if (c >= 0) sh.getRange(rowIndex, c + 1).setValue(value);
    },
  };
}

// 今月の利用状況。message_quotaシート未作成ならnull(=送信可否を判定できない)
function getMonthlyMessageUsage() {
  var q = getOrCreateQuotaRow_();
  if (!q) return null;
  var o = q.obj;
  var limit = Number(o.monthly_limit) || 200;
  var sent = Number(o.sent_count) || 0;
  return {
    month: String(o.current_month),
    limit: limit,
    warning: Number(o.warning_threshold) || 160,
    critical: Number(o.critical_threshold) || 190,
    sent: sent,
    remaining: Math.max(limit - sent, 0),
    _row: q,
  };
}

// 上限接近時にも送ってよい用途(ユーザー操作への返信・当日の重要なお知らせ)
var QUOTA_CRITICAL_PURPOSES = ['reply', 'important', 'today_important', 'user_action'];
// 160通以上でまず控える低優先度の用途
var QUOTA_LOW_PURPOSES = ['evening', 'completion_share', 'plant_minor', 'shopping_update', 'low'];

// 送ってよいか。opts.autoSuppress=false(本人設定)ならwarning段階の自動抑制だけ緩める
// (critical・上限の保護は本人設定に関わらず必ず効く)
function canSendLineMessage(purpose, count, opts) {
  if (!getFlag('LINE_MESSAGE_QUOTA')) return { ok: true };
  var u = (opts && opts.usage) || getMonthlyMessageUsage();
  if (!u) return { ok: false, reason: 'quota_sheet_missing' }; // setupNewFeatures未実行。安全側に倒す
  var n = count || 1;
  if (u.sent + n > u.limit) return { ok: false, reason: 'monthly_limit' };
  if (u.sent >= u.critical) {
    if (QUOTA_CRITICAL_PURPOSES.indexOf(purpose) < 0) return { ok: false, reason: 'critical_threshold' };
  } else if (u.sent >= u.warning) {
    var autoSuppress = !(opts && opts.autoSuppress === false);
    if (autoSuppress && QUOTA_LOW_PURPOSES.indexOf(purpose) >= 0) return { ok: false, reason: 'warning_threshold' };
  }
  return { ok: true };
}

// この用途の通知を控えるべきか。控えるなら理由の文字列、送ってよければnull
function shouldSuppressNotification(purpose, count, opts) {
  var c = canSendLineMessage(purpose, count, opts);
  return c.ok ? null : c.reason;
}

// 送信結果をline_message_logへ記録し、実際に送った分だけ月カウントを進める
function recordLineMessageUsage(entry) {
  var sh = sheetByName_(LOG_SHEET_NAME);
  if (sh && sh.getLastColumn() > 0) {
    var headers = headerList_(sh);
    var rec = {
      log_id: 'log-' + Utilities.getUuid(),
      household_id: entry.householdId || '',
      user_id: entry.userId || '',
      line_user_id: entry.lineUserId ? shortHash_(entry.lineUserId) : '',
      message_type: entry.messageType || 'text',
      send_channel: entry.channel || 'push',
      purpose: entry.purpose || '',
      target_type: entry.targetType || '',
      target_id: entry.targetId || '',
      dedupe_key: entry.dedupeKey || '',
      counted_as_quota: entry.countedAsQuota ? 'true' : 'false',
      estimated_message_count: entry.estimatedCount || 1,
      sent_at: nowStrJST_(),
      status: entry.status || '',
      suppressed_reason: entry.suppressedReason || '',
      error_message: entry.errorMessage || '',
    };
    try {
      sh.appendRow(headers.map(function (h) { return rec[h] !== undefined ? rec[h] : ''; }));
    } catch (e) { Logger.log('message log append failed: ' + e); }
  }
  // 送れたか不確かなエラーも安全側(=数える)に倒して、絶対に200通を超えないようにする
  if (entry.countedAsQuota && (entry.status === 'sent' || entry.status === 'error')) {
    var u = getMonthlyMessageUsage();
    if (u && u._row) {
      var newSent = u.sent + (entry.estimatedCount || 1);
      u._row.set('sent_count', newSent);
      u._row.set('remaining_count', Math.max(u.limit - newSent, 0));
      u._row.set('updated_at', nowStrJST_());
    }
  }
}

// 同じdedupe_keyの送信記録(sent/suppressed問わず)が既にあるか。再送・無限リトライ防止
function hasDedupeKey_(key) {
  if (!key) return false;
  var sh = sheetByName_(LOG_SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) return false;
  var headers = headerList_(sh);
  var col = headers.indexOf('dedupe_key') + 1;
  if (!col) return false;
  var found = sh.getRange(2, col, sh.getLastRow() - 1, 1)
    .createTextFinder(String(key)).matchEntireCell(true).findNext();
  return !!found;
}

// LINE送信の共通口。チェック→送信→記録をLockServiceで直列化し、
// 競合しても厳密に月上限を超えないようにする。
// opts: { channel:'push'|'reply', to, replyToken, messages:[...], purpose,
//         householdId, userId, lineUserId, messageType, targetType, targetId,
//         dedupeKey, countedAsQuota, autoSuppress, fallbackNotice:{title,meta} }
function sendLineMessageWithQuotaCheck(opts) {
  var token = PROP.getProperty('MESSAGING_CHANNEL_TOKEN');
  if (!token) return { ok: false, reason: 'no_token' };
  var messages = opts.messages || [];
  if (!messages.length) return { ok: false, reason: 'no_messages' };
  var n = messages.length;
  // replyをクォータに数えるかは設定で切り替え(既定=数える。安全側)
  var counted = opts.channel === 'reply'
    ? PROP.getProperty('QUOTA_COUNT_REPLIES') !== 'false'
    : true;
  if (opts.countedAsQuota === false) counted = false;

  if (!getFlag('LINE_MESSAGE_QUOTA')) {
    return lineApiSend_(opts, token); // フラグOFF: 従来どおり直接送信
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (opts.dedupeKey && hasDedupeKey_(opts.dedupeKey)) {
      return { ok: false, skipped: true, reason: 'duplicate' };
    }
    var check = counted
      ? canSendLineMessage(opts.purpose, n, { autoSuppress: opts.autoSuppress })
      : { ok: true };
    var base = {
      householdId: opts.householdId, userId: opts.userId, lineUserId: opts.lineUserId,
      messageType: opts.messageType || (messages[0] && messages[0].type) || 'text',
      channel: opts.channel || 'push', purpose: opts.purpose || '',
      targetType: opts.targetType, targetId: opts.targetId,
      dedupeKey: opts.dedupeKey, countedAsQuota: counted, estimatedCount: n,
    };
    if (!check.ok) {
      recordLineMessageUsage(mergeObj_(base, { status: 'suppressed', suppressedReason: check.reason }));
      // 送れなかった情報はアプリ内のお知らせに残す(静かな置き換え)
      if (opts.fallbackNotice && opts.householdId) {
        appendNotificationCenterNoLock_(opts.householdId, {
          id: 'nc-' + Utilities.getUuid(),
          type: 'suppressed',
          title: opts.fallbackNotice.title,
          meta: opts.fallbackNotice.meta || '',
          createdAt: Date.now(),
        });
      }
      return { ok: false, suppressed: true, reason: check.reason };
    }
    var res = lineApiSend_(opts, token);
    recordLineMessageUsage(mergeObj_(base, {
      status: res.ok ? 'sent' : 'error',
      errorMessage: res.ok ? '' : (res.error || ''),
    }));
    return res;
  } finally {
    lock.releaseLock();
  }
}

function mergeObj_(a, b) {
  var out = {};
  Object.keys(a || {}).forEach(function (k) { out[k] = a[k]; });
  Object.keys(b || {}).forEach(function (k) { out[k] = b[k]; });
  return out;
}

// LINE Messaging APIの実呼び出し(push/reply共通)。リトライはしない
function lineApiSend_(opts, token) {
  var isReply = opts.channel === 'reply';
  var url = isReply ? 'https://api.line.me/v2/bot/message/reply' : 'https://api.line.me/v2/bot/message/push';
  var payload = isReply
    ? { replyToken: opts.replyToken, messages: opts.messages }
    : { to: opts.to, messages: opts.messages };
  try {
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    if (code !== 200) {
      Logger.log('LINE send error (' + (isReply ? 'reply' : 'push') + '): ' + code + ' ' + res.getContentText());
      return { ok: false, error: code + ' ' + String(res.getContentText()).slice(0, 300) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// 世帯のアプリ内お知らせ(data.notificationCenter)へ1件追記する。
// 呼び出し元が既にLockServiceのロックを持っている前提(ここでは取らない)
function appendNotificationCenterNoLock_(householdId, entry) {
  try {
    var sh = sheet();
    var rows = readAll(sh);
    var target = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].householdId === householdId) { target = rows[i]; break; }
    }
    if (!target || !target.data) return;
    if (!target.data.notificationCenter) target.data.notificationCenter = [];
    target.data.notificationCenter.push(entry);
    if (target.data.notificationCenter.length > 50) {
      target.data.notificationCenter = target.data.notificationCenter.slice(-50);
    }
    sh.getRange(target.row, 4, 1, 2).setValues([[JSON.stringify(target.data), Date.now()]]);
  } catch (e) {
    Logger.log('notificationCenter append failed: ' + e);
  }
}

// ============================================
// Webhookの冪等性 — webhookEventId を記録し、同じイベントを二度処理しない
// ============================================
// 「確認して無ければ追記する」をロック無しで行うと、LINE側の再送が同時に
// 複数届いた場合に、両方とも「まだ無い」と判定して両方処理してしまう競合の
// 隙が生まれる(2026-07-19、実際にLINEが短時間に8回再送する状況で発覚)。
// LockServiceで確認〜追記を1つの塊にして、この隙を無くす
function isDuplicateWebhookEventAndMark_(id, type) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    Logger.log('webhook dedupe lock failed: ' + e);
    return false; // ロックが取れない場合も処理は止めない(安全側)
  }
  try {
    var sh = sheetByName_(WEBHOOK_SHEET_NAME);
    if (!sh || sh.getLastColumn() === 0) return false; // 未セットアップなら従来どおり素通し
    if (sh.getLastRow() > 1) {
      var found = sh.getRange(2, 1, sh.getLastRow() - 1, 1)
        .createTextFinder(String(id)).matchEntireCell(true).findNext();
      if (found) return true;
    }
    sh.appendRow([String(id), nowStrJST_(), type || '', 'true']);
    // 古い記録の掃除(増えすぎたら古い方から削除)
    if (sh.getLastRow() > 3000) sh.deleteRows(2, 1000);
    return false;
  } catch (e) {
    Logger.log('webhook dedupe failed: ' + e);
    return false; // 判定できないときは処理を止めない
  } finally {
    lock.releaseLock();
  }
}

// ============================================
// LINE家族インボックス — テキストを必ず保存し、説明可能なルールで分類する
// AI API・OCR・URL解析・画像解析は使わない。返信は入力1件につき原則1回。
// ============================================

// 日本語の日付・時刻のゆるい解釈(js/priority.jsのApp.parseJaDateTimeと同一仕様。
// 変更する場合は両方に反映すること)
function parseJaDateTimeGs_(text) {
  var pad = function (n) { return ('0' + n).slice(-2); };
  var dstr = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var todayStr = todayStrJST();
  var base = new Date(todayStr + 'T00:00:00');
  var date = null;
  var time = null;
  var cleaned = String(text || '');
  var m;
  var consume = function (s) { cleaned = cleaned.replace(s, ' '); };

  if ((m = cleaned.match(/今日|きょう/))) { date = todayStr; consume(m[0]); }
  if (!date && (m = cleaned.match(/明後日|あさって/))) {
    var d2 = new Date(base); d2.setDate(d2.getDate() + 2); date = dstr(d2); consume(m[0]);
  }
  if (!date && (m = cleaned.match(/明日|あした|あす/))) {
    var d1 = new Date(base); d1.setDate(d1.getDate() + 1); date = dstr(d1); consume(m[0]);
  }
  if (!date && (m = cleaned.match(/(\d{1,2})月(\d{1,2})日/))) {
    var mo = Number(m[1]); var da = Number(m[2]);
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) {
      var cand = new Date(base.getFullYear(), mo - 1, da);
      if (dstr(cand) < todayStr) cand.setFullYear(cand.getFullYear() + 1);
      date = dstr(cand); consume(m[0]);
    }
  }
  if (!date && (m = cleaned.match(/(?:(\d{4})[\/年])?(\d{1,2})\/(\d{1,2})(?!\d)/))) {
    var y = m[1] ? Number(m[1]) : base.getFullYear();
    var mo2 = Number(m[2]); var da2 = Number(m[3]);
    if (mo2 >= 1 && mo2 <= 12 && da2 >= 1 && da2 <= 31) {
      var cand2 = new Date(y, mo2 - 1, da2);
      if (!m[1] && dstr(cand2) < todayStr) cand2.setFullYear(y + 1);
      date = dstr(cand2); consume(m[0]);
    }
  }
  if (!date && (m = cleaned.match(/(来週)?(月|火|水|木|金|土|日)曜日?/))) {
    var WD = ['日', '月', '火', '水', '木', '金', '土'];
    var target = WD.indexOf(m[2]);
    var d3 = new Date(base);
    var diff = (target - d3.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    d3.setDate(d3.getDate() + diff);
    date = dstr(d3); consume(m[0]);
  }
  if ((m = cleaned.match(/(\d{1,2})[::](\d{2})/))) {
    var h = Number(m[1]); var mi = Number(m[2]);
    if (h <= 23 && mi <= 59) { time = pad(h) + ':' + pad(mi); consume(m[0]); }
  }
  if (!time && (m = cleaned.match(/(午前|午後|朝|夜)?\s*(\d{1,2})時(半)?/))) {
    var h2 = Number(m[2]);
    if ((m[1] === '午後' || m[1] === '夜') && h2 < 12) h2 += 12;
    if (h2 <= 23) { time = pad(h2) + ':' + (m[3] ? '30' : '00'); consume(m[0]); }
  }
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return { date: date, time: time, cleaned: cleaned };
}

// 分類。明示的な接頭語(買い物:/やること:/予定:/メモ:)なら即時登録、
// それ以外は説明可能なルールで候補(最大3つ)を返す
function classifyInboxText_(text) {
  var m = text.match(/^(買い物|買物|かいもの|やること|予定|メモ|めも)[::]\s*(.+)$/);
  if (m) {
    var map = { '買い物': 'shopping', '買物': 'shopping', 'かいもの': 'shopping', 'やること': 'task', '予定': 'event', 'メモ': 'note', 'めも': 'note' };
    return { kind: 'direct', category: map[m[1]], body: m[2].trim() };
  }
  var parsed = parseJaDateTimeGs_(text);
  var hasDate = !!parsed.date;
  var hasTime = !!parsed.time;
  var buyish = /買う|買って|買い|購入/.test(text);
  var taskish = /する$|やる$|出す|申し込|予約|連絡|洗う|書く|払う|提出|取りに/.test(text);
  var candidates;
  if (hasDate && hasTime) candidates = ['event', 'note'];
  else if (hasDate && buyish) candidates = ['task', 'shopping', 'note'];
  else if (hasDate) candidates = ['event', 'task', 'note'];
  else if (buyish) candidates = ['shopping', 'task', 'note'];
  else if (taskish) candidates = ['task', 'shopping', 'note'];
  else if (text.length <= 8) candidates = ['shopping', 'task', 'note'];
  else candidates = ['task', 'note', 'event'];
  return { kind: 'candidates', categories: candidates.slice(0, 3), parsed: parsed };
}

function inboxCategoryLabel_(cat) {
  var labels = { event: '予定', task: 'やること', shopping: '買い物リスト', note: 'メモ', later: 'あとで整理' };
  return labels[cat] || cat;
}

// 世帯データへ実際に登録する(分類ごとの作成処理)。戻り値 {type, id, label}
function createFromInbox_(data, category, body, original) {
  var id = 'li-' + Utilities.getUuid();
  var parsed = parseJaDateTimeGs_(body || original);
  var title = (parsed.cleaned || body || original || '').trim() || (body || original);
  if (category === 'shopping') {
    if (!data.shopping) data.shopping = [];
    // 未購入で同じ名前がすでにあれば増やさない(js/screens/shopping.jsの手入力と同じ判定基準)
    var existing = data.shopping.filter(function (s) { return !s.done && String(s.name).trim() === title.trim(); })[0];
    if (existing) return { type: 'shopping', id: existing.id, label: title, duplicate: true };
    data.shopping.unshift({ id: id, name: title, done: false });
    return { type: 'shopping', id: id, label: title };
  }
  if (category === 'task') {
    if (!data.tasks) data.tasks = [];
    data.tasks.push({ id: id, title: title, due: parsed.date || null, done: false, createdAt: Date.now() });
    return { type: 'task', id: id, label: title };
  }
  if (category === 'event') {
    if (!data.events) data.events = [];
    data.events.push({
      id: id, title: title, date: parsed.date || todayStrJST(), time: parsed.time || '',
      memberIds: (data.family || []).map(function (f) { return f.id; }), memo: '', color: 0,
    });
    return { type: 'event', id: id, label: title };
  }
  if (category === 'note') {
    if (!data.notes) data.notes = [];
    data.notes.unshift({ id: id, type: 'memo', date: todayStrJST(), title: '', body: original, updatedAt: Date.now() });
    return { type: 'note', id: id, label: title.length > 12 ? title.slice(0, 12) + '…' : title };
  }
  return null;
}

// 曖昧なときの「どこに登録?」返信(Quick Reply付きテキスト1通だけ)
function buildInboxCandidateMessage_(itemId, categories) {
  var labels = { event: '予定にする', task: 'やることにする', shopping: '買い物にする', note: 'メモにする', later: 'あとで整理' };
  var items = categories.concat(['later']).map(function (cat) {
    return {
      type: 'action',
      action: {
        type: 'postback',
        label: labels[cat] || cat,
        data: 'type=inbox&id=' + encodeURIComponent(itemId) + '&as=' + cat,
        displayText: labels[cat] || cat,
      },
    };
  });
  return {
    type: 'text',
    text: 'どこに登録しますか?(あとでアプリの「未整理」からも整理できます)',
    quickReply: { items: items },
  };
}

// テキストメッセージの受信。原文を必ずdata.inboxItemsへ保存してから分類する
function handleInboxMessage_(ev, userId) {
  var text = String((ev.message && ev.message.text) || '').trim();
  if (!text) return;
  if (text.length > 500) text = text.slice(0, 500); // 長文はここまでで切って保存
  var itemId = 'inbox-' + Utilities.getUuid();
  var cls = classifyInboxText_(text);
  var householdId = null;
  var prefs = {};
  var created = null;
  var saved = withHouseholdData(userId, function (data, target) {
    householdId = target.householdId;
    prefs = (target.memberPrefs && target.memberPrefs[userId]) || {};
    if (!data.inboxItems) data.inboxItems = [];
    var item = { id: itemId, text: text, from: userId, receivedAt: Date.now(), status: 'pending' };
    if (cls.kind === 'direct') {
      created = createFromInbox_(data, cls.category, cls.body, text);
      item.status = 'processed';
      item.processedAt = Date.now();
      item.targetType = created ? created.type : cls.category;
      if (created) item.targetId = created.id;
    }
    data.inboxItems.push(item);
    if (data.inboxItems.length > 200) data.inboxItems = data.inboxItems.slice(-200);
    return true;
  });
  if (!saved) return; // 世帯に参加していないアカウントからのメッセージは扱わない(別世帯の操作拒否)

  logProductEventInternal_(householdId, userId, 'inbox_received', { chars: text.length, direct: cls.kind === 'direct' }, 'gas');

  if (cls.kind === 'direct') {
    // 即時登録の確認返信は本人の設定(既定オフ=通知を増やさない)がONのときだけ
    if (created && prefs.inboxReply === true && ev.replyToken) {
      var msgText = created.duplicate
        ? '「' + created.label + '」はすでに' + inboxCategoryLabel_(cls.category) + 'にあります'
        : '「' + created.label + '」を' + inboxCategoryLabel_(cls.category) + 'に登録しました';
      replyViaQuota_(ev, msgText, { householdId: householdId, targetType: 'inbox', targetId: itemId });
    }
  } else if (ev.replyToken) {
    // 曖昧なときは1回だけ候補を返す(多段返信はしない)
    replyViaQuota_(ev, [buildInboxCandidateMessage_(itemId, cls.categories)], {
      householdId: householdId, targetType: 'inbox', targetId: itemId,
      dedupeKey: 'inbox-cand-' + itemId,
    });
    logProductEventInternal_(householdId, userId, 'inbox_candidate_shown', { candidates: cls.categories.length }, 'gas');
  }
}

// 「どこに登録?」ボタンの受信。同じ項目への二度目の操作では二重登録しない
function handleInboxPostback_(ev, userId, q) {
  var replyText = null;
  var householdId = null;
  var convertedTo = null;
  withHouseholdData(userId, function (data, target) {
    householdId = target.householdId;
    var item = ((data.inboxItems || []).filter(function (x) { return x.id === q.id; }))[0];
    if (!item) { replyText = 'このメモは見つかりませんでした。アプリの「未整理」から整理できます'; return false; }
    if (item.status === 'processed') { replyText = 'すでに登録済みです'; return false; }
    if (q.as === 'later') {
      item.status = 'later';
      replyText = '「あとで整理」にしました。アプリの未整理一覧からいつでも登録できます';
      return true;
    }
    var created = createFromInbox_(data, q.as, item.text, item.text);
    if (!created) { replyText = 'うまく登録できませんでした。アプリの「未整理」からお試しください'; return false; }
    item.status = 'processed';
    item.processedAt = Date.now();
    item.targetType = created.type;
    item.targetId = created.id;
    convertedTo = q.as;
    replyText = created.duplicate
      ? '「' + created.label + '」はすでに' + inboxCategoryLabel_(q.as) + 'にあります'
      : '「' + created.label + '」を' + inboxCategoryLabel_(q.as) + 'に登録しました';
    return true;
  });
  if (convertedTo) logProductEventInternal_(householdId, userId, 'inbox_converted', { to: convertedTo, via: 'line' }, 'gas');
  if (replyText && ev.replyToken) {
    replyViaQuota_(ev, replyText, { householdId: householdId, targetType: 'inbox', targetId: q.id });
  }
}

// ============================================
// 匿名の利用計測(product_events) — 本文は記録しない。
// 記録するのはイベント名と、数値・真偽値・短い英数字ラベルのみ。
// ============================================
function shortHash_(s) {
  if (!s) return '';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s));
  var out = '';
  for (var i = 0; i < 6; i++) out += ('0' + ((bytes[i] + 256) % 256).toString(16)).slice(-2);
  return out;
}

function logProductEventInternal_(householdId, lineUserId, eventName, props, source) {
  try {
    if (!getFlag('PRODUCT_ANALYTICS')) return;
    var sh = sheetByName_(PRODUCT_EVENTS_SHEET_NAME);
    if (!sh || sh.getLastColumn() === 0) return;
    var safe = {};
    var src = props || {};
    Object.keys(src).forEach(function (k) {
      var v = src[k];
      if (typeof v === 'number' || typeof v === 'boolean') safe[k] = v;
      else if (typeof v === 'string' && /^[\w-]{0,32}$/.test(v)) safe[k] = v; // 日本語の自由文は記録しない
    });
    sh.appendRow([
      'pe-' + Utilities.getUuid(),
      nowStrJST_(),
      householdId || '',
      lineUserId ? shortHash_(lineUserId) : '',
      String(eventName || '').slice(0, 64),
      JSON.stringify(safe),
      source || 'gas',
    ]);
  } catch (e) {
    Logger.log('product event failed: ' + e); // 計測の失敗は主要動作を止めない
  }
}

// LINE userIdだけ分かっている場面(Webhook)から世帯を引いて記録する
function logProductEventForUser_(userId, eventName, props) {
  try {
    if (!getFlag('PRODUCT_ANALYTICS')) return;
    var target = findByUser(readAll(sheet()), userId);
    if (!target) return;
    logProductEventInternal_(target.householdId, userId, eventName, props, 'gas');
  } catch (e) { /* 計測は主要動作を止めない */ }
}

// フロント(認証済み)からの計測。idToken検証済みのuserIdで世帯を確認する
function logEventFromApp(userId, eventName, props) {
  if (!getFlag('PRODUCT_ANALYTICS')) return { logged: false };
  var target = findByUser(readAll(sheet()), userId);
  if (!target) throw new Error('世帯に参加していません');
  logProductEventInternal_(target.householdId, userId, eventName, props, 'app');
  return { logged: true };
}

// ============================================
// クォータの利用状況(管理者=世帯の最初のメンバーのみ)
// ============================================
function getQuotaStatus(userId) {
  var target = findByUser(readAll(sheet()), userId);
  if (!target) throw new Error('世帯に参加していません');
  if (!target.members.length || target.members[0] !== userId) {
    throw new Error('利用状況は世帯の管理者のみ確認できます');
  }
  var u = getMonthlyMessageUsage();
  if (!u) return { quota: null };
  var stats = computeLogStats_(u.month);
  var level = u.sent >= u.critical ? 'critical' : u.sent >= u.warning ? 'warning' : 'ok';
  var topPurpose = null;
  var topCount = 0;
  Object.keys(stats.byPurpose).forEach(function (k) {
    if (stats.byPurpose[k] > topCount) { topCount = stats.byPurpose[k]; topPurpose = k; }
  });
  return {
    quota: {
      month: u.month, limit: u.limit, sent: u.sent, remaining: u.remaining,
      warning: u.warning, critical: u.critical, level: level,
      byPurpose: stats.byPurpose, suppressed: stats.suppressed, topPurpose: topPurpose,
    },
  };
}

// 今月分の送信ログを集計(用途別の送信数と抑制件数)
function computeLogStats_(month) {
  var out = { byPurpose: {}, suppressed: 0 };
  var sh = sheetByName_(LOG_SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) return out;
  var headers = headerList_(sh);
  var idx = function (name) { return headers.indexOf(name); };
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).getValues();
  vals.forEach(function (r) {
    var sentAt = String(r[idx('sent_at')] || '');
    if (sentAt.indexOf(month) !== 0) return;
    var status = String(r[idx('status')] || '');
    var purpose = String(r[idx('purpose')] || '') || 'other';
    if (status === 'suppressed') { out.suppressed++; return; }
    if (status === 'sent' || status === 'error') {
      if (String(r[idx('counted_as_quota')]) === 'true') {
        out.byPurpose[purpose] = (out.byPurpose[purpose] || 0) + (Number(r[idx('estimated_message_count')]) || 1);
      }
    }
  });
  return out;
}
