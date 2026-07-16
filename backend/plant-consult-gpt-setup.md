# AI植物相談(ChatGPT連携)セットアップ手順 — Phase 1

ChatGPTで植物について相談し、「保存して」の一言でその内容を`backend/Code.gs`経由でスプレッドシートに蓄積する機能のセットアップ手順。**渡辺さんの操作**が必要です（ChatGPT側のGPT作成は代行できないため）。所要 30分程度(うちCloudflare Workerの準備に10〜15分)。

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

## 6. ChatGPTからの接続用に中継サーバー(Cloudflare Worker)を立てる

**これは省略できない手順です。** GASのウェブアプリURL(`.../exec`)は、ChatGPT Actionsのようなサーバー間の自動アクセスだと、Google側に「ファイルを開けません」というエラーページで弾かれることが確認されています(ブラウザで直接開く分には問題なし)。ChatGPT → 中継サーバー(Cloudflare Worker) → GAS、という経路にすることでこれを回避します。**無料・クレジットカード登録不要**です。

### 6-1. Cloudflareアカウントを作る

[dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) でメールアドレス+パスワードで登録する(確認メールが届くので開いて認証)。

### 6-2. Workerを作る

1. ログイン後、左メニューの **「Build」**セクションにある **「Compute」**(または「Workers & Pages」)をクリック。
2. **「Create application」**(作成)→ **「Start with Hello World!」**を選ぶ。
3. Worker名は任意(例: `plant-consult-proxy`。自動生成された名前のままでも構わない)。
4. そのまま **「Deploy」** する(初期状態のサンプルコードが先にデプロイされる)。
5. デプロイ後の画面で **「Edit code」**をクリック。

### 6-3. コードを貼り替える

エディタのデフォルトコードを全部消して、下記に貼り替える。**`GAS_URL`の値は、実際にデプロイしているGASのウェブアプリURL(`js/config.js`の`SYNC_URL`と同じもの)に置き換えること**:

```js
export default {
  async fetch(request) {
    const GAS_URL = "https://script.google.com/macros/s/AKfycbzzvr5jG13CxFvWEdKTo75T-JEUvKSZGDfSIzrWgMskkeVP6ELOI6ADsN-uN1RzBYg/exec";
    const url = new URL(request.url);
    const target = GAS_URL + url.search; // action・token・query等のクエリ文字列をそのまま引き継ぐ

    const init = {
      method: request.method,
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      redirect: "follow",
    };
    if (request.method === "POST") {
      init.body = await request.text(); // ChatGPTが送ったJSON本文をそのままGASへ転送
    }

    const res = await fetch(target, init);
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  },
};
```

貼り替えたら **「Save and Deploy」**(保存してデプロイ)。

### 6-4. WorkerのURLを控えて動作確認する

画面上部に表示される `https://<worker名>.<あなたのサブドメイン>.workers.dev` の形式のURLをコピーする。ブラウザで以下を開き(`YOUR_TOKEN`は手順3で決めた値)、`{"ok":true,"plants":[...]}`が返れば成功:

```
https://<worker名>.<あなたのサブドメイン>.workers.dev/?action=listPlants&token=YOUR_TOKEN
```

このWorkerのURLは、次の手順(ChatGPT側のスキーマ)で`servers.url`として使う。

---

## 7. ChatGPTでカスタムGPTを作る

**必要なプラン**: ChatGPT Plus / Team / Pro / Enterprise のいずれか。無料プランではカスタムGPT(GPTs)を作成できません。

### 7-1. GPT作成画面を開く

