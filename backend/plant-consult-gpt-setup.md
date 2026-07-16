# AI植物相談(ChatGPT連携)セットアップ手順 — Phase 1

ChatGPTで植物について相談し、「保存して」の一言でその内容を`backend/Code.gs`経由でスプレッドシートに蓄積する機能のセットアップ手順。**渡辺さんの操作**が必要です（ChatGPT側のGPT作成は代行できないため）。所要 15分程度。

このPhase 1では、**保存だけ**ができるようになります（アプリ内での閲覧はPhase 2で追加予定）。保存された内容はスプレッドシートで直接見られます。

設計の詳細は [`docs/plan-ai-consult-history.md`](../docs/plan-ai-consult-history.md) を参照。

---

## 1. スプレッドシートに `consultations` シートを追加する

1. 既存の「暮らしnote DB」スプレッドシートを開く。
2. 左下の `+` でシートを追加し、シート名を `consultations` に変更する。
3. 1行目に見出しを入れる（そのままコピペでOK）:

```
id	plantId	consultedAt	category	question	answer	summary	diagnosis	recommendation	nextCheckDate	tags	photoUrls	transcript	source	createdAt	updatedAt
```

## 2. Apps Script のコードを更新する

1. スプレッドシートの **拡張機能 → Apps Script** を開く。
2. `Code.gs` の中身を、この repo の最新の `backend/Code.gs` に丸ごと差し替えて保存する。

## 3. スクリプトプロパティに `AI_CONSULT_TOKEN` を追加する

1. Apps Script 左の **歯車（プロジェクトの設定）→ スクリプト プロパティ**。
2. 新しいプロパティを追加:

| プロパティ | 値 |
|---|---|
| `AI_CONSULT_TOKEN` | 適当な英数字の長い文字列（例: パスワード生成ツールで作った32文字程度のランダム文字列）|

これがChatGPT側の「合言葉」になります。**この値は秘密にしてください**（知っていれば誰でも相談を書き込める・植物一覧を読めるため）。

> 世帯が2つ以上ある場合のみ、追加で `AI_CONSULT_HOUSEHOLD_ID` の設定が必要です（通常は不要）。設定しないと「世帯が複数あります」というエラーになった場合だけ対応してください。

## 4. 再デプロイする

1. 右上 **デプロイ → デプロイを管理 → 編集（鉛筆アイコン）**。
2. バージョン = **新しいバージョン**、デプロイ。
3. ウェブアプリURLは変わりません（`js/config.js`の`SYNC_URL`と同じ）。

## 5. 動作確認（任意・ChatGPTを作る前に）

ブラウザや`curl`で以下を開き、`{"ok":true,"plants":[...]}`が返ればOK（`YOUR_TOKEN`は手順3で決めた値）:

```
https://script.google.com/macros/s/AKfycbzzvr5jG13CxFvWEdKTo75T-JEUvKSZGDfSIzrWgMskkeVP6ELOI6ADsN-uN1RzBYg/exec?action=listPlants&token=YOUR_TOKEN
```

---

## 6. ChatGPTでカスタムGPTを作る

1. ChatGPT（Plus/Team以上のプラン。カスタムGPT作成にはこのプランが必要）で **GPTを作成** → **Configure** タブ。
2. **Name**: 「わが家の植物相談」など。
3. **Instructions**: 下記をそのまま貼り付け（`YOUR_TOKEN`は手順3で決めた値に置き換える）。

