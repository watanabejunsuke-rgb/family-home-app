// ============================================
// 植物図鑑データ — 月別のお世話ごよみ(静的DB)
// まだ家に無い植物も含む。関東平野部の気候を基準にした一般的な目安。
// ⚠️ AIが下書きした内容のため、実際に育てる植物は品種・環境に合わせて確認すること。
// tasksのlabelは植物画面のお手入れ種類(摘心/植え替え/肥料/剪定)となるべく揃える。
// months: 適した月(1〜12)。cycleDays: 「うちの植物に追加」時の水やり周期の初期値。
// ============================================
window.App = window.App || {};

App.PLANTPEDIA = [
  // ---- 観葉植物 ----
  {
    id: "pachira", name: "パキラ", kana: "ぱきら", category: "観葉植物", difficulty: "easy",
    place: "室内(明るい日陰)", water: "土が乾いたらたっぷり。冬は控えめに", cycleDays: 7,
    tips: "耐陰性があり初心者向き。直射日光は葉焼けのもと。冬は5℃以上を保つ。",
    tasks: [
      { label: "植え替え", months: [5, 6, 7], note: "2年に1回が目安" },
      { label: "剪定", months: [5, 6], note: "伸びすぎた枝を切り戻す" },
      { label: "肥料", months: [5, 6, 7, 8, 9], note: "生育期に緩効性肥料" },
    ],
  },
  {
    id: "monstera", name: "モンステラ", kana: "もんすてら", category: "観葉植物", difficulty: "easy",
    place: "室内(明るい日陰)", water: "土が乾いたらたっぷり。葉水も好む", cycleDays: 7,
    tips: "直射日光は避ける。大きくなるので支柱があると安心。気根は切っても土に誘導してもよい。",
    tasks: [
      { label: "植え替え", months: [5, 6, 7], note: "根詰まりしたら一回り大きい鉢へ" },
      { label: "剪定", months: [4, 5, 6], note: "混み合った葉・気根の整理" },
      { label: "肥料", months: [4, 5, 6, 7, 8, 9], note: "" },
    ],
  },
  {
    id: "tableyashi", name: "テーブルヤシ", kana: "てーぶるやし", category: "観葉植物", difficulty: "easy",
    place: "室内(日陰OK)", water: "土が乾いたらたっぷり。乾燥期は葉水を", cycleDays: 7,
    tips: "耐陰性がとても強く置き場所を選ばない。直射日光で葉焼けするので注意。",
    tasks: [
      { label: "植え替え", months: [5, 6, 7], note: "2〜3年に1回" },
      { label: "肥料", months: [5, 6, 7, 8, 9], note: "" },
    ],
  },
  {
    id: "panda-gajumaru", name: "パンダガジュマル", kana: "ぱんだがじゅまる", category: "観葉植物", difficulty: "normal",
    place: "室内(日当たり)", water: "土が乾いたらたっぷり。冬は控えめに", cycleDays: 7,
    tips: "丸い葉がかわいい希少種。日光が好きなので窓辺向き。冬は5℃以上で。",
    tasks: [
      { label: "植え替え", months: [5, 6, 7], note: "" },
      { label: "剪定", months: [4, 5, 6], note: "樹形を整える" },
      { label: "肥料", months: [4, 5, 6, 7, 8, 9], note: "" },
    ],
  },
  {
    id: "syngonium-neon", name: "シンゴニウム・ネオン", kana: "しんごにうむねおん", category: "観葉植物", difficulty: "easy",
    place: "室内(明るい日陰)", water: "土の表面が乾いたら。乾燥に弱め", cycleDays: 5,
    tips: "ピンクがかった葉色が魅力。強い日差しはNG。空気が乾く季節は葉水をこまめに。",
    tasks: [
      { label: "植え替え", months: [5, 6, 7], note: "" },
      { label: "挿し芽", months: [5, 6, 7], note: "水挿しでも発根する" },
      { label: "肥料", months: [4, 5, 6, 7, 8, 9], note: "" },
    ],
  },
  {
    id: "pothos-golden", name: "ポトス・ゴールデン", kana: "ぽとすごーるでん", category: "観葉植物", difficulty: "easy",
    place: "室内(明るい日陰)", water: "土が乾いたらたっぷり", cycleDays: 7,
    tips: "とにかく丈夫で水挿しでも育つ。つるが伸びたら切って増やせる。耐陰性あり。",
    tasks: [
      { label: "植え替え", months: [5, 6, 7], note: "" },
      { label: "挿し芽", months: [5, 6, 7, 8], note: "水に挿すだけでも発根" },
      { label: "肥料", months: [4, 5, 6, 7, 8, 9], note: "" },
    ],
  },
  {
    id: "sansevieria", name: "サンスベリア", kana: "さんすべりあ", category: "観葉植物", difficulty: "easy",
    place: "室内(明るい場所)", water: "乾かし気味に。冬はほぼ断水", cycleDays: 14,
    tips: "乾燥に非常に強く、水のやりすぎが一番の失敗原因。冬の水やりはほぼ不要。",
    tasks: [
      { label: "植え替え", months: [5, 6, 7, 8], note: "" },
      { label: "肥料", months: [5, 6, 7, 8, 9], note: "少なめでよい" },
    ],
  },
  {
    id: "gajumaru", name: "ガジュマル", kana: "がじゅまる", category: "観葉植物", difficulty: "easy",
    place: "室内(日当たり)", water: "土が乾いたらたっぷり", cycleDays: 7,
    tips: "太い幹が特徴の縁起木。日光が好き。丈夫で剪定にも強い。",
    tasks: [
      { label: "植え替え", months: [5, 6, 7], note: "" },
      { label: "剪定", months: [4, 5, 6], note: "強めに切っても芽吹く" },
      { label: "肥料", months: [4, 5, 6, 7, 8, 9], note: "" },
    ],
  },
  {
    id: "umbellata", name: "フィカス・ウンベラータ", kana: "ふぃかすうんべらーた", category: "観葉植物", difficulty: "normal",
    place: "室内(明るい場所)", water: "土が乾いたらたっぷり。冬は控えめ", cycleDays: 7,
    tips: "ハート形の大きな葉が人気。寒さにやや弱い(8℃以上)。切り口の白い樹液はかぶれに注意。",
    tasks: [
      { label: "植え替え", months: [5, 6, 7], note: "" },
      { label: "剪定", months: [4, 5, 6], note: "樹形づくりは春に" },
      { label: "肥料", months: [4, 5, 6, 7, 8, 9], note: "" },
    ],
  },
  {
    id: "everfresh", name: "エバーフレッシュ", kana: "えばーふれっしゅ", category: "観葉植物", difficulty: "normal",
    place: "室内(明るい場所)", water: "水切れに弱い。土の表面が乾いたらすぐ", cycleDays: 5,
    tips: "夜になると葉を閉じる。水切れすると葉を落とすので夏は特に注意。",
    tasks: [
      { label: "植え替え", months: [5, 6, 7], note: "" },
      { label: "剪定", months: [5, 6], note: "" },
      { label: "肥料", months: [4, 5, 6, 7, 8, 9, 10], note: "" },
    ],
  },
  {
    id: "olive", name: "オリーブ", kana: "おりーぶ", category: "観葉植物", difficulty: "normal",
    place: "屋外(日なた)", water: "鉢植えは土が乾いたらたっぷり。地植えはほぼ不要", cycleDays: 5,
    tips: "日光大好き。実をつけたいなら別品種を2本。風通しよく育てるのがコツ。",
    tasks: [
      { label: "植え替え", months: [3, 4, 9, 10], note: "真夏・真冬は避ける" },
      { label: "剪定", months: [2, 3], note: "混み合う枝を透かす" },
      { label: "肥料", months: [3, 6, 10], note: "" },
      { label: "収穫", months: [10, 11], note: "" },
    ],
  },

  // ---- 野菜 ----
  {
    id: "tomato", name: "トマト", kana: "とまと", category: "野菜", difficulty: "normal",
    place: "屋外(日なた)", water: "土が乾いたら朝に。実がつく頃は水を絞ると甘くなる", cycleDays: 2,
    tips: "支柱は早めに。わき芽かきをこまめにすると実つきがよい。雨よけがあると病気に強い。",
    tasks: [
      { label: "植え付け", months: [4, 5], note: "遅霜の心配がなくなってから" },
      { label: "摘心", months: [5, 6, 7, 8], note: "わき芽かきをこまめに" },
      { label: "肥料", months: [6, 7, 8], note: "実がつき始めたら追肥" },
      { label: "収穫", months: [7, 8, 9], note: "" },
    ],
  },
  {
    id: "nasu", name: "なす", kana: "なす", category: "野菜", difficulty: "normal",
    place: "屋外(日なた)", water: "水を好む。土が乾いたらたっぷり", cycleDays: 1,
    tips: "肥料と水をよく食べる野菜。7月末に切り戻す(更新剪定)と秋なすが楽しめる。",
    tasks: [
      { label: "植え付け", months: [4, 5], note: "" },
      { label: "肥料", months: [6, 7, 8, 9], note: "2週に1回ペースで追肥" },
      { label: "剪定", months: [7, 8], note: "更新剪定で秋なすへ" },
      { label: "収穫", months: [6, 7, 8, 9, 10], note: "" },
    ],
  },
  {
    id: "goya", name: "ゴーヤ", kana: "ごーや", category: "野菜", difficulty: "easy",
    place: "屋外(日なた)", water: "土が乾いたらたっぷり。真夏は朝夕", cycleDays: 1,
    tips: "グリーンカーテンの定番。本葉5〜6枚で摘心すると子づるが増えて実つきUP。ネット必須。",
    tasks: [
      { label: "種まき", months: [4], note: "発芽には25℃前後が必要" },
      { label: "植え付け", months: [5], note: "" },
      { label: "摘心", months: [6], note: "本葉5〜6枚で親づるの先を摘む" },
      { label: "肥料", months: [6, 7, 8, 9], note: "" },
      { label: "収穫", months: [7, 8, 9], note: "採り遅れると黄色くなる" },
    ],
  },
  {
    id: "kyuri", name: "きゅうり", kana: "きゅうり", category: "野菜", difficulty: "normal",
    place: "屋外(日なた)", water: "水を好む。乾かすと曲がり果に", cycleDays: 1,
    tips: "成長がとても速く、収穫は毎日チェック。下の方のわき芽・雌花は早めに取ると株が育つ。",
    tasks: [
      { label: "植え付け", months: [4, 5], note: "" },
      { label: "肥料", months: [6, 7, 8], note: "" },
      { label: "収穫", months: [6, 7, 8, 9], note: "20cm前後で早めに" },
    ],
  },
  {
    id: "piman", name: "ピーマン", kana: "ぴーまん", category: "野菜", difficulty: "easy",
    place: "屋外(日なた)", water: "土が乾いたらたっぷり", cycleDays: 2,
    tips: "初心者向きの果菜。最初の実(一番果)は小さいうちに採ると株が疲れない。",
    tasks: [
      { label: "植え付け", months: [4, 5], note: "" },
      { label: "肥料", months: [6, 7, 8, 9], note: "" },
      { label: "収穫", months: [6, 7, 8, 9, 10], note: "" },
    ],
  },
  {
    id: "okra", name: "オクラ", kana: "おくら", category: "野菜", difficulty: "easy",
    place: "屋外(日なた)", water: "乾燥に強いが、実の時期は水切れ注意", cycleDays: 2,
    tips: "暑さに強く夏向き。実は採り遅れるとすぐ固くなるので5〜10cmで収穫。",
    tasks: [
      { label: "種まき", months: [5], note: "地温が上がってから" },
      { label: "肥料", months: [6, 7, 8], note: "" },
      { label: "収穫", months: [7, 8, 9], note: "採り遅れ注意" },
    ],
  },
  {
    id: "oba", name: "大葉(青じそ)", kana: "おおば", category: "野菜", difficulty: "easy",
    place: "屋外(半日陰でも可)", water: "乾燥に弱い。土が乾く前に", cycleDays: 1,
    tips: "半日陰の方が葉がやわらかく育つ。摘心すると脇芽が増えて収穫量UP。花穂も食べられる。",
    tasks: [
      { label: "種まき", months: [4, 5], note: "" },
      { label: "摘心", months: [6], note: "草丈30cmほどで" },
      { label: "収穫", months: [6, 7, 8, 9, 10], note: "下の葉から順に" },
    ],
  },
  {
    id: "akajiso", name: "赤ジソ", kana: "あかじそ", category: "野菜", difficulty: "easy",
    place: "屋外(日なた〜半日陰)", water: "乾燥に弱い。土が乾く前に", cycleDays: 1,
    tips: "梅干し・ジュース用なら6〜7月に一気に収穫。育て方は青じそと同じで丈夫。",
    tasks: [
      { label: "種まき", months: [4, 5], note: "" },
      { label: "収穫", months: [6, 7, 8], note: "梅仕事に合わせるなら6〜7月" },
    ],
  },
  {
    id: "edamame", name: "枝豆", kana: "えだまめ", category: "野菜", difficulty: "easy",
    place: "屋外(日なた)", water: "開花〜実の時期は水切れ厳禁", cycleDays: 2,
    tips: "肥料(特に窒素)は控えめでよい。採れたてを茹でる贅沢は家庭菜園ならでは。",
    tasks: [
      { label: "種まき", months: [4, 5, 6], note: "ずらしまきで長く楽しめる" },
      { label: "摘心", months: [6], note: "本葉5枚ほどで(分枝を増やす)" },
      { label: "収穫", months: [7, 8, 9], note: "さやが膨らんだら" },
    ],
  },
  {
    id: "radish", name: "ラディッシュ", kana: "らでぃっしゅ", category: "野菜", difficulty: "easy",
    place: "屋外・プランター(日なた)", water: "土が乾いたらたっぷり", cycleDays: 1,
    tips: "種まきから約30日で採れる最速野菜。子どもの初めての栽培にもぴったり。",
    tasks: [
      { label: "種まき", months: [3, 4, 5, 6, 9, 10], note: "真夏は避ける" },
      { label: "収穫", months: [4, 5, 6, 7, 10, 11], note: "まきから約30日" },
    ],
  },
  {
    id: "komatsuna", name: "小松菜", kana: "こまつな", category: "野菜", difficulty: "easy",
    place: "屋外・プランター(日なた)", water: "土が乾いたらたっぷり", cycleDays: 1,
    tips: "ほぼ一年中まける丈夫な葉物。虫がつきやすいので防虫ネットがあると安心。",
    tasks: [
      { label: "種まき", months: [3, 4, 5, 6, 9, 10, 11], note: "" },
      { label: "収穫", months: [4, 5, 6, 7, 10, 11, 12], note: "まきから30〜50日" },
    ],
  },

  // ---- ハーブ ----
  {
    id: "basil", name: "バジル", kana: "ばじる", category: "ハーブ", difficulty: "easy",
    place: "屋外・室内窓辺(日なた)", water: "水を好む。土が乾く前に", cycleDays: 1,
    tips: "摘心を繰り返すとこんもり茂って収穫が増える。花穂は摘むと葉が固くならない。寒さに弱い。",
    tasks: [
      { label: "種まき", months: [4, 5], note: "" },
      { label: "植え付け", months: [5], note: "" },
      { label: "摘心", months: [6, 7], note: "収穫を兼ねてこまめに" },
      { label: "収穫", months: [6, 7, 8, 9, 10], note: "" },
    ],
  },
  {
    id: "mint", name: "ミント", kana: "みんと", category: "ハーブ", difficulty: "easy",
    place: "屋外・室内(半日陰OK)", water: "水を好む。乾かしすぎない", cycleDays: 2,
    tips: "非常に丈夫だが地植えは増えすぎ注意(鉢植え推奨)。刈り込むほど新芽が出る。",
    tasks: [
      { label: "植え付け", months: [4, 5, 6], note: "鉢・プランター推奨" },
      { label: "剪定", months: [6, 7, 8], note: "蒸れ防止に刈り込む" },
      { label: "収穫", months: [5, 6, 7, 8, 9, 10], note: "" },
    ],
  },
  {
    id: "rosemary", name: "ローズマリー", kana: "ろーずまりー", category: "ハーブ", difficulty: "easy",
    place: "屋外(日なた)", water: "乾燥気味を好む。やりすぎ注意", cycleDays: 5,
    tips: "地中海生まれで乾燥に強い。蒸れが苦手なので梅雨前に透かし剪定を。ほぼ通年収穫できる。",
    tasks: [
      { label: "植え付け", months: [4, 5, 9, 10], note: "" },
      { label: "剪定", months: [3, 4, 9, 10], note: "梅雨前の風通し確保" },
      { label: "収穫", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], note: "通年OK" },
    ],
  },

  // ---- 果物 ----
  {
    id: "lemon", name: "レモン", kana: "れもん", category: "果物", difficulty: "normal",
    place: "屋外・鉢(日なた)", water: "鉢植えは土が乾いたらたっぷり", cycleDays: 3,
    tips: "寒さにやや弱く、冬は寒風を避ける(鉢なら軒下へ)。アゲハの幼虫がつくので見つけたら退治。",
    tasks: [
      { label: "植え替え", months: [3, 4], note: "鉢植えは2年に1回" },
      { label: "剪定", months: [2, 3], note: "混み合う枝を整理" },
      { label: "肥料", months: [3, 6, 10], note: "" },
      { label: "摘果", months: [7, 8], note: "実を減らして充実させる" },
      { label: "収穫", months: [1, 2, 3, 10, 11, 12], note: "緑のうちからでも使える" },
    ],
  },
  {
    id: "blueberry", name: "ブルーベリー", kana: "ぶるーべりー", category: "果物", difficulty: "normal",
    place: "屋外(日なた)", water: "乾燥に弱い。夏は毎日チェック", cycleDays: 1,
    tips: "酸性土(ブルーベリー用土)が必須。同系統2品種を近くに植えると実つきが格段によくなる。",
    tasks: [
      { label: "植え付け", months: [1, 2, 3, 11, 12], note: "落葉期に" },
      { label: "剪定", months: [1, 2], note: "古い枝を整理" },
      { label: "肥料", months: [3, 5, 8], note: "" },
      { label: "収穫", months: [6, 7, 8], note: "色づいて2〜3日後が甘い" },
    ],
  },
  {
    id: "mikan", name: "みかん(温州)", kana: "みかん", category: "果物", difficulty: "normal",
    place: "屋外(日なた)", water: "鉢植えは土が乾いたらたっぷり", cycleDays: 3,
    tips: "柑橘の中では寒さに強く家庭向き。実をつけすぎた年は翌年休みがち(隔年結果)なので摘果を。",
    tasks: [
      { label: "植え付け", months: [3, 4], note: "" },
      { label: "剪定", months: [2, 3], note: "" },
      { label: "肥料", months: [3, 6, 10], note: "" },
      { label: "摘果", months: [7, 8], note: "葉25枚に実1個が目安" },
      { label: "収穫", months: [10, 11, 12], note: "" },
    ],
  },
  {
    id: "ichigo", name: "いちご", kana: "いちご", category: "果物", difficulty: "normal",
    place: "屋外・プランター(日なた)", water: "土が乾いたらたっぷり。実の時期は特に",
    cycleDays: 2,
    tips: "秋に植えて春に収穫。実がついたら敷きわらで泥はね防止。ランナーで株を増やせる。",
    tasks: [
      { label: "植え付け", months: [10, 11], note: "" },
      { label: "肥料", months: [2, 3], note: "春の追肥" },
      { label: "収穫", months: [4, 5, 6], note: "" },
      { label: "その他", months: [6, 7], note: "ランナー整理・株の更新" },
    ],
  },

  // ---- 花 ----
  {
    id: "himawari", name: "ひまわり", kana: "ひまわり", category: "花", difficulty: "easy",
    place: "屋外(日なた)", water: "土が乾いたらたっぷり。夏は朝に", cycleDays: 1,
    tips: "日当たりが命。種まきから2ヶ月ほどで開花。子どもの自由研究にもぴったり。",
    tasks: [
      { label: "種まき", months: [4, 5, 6], note: "ずらしまきで開花期を長く" },
      { label: "肥料", months: [6, 7], note: "" },
      { label: "開花", months: [7, 8, 9], note: "" },
    ],
  },
  {
    id: "asagao", name: "あさがお", kana: "あさがお", category: "花", difficulty: "easy",
    place: "屋外(日なた)", water: "夏は朝夕2回が目安", cycleDays: 1,
    tips: "本葉8枚ほどで摘心するとつるが増えて花も増える。種は一晩水に浸けてからまくと発芽しやすい。",
    tasks: [
      { label: "種まき", months: [5], note: "" },
      { label: "摘心", months: [6, 7], note: "本葉8枚ほどで" },
      { label: "開花", months: [7, 8, 9], note: "" },
    ],
  },
  {
    id: "tulip", name: "チューリップ", kana: "ちゅーりっぷ", category: "花", difficulty: "easy",
    place: "屋外・プランター(日なた)", water: "冬も土が乾いたら忘れずに", cycleDays: 3,
    tips: "秋に球根を植えて春を待つ。植えっぱなしより毎年新しい球根の方が確実に咲く。",
    tasks: [
      { label: "植え付け", months: [10, 11], note: "球根を深さ10cmほどに" },
      { label: "開花", months: [3, 4], note: "" },
      { label: "その他", months: [6], note: "葉が枯れたら球根を掘り上げ" },
    ],
  },
  {
    id: "marigold", name: "マリーゴールド", kana: "まりーごーるど", category: "花", difficulty: "easy",
    place: "屋外・プランター(日なた)", water: "土が乾いたらたっぷり", cycleDays: 2,
    tips: "春から晩秋まで咲き続ける優等生。野菜の近くに植えると虫よけ(コンパニオンプランツ)にも。",
    tasks: [
      { label: "種まき", months: [4, 5], note: "" },
      { label: "剪定", months: [8], note: "夏に切り戻すと秋また咲く" },
      { label: "開花", months: [5, 6, 7, 8, 9, 10, 11], note: "" },
    ],
  },
];