1. [chatgpt.com](https://chatgpt.com) にログイン。
2. 左サイドバーの **「GPTを探す」**(英語表記なら "Explore GPTs")をクリック。
3. 右上の **「+ 作成する」**("+ Create")をクリック。
4. 画面上部に **「作成」**(Create)と**「構成」**(Configure)の2つのタブが出る。会話形式で作る「作成」タブは使わず、**「構成」タブ**をクリックして直接入力する(この方が確実で速い)。

### 7-2. 基本情報を入力する

「構成」タブで上から順に埋める:

- **名前**: 「わが家の植物相談」など任意。
- **説明**: 「植物の様子・症状を相談すると、内容を記録してくれるアシスタント」など任意(空でも動く)。
- **プロフィール画像**: 任意。設定しなくても動作に影響しない。

### 7-3. Instructions(指示文)を貼り付ける

同じ画面の **「Instructions」** の大きなテキスト欄に、下記をそのまま貼り付ける。
`YOUR_TOKEN` の部分は、**手順3で決めた `AI_CONSULT_TOKEN` の値に必ず置き換えること**(このままだと動きません)。

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

### 7-4. Actionsを追加する

1. 「構成」タブを下にスクロールすると **「Actions」** という欄がある。
2. **「新しいアクションを作成する」**("Create new action")をクリックすると、別画面(Actionエディタ)が開く。
3. 画面下部の **「スキーマ」**("Schema")という大きなテキスト欄が編集可能になっている。下のOpenAPIスキーマを**丸ごとコピーして貼り付け、`servers.url`を手順6-4で控えたWorkerのURLに書き換える**(GASの直リンクのままだと接続できない)。

```yaml
openapi: 3.1.0
info:
  title: 暮らしnote 植物相談 API
  version: 1.0.0
servers:
  - url: https://plant-consult-proxy.あなたのサブドメイン.workers.dev
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

4. スキーマを貼り付けると、自動的に解析されて **「利用可能なアクション」欄に `listPlants` と `addConsultation` の2つ**が表示される(表示されない場合はYAMLの貼り付けが崩れている可能性があるので、インデントを崩さずコピーし直す)。
5. 画面上部の **「認証」**("Authentication")は **「なし」**("None")のままにする(トークンはURL/リクエスト本文の中に含める方式なので、Actions自体の認証設定は不要)。
6. 各アクションの右側に **「テスト」**("Test")ボタンがある。まず `listPlants` の「テスト」を押し、`token`欄に手順3で決めた値を入力して実行する。うちの植物一覧(`{"ok":true,"plants":[...]}`)が返れば接続成功。エラーが出た場合は「既知の注意点」を参照。
7. Action画面右上の **「保存」**をクリックしてActionエディタを閉じる。

### 7-5. 忘れずに: 公開範囲を「自分のみ」にする

1. 画面右上の **「保存する」**("Save"/"Create")をクリックすると、公開範囲を聞かれる。
2. 必ず **「自分のみ」**("Only me")を選ぶこと。「リンクを知っている人」や「全員に公開」を選ぶと、この指示文に書いたトークン(合言葉)や家族の植物データに他人がアクセスできてしまう。

### 7-6. 動作確認

1. GPT編集画面の右側(または保存後にGPTを開いた画面)のチャットで、「モンステラの葉先が黄色くなってきた」のように話しかける。
2. 「葉先が黄色いのは水のやりすぎが多い原因です」等の返答のあと、「保存して」と伝える。
3. `listPlants`・`addConsultation` が呼ばれた形跡(「〇〇を使用しました」のような表示)が出て、「記録しました」と返ってくれば成功。
4. Googleスプレッドシートの `consultations` シートを開き、1行増えていることを確認する。

---

## 既知の注意点

- **GASのウェブアプリURLに直接ChatGPT Actionsを向けると、Google側に「ファイルを開けません」というエラーページで弾かれることを確認済みです**(2026-07-16)。ブラウザで直接開く分には問題ないので気づきにくい。手順6のCloudflare Workerを経由させることで解消することを確認しています(GET/POSTとも)。もしWorkerを経由しているのに同じ症状が出る場合は、スキーマの`servers.url`がGASの直リンクのままになっていないか確認してください。
- `listPlants`・`addConsultation`とも、うちの植物データは「家族と共有」設定（世帯参加）が前提です。世帯未参加の状態だとエラーになります。
- Phase 1はGPT側からの保存のみです。アプリ内で相談履歴を見られるようにするのはPhase 2（`docs/plan-ai-consult-history.md`参照）で対応予定です。
- **トークンはInstructions欄に平文で書かれます**。公開範囲を「自分のみ」にしておけば、原則自分以外はInstructionsの中身を見られません。今後もし「リンクを共有」「GPTストアに公開」などを検討する場合は、その前に必ずトークンの扱いを見直してください（token不要の別の認証方式へ切り替える等）。
- テストで`token`エラーが出た場合は、(1) スクリプトプロパティの`AI_CONSULT_TOKEN`と、(2) Instructions内の`YOUR_TOKEN`を置き換えた値、の2つが一字一句一致しているか確認してください。
