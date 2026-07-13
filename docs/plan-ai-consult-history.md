# 設計メモ:AI植物相談履歴連携(実装保留・2026-07-13)

ChatGPT(植物専用GPT)での相談を「この内容を保存」の一操作で植物に紐付けて蓄積し、
ミニアプリで時系列閲覧できるようにするための**将来設計**。今回は設計のみで実装しない。

## 全体像

```
ChatGPT(植物専用GPT)
  └─ GPT Actions ──→ Plant History API(GAS Webアプリ)──→ スプレッドシート
                                                              ↑
LINEミニアプリ(閲覧専用)── consultRepo(読み取りAPI+ローカルキャッシュ)┘
```

**設計の骨子(5つの決定)**

1. 相談履歴は plants の中に入れ子にせず、**独立コレクション(consultations)**として持つ
2. 「自動抽出」系の拡張は後付けにせず、**保存APIのスキーマに最初から構造化項目を持たせ、GPTに埋めさせる**
3. ミニアプリ側は **consultRepo(データアクセス層)を1ファイル追加**するだけ。store.js・既存stateには混ぜない
4. 相談の書き込みはGPT側のみ、ミニアプリは**読み取り専用**(同期・競合問題を最初から回避)
5. 「次回確認日」は既存の **careTasks / plantCareItems 機構に変換して乗せる**(新しいリマインド機構を作らない)

---

## 1. データ設計

### consultations(新規・1相談=1レコード)

| フィールド | 型 | 説明 |
|---|---|---|
| id | string | サーバー(GAS)発番。`c-` プレフィックス推奨 |
| plantId | string | plants.id への外部キー |
| consultedAt | ISO8601 | 相談日時 |
| category | enum | `disease` 病気 / `pest` 害虫 / `pruning` 剪定 / `repot` 植え替え / `fertilizer` 肥料 / `watering` 水やり / `other` |
| question | string | 主な質問(原文) |
| answer | string | AIの回答・結論 |
| summary | string | 一覧表示用の1〜2行要約(**GPTが保存時に生成**) |
| diagnosis | string | 診断結果 |
| recommendation | string | 推奨対応 |
| nextCheckDate | date / null | 次回確認日(**GPTが会話から抽出して保存時にセット**) |
| tags | string[] | シート上はカンマ区切り文字列 |
| photoUrls | string[] | 将来対応。最初から列だけ用意(空でよい) |
| transcript | string / null | 会話全文(任意)。詳細画面の「全文を見る」用 |
| source | string | `chatgpt` / `app`(将来アプリ内AI相談からも保存する時の区別) |
| createdAt / updatedAt | ISO8601 | |

ポイント:
- **入れ子にしない理由**: 履歴は際限なく増える。plants に入れると localStorage/シートの読み書きが肥大化し、
  GPT側(書き込み)とアプリ側(植物編集)の保存が衝突する。独立テーブルなら「1シート=1テーブル」でGASに素直に載る。
- summary / diagnosis / recommendation / nextCheckDate は「将来自動抽出したい」項目だが、
  **GPT Actionsの保存スキーマでrequired気味に定義しておけば、GPTが保存時に埋める=最初から自動抽出が実現**する。
  後からNLP処理を足す必要がない。これがこの設計でいちばん効く判断。

### plants(既存への影響:ほぼゼロ)

- 現行フィールドはそのまま。相談履歴への参照は持たない(plantId側から引く)。
- 将来追加してよいもの(今は不要):
  - `aliases: string[]` — GPTが「レモン」等の呼び名からplantIdを解決しやすくする
  - `photoUrl` — 詳細画面のヘッダー写真