```
あなたは家庭園芸の相談相手です。ユーザーの植物の様子・症状・育て方の相談に、
やさしく具体的に答えてください。

保存トークンは "YOUR_TOKEN" です（Actions呼び出し時に毎回このtokenパラメータを使う）。

会話の中で特定の植物が話題になったら、まず listPlants を呼んで
うちの植物一覧からその植物のidを特定してください（見つからなければ、
一般的な相談として答えてよい。無理にIDを当てはめない）。

ユーザーが「保存して」「記録して」のように保存を求めたら、addConsultation を呼んで
その相談を記録してください。呼ぶ前に以下を自分で埋めること:
- plantId: listPlantsで特定したid
- category: disease(病気) / pest(害虫) / pruning(剪定) / repot(植え替え) /
  fertilizer(肥料) / watering(水やり) / other のいずれか、会話内容から最も近いもの
- question: ユーザーの相談内容の要点
- answer: あなたの回答の要点
- summary: 一覧表示用の1〜2行の要約(例:「葉先の黄変は水のやりすぎが原因。次回から乾いてから水やりへ」)
- diagnosis: 会話から診断できた内容があれば(無ければ空でよい)
- recommendation: 推奨した対応があれば
- nextCheckDate: ユーザーが「1週間後にまた様子を見る」等と言った場合のみ、
  YYYY-MM-DD形式で計算して入れる(今日の日付を基準に計算すること)
- tags: 会話から拾える軽いキーワード(任意、無理に埋めない)

保存が終わったら「記録しました」と一言だけ添える(長い確認は不要)。
保存に失敗したら理由をそのままユーザーに伝える。
```

4. **Actions** タブ → **Create new action** → 下記のOpenAPIスキーマを貼り付け（`server`のURLは既にこのプロジェクトの実URL）。

```yaml
openapi: 3.1.0
info:
  title: 暮らしnote 植物相談 API
  version: 1.0.0
servers:
  - url: https://script.google.com/macros/s/AKfycbzzvr5jG13CxFvWEdKTo75T-JEUvKSZGDfSIzrWgMskkeVP6ELOI6ADsN-uN1RzBYg/exec
paths:
  /:
    get:
      operationId: listPlants
      summary: うちの植物一覧を検索する(相談対象のplantIdを特定するために使う)
      parameters:
        - name: action
          in: query
          required: true
          schema: { type: string, enum: [listPlants] }
        - name: token
          in: query
          required: true
          schema: { type: string }
          description: 合言葉トークン
        - name: query
          in: query
          required: false
          schema: { type: string }
          description: 植物名の一部(例:モンステラ)。省略すると全件返す
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  ok: { type: boolean }
                  plants:
                    type: array
                    items:
                      type: object
                      properties:
                        id: { type: string }
                        name: { type: string }
                        place: { type: string }
    post:
      operationId: addConsultation
      summary: 植物相談の内容を1件保存する
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [action, token, plantId, category, question, answer, summary]
              properties:
                action: { type: string, enum: [addConsultation] }
                token: { type: string, description: "合言葉トークン" }
                plantId: { type: string, description: "listPlantsで調べた対象植物のid" }
                category:
                  type: string
                  enum: [disease, pest, pruning, repot, fertilizer, watering, other]
                question: { type: string }
                answer: { type: string }
                summary: { type: string, description: "一覧表示用の1〜2行要約" }
                diagnosis: { type: string }
                recommendation: { type: string }
                nextCheckDate: { type: string, description: "YYYY-MM-DD形式。会話から読み取れる場合のみ" }
                tags:
                  type: array
                  items: { type: string }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  ok: { type: boolean }
                  id: { type: string }
```

5. Authentication は **None**（トークンはリクエスト本文/クエリに含めているため、Actions側の認証設定は不要）。
6. 保存して、テストで「モンステラの葉が黄色くなってきた」のように話しかけ、「保存して」と伝えてみる。スプレッドシートの`consultations`シートに1行増えれば成功。

---

## 既知の注意点

- GASのウェブアプリURLは呼び出し時に302リダイレクトを挟みます。ChatGPT Actionsは通常リダイレクトに追従しますが、うまく動かない場合はまずここを疑ってください。
- `listPlants`・`addConsultation`とも、うちの植物データは「家族と共有」設定（世帯参加）が前提です。世帯未参加の状態だとエラーになります。
- Phase 1はGPT側からの保存のみです。アプリ内で相談履歴を見られるようにするのはPhase 2（`docs/plan-ai-consult-history.md`参照）で対応予定です。