- **⚠️ 最重要の下準備: plantId の安定性**。現在は `App.uid()` でローカル発番し、「データを初期化」でIDが変わる。
  相談履歴がGAS側に溜まり始めると、IDが変わった瞬間に紐付けが全部切れる。
  **GASバックエンド化(既存計画#3)の際に、植物マスタをGAS側発番・GAS側が正に移行してから相談連携を始めること。**

### スプレッドシート構成(GASバックエンド)

- シート `plants`: 植物マスタ(バックエンド化計画#3と共用)
- シート `consultations`: 上記スキーマを1行1レコードで
- 将来: シート `care_log`(水やり・肥料・成長記録を type 列で統一)— 現行の `plant.careLog` を汎用化する時に

---

## 2. API設計(Plant History API = GAS Webアプリ)

GASの制約(URLパスが使えない・1エンドポイント)に合わせ、`?action=` 方式。OpenAPI上は operationId で分ける。

| operationId | GAS | 用途 | 呼び出し元 |
|---|---|---|---|
| `listPlants` | GET `?action=listPlants&query=レモン` | 植物検索(id, name, place, aliases) | GPT(保存前のplantId解決)・アプリ |
| `addConsultation` | POST `?action=addConsultation` | 相談保存。body=consultationスキーマ | GPTのみ |
| `listConsultations` | GET `?action=listConsultations&plantId=&limit=&before=` | 履歴の時系列取得(ページング) | アプリ・GPT |
| `getPlantContext` | GET `?action=getPlantContext&plantId=` | **植物カルテ**: 基本情報+直近N件の要約+前回診断+前回推奨対応+前回確認日をひとまとめで返す | GPT(相談開始時に1回) |

- レスポンスは統一エンベロープ `{ ok: true, data: ... }` / `{ ok: false, error: "..." }`
- `getPlantContext` が拡張要望「過去相談をAIへ自動コンテキストとして渡す」の土台。
  GPT側の指示文に「◯◯について相談されたら最初に getPlantContext を呼ぶ」と書くだけで、
  毎回説明不要の文脈引き継ぎが実現する。カルテ生成もこのAPIの整形を変えるだけ。

### GPT Actions保存スキーマの要点

`addConsultation` の request body で `plantId, category, question, answer, summary` を必須、
`diagnosis, recommendation, nextCheckDate, tags` を「会話から分かる場合は必ず埋める」とdescriptionで指示。
→ 分類・要約・次回確認日抽出がGPT任せで最初から動く。

### 認証(GASの落とし穴)

- **GASはリクエストヘッダーを読めない**。GPT ActionsのAPIキー認証(ヘッダー)がそのまま使えない。
- 個人利用の現実解: **bodyまたはクエリに `token` パラメータを含め、GAS側で照合**(OpenAPIでrequiredにしてGPTに送らせる)。
- ミニアプリ(公開URL)には**読み取り専用の別トークン**を持たせ、書き込みトークンはGPT側だけに置く。
  漏れても家庭データ+読み取りのみ、と割り切る。本格運用するならLIFFのIDトークン検証をGASでやるのが本筋(将来課題)。
- GAS WebアプリのURLは302リダイレクトを挟む。GPT Actions・fetchともリダイレクト追従するので動くが、ハマったらここを疑う。

---

## 3. ミニアプリ側の画面設計

### 植物詳細画面(新規ルート `#plantDetail/<plantId>`)

```
┌─ 基本情報カード(名前・場所・周期・前回水やり)※既存plant-cardの流用
├─ 写真(将来。photoUrlがあれば表示)
├─ お世話(水やりボタン・お手入れ予定)※現plants画面から移設 or 併存
├─ 次回確認予定(nextCheckDateが未来/超過の相談をバッジ付きで)
├─ AI相談履歴(時系列・新しい順)
│    日付|カテゴリピル|summary 1行 ← タップでBottom Sheet詳細
│    「もっと見る」でページング(listConsultationsのbefore/limit)
└─ お世話の記録(careLog: 水やり・肥料・完了したお手入れ)
```

- 相談詳細は**Bottom Sheet**(`App.sheet`): 質問/回答/診断/推奨対応/次回確認日/タグ、transcriptがあれば「全文を見る」
- 一覧の空状態: 「まだ相談の記録はありません。ChatGPTで相談して『保存』すると、ここに残ります。」調
- 現行の植物一覧(#plants)は各カードに「くわしく」導線を足すだけ。一覧の水やりボタン等はそのまま

### 唯一の下準備リファクタ: ルーターのパラメータ対応

現在 `currentRoute()` は `#route` 固定(`js/app.js`)。`#plantDetail/xxx` を通すには
ハッシュを `/` で分割し、`App.screens[base].render(main, params)` と渡す小改修が必要。
**約10行の変更で済み、既存画面には無影響**(params無視するだけ)。詳細画面を作る時に最初にやる。

### 次回確認日 → 既存機構への合流(新機構を作らない)

- 相談の `nextCheckDate` は、閲覧時に careTasks 相当の「確認」として扱い、
  既存の **`App.data.plantCareItems()`(ホーム『今日やること』自動合流)にそのまま乗せる**。
- カレンダー登録の拡張も「eventsに `kind:"plantCheck"` で追加」より、
  まず plantCareItems 経由が自然(完了操作・履歴化のフローが既にある)。

---

## 4. コンポーネント分割

| 新規 | 役割 |
|---|---|
| `js/repo/consultations.js` | `App.consultRepo = { listByPlant(plantId, opts), get(id) }`。今はスタブ(空配列)、将来GAS fetch+キャッシュ |
| `js/screens/plant-detail.js` | `App.screens.plantDetail`。画面ローカルに `consultListItem(c)` / `openConsultDetailSheet(c)` |
| 定数 `CONSULT_CATEGORIES` | 種別enum→日本語ラベル・アイコンの対応表を1箇所に |

- **キャッシュは別キー** `wagaya-consult-cache-v1`。`wagaya-home-v1` に混ぜない理由:
  store.save の肥大化防止/「データを初期化」で相談キャッシュを巻き込まない/表示は「キャッシュ即表示→裏で更新」方式にできる
- 再利用する既存部品: `App.sheet` / `App.el` / `badge` / `sectionHeader` / `emptyState` / デザイントークン一式

---

## 5. 実装フェーズ案(それぞれ単独で価値が出る順)

| Phase | 内容 | 価値 |
|---|---|---|
| 1 | GASに consultations シート+ `addConsultation` / `listPlants` +GPT Action設定 | **ミニアプリ無改修で保存が始まる**。履歴はスプレッドシートで見られる(GASが得意なので着手しやすい) |
| 2 | ルーターparam対応+植物詳細画面+consultRepo(読み取り) | ミニアプリで時系列閲覧 |
| 3 | nextCheckDate→plantCareItems合流、`getPlantContext` | リマインドと文脈自動引き継ぎ |
| 4 | 写真(Drive)、植物カルテ整形、アプリ内AI相談(source:"app")の合流 | フル構成 |

**Phase 1 の前提条件**: 植物マスタのID安定化(GASバックエンド化 or 最低限「plantsシートにID・名前を手動登録し、アプリ側シードのIDと揃える」運用)。

---

## 6. リスク・決めごと(実装前に判断が必要)

1. **plantIdの安定性**(上述)— 相談連携より先にGAS側を正とする移行を済ませる
2. GAS認証はヘッダー不可 → token-in-body方式で妥協するか、Cloudflare Workers等を前段に置くか
3. GASクォータ(URL Fetch/実行時間)は家庭利用なら余裕だが、GPTが `getPlantContext` を呼びすぎない指示文にする
4. 相談の「編集・削除」をミニアプリに持たせるか(設計上は読み取り専用スタート。削除はスプレッドシート直編集で当面十分)
5. 金融機能は対象外の方針どおり、本機能でも課金・決済要素は持たない
