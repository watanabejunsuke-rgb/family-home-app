// ============================================
// お友達・知り合い — 保育園・習い事などで増えていく「あの子誰だっけ」を防ぐための
// 軽量な人物ディレクトリ。「家族」(自分の家族)とは別枠、「メモ」より構造化された台帳
// ============================================
window.App = window.App || {};
App.screens = App.screens || {};

(function () {
  // どの子の関係か・関係(保育園のクラス・習い事名など)での絞り込み。セッション中だけ保持
  let memberFilter = null; // null = ALL
  let contextFilter = null;

  function contactsOf() {
    if (!App.store.state.contacts) App.store.state.contacts = [];
    return App.store.state.contacts;
  }

  // ---- 学年の相対計算(日本の学年区切り=4/2始まり)。厳密な生年月日が分かる場合に使う ----
  function academicYear(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr + "T00:00:00");
    if (isNaN(d)) return null;
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    // 4/2以降生まれはその年の学年、4/1以前生まれは前年度扱い
    return (m > 4 || (m === 4 && day >= 2)) ? y : y - 1;
  }

  // offset: 正=対象の子より学年が上(年上)、負=下(年下)、0=同学年
  function gradeLabel(offset) {
    if (offset === 0) return "同学年";
    return offset > 0 ? `${offset}つ上` : `${-offset}つ下`;
  }

  // 対象の子(relatedMemberId)を起点にした相対学年を、精度の高い順に計算する:
  // ①双方の生年月日が分かればそこから厳密計算 ②分からなければ手入力のgradeOffsetを使う
  function relativeGradeText(contact) {
    const related = contact.relatedMemberId ? App.data.member(contact.relatedMemberId) : null;
    if (!related) return null;
    if (contact.birthday && related.birthday) {
      const cy = academicYear(related.birthday);
      const fy = academicYear(contact.birthday);
      if (cy != null && fy != null) return `${related.name}と${gradeLabel(cy - fy)}`;
    }
    if (contact.gradeOffset !== undefined && contact.gradeOffset !== null && contact.gradeOffset !== "") {
      return `${related.name}と${gradeLabel(Number(contact.gradeOffset))}`;
    }
    return null;
  }

  // ---- 誕生日のカレンダー登録(任意)。calendar.jsの「毎年」くり返し予定を流用する ----
  // 過去の生年月日そのものを起点にすると、くり返しが過去年ぶんまで大量生成されてしまうため、
  // 直近の誕生日(今年まだなら今年、過ぎていれば来年)を起点日にする
  function nextBirthdayDate(birthday) {
    const b = new Date(birthday + "T00:00:00");
    const now = new Date();
    let occ = new Date(now.getFullYear(), b.getMonth(), b.getDate());
    if (App.date.str(occ) < App.date.today()) occ = new Date(now.getFullYear() + 1, b.getMonth(), b.getDate());
    return App.date.str(occ);
  }

  function buildBirthdayMemo(c) {
    const related = c.relatedMemberId ? App.data.member(c.relatedMemberId) : null;
    const lines = [];
    if (c.context) lines.push(`関係: ${c.context}`);
    if (related) lines.push(`どの子の関係: ${related.name}`);
    const grade = relativeGradeText(c);
    if (grade) lines.push(`学年: ${grade}`);
    if (c.birthday) {
      const d = new Date(c.birthday + "T00:00:00");
      lines.push(`生年月日: ${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`);
    }
    if (c.note) lines.push(`メモ: ${c.note}`);
    return lines.join("\n");
  }

  function offerAddBirthdayToCalendar(c) {
    App.confirm({
      title: "カレンダーにも追加しますか?",
      message: `「${c.name}の誕生日」を毎年くり返しの予定としてカレンダーに追加できます。`,
      okLabel: "追加する",
      onOk: () => {
        const start = nextBirthdayDate(c.birthday);
        const untilDate = new Date(start + "T00:00:00");
        untilDate.setFullYear(untilDate.getFullYear() + 50);
        const until = App.date.str(untilDate);
        const seriesId = `series-${App.uid()}`;
        const title = `${c.name}の誕生日`;
        const memo = buildBirthdayMemo(c);
        App.store.update((st) => {
          App.recurDates(start, "yearly", until).forEach((d) => {
            st.events.push({ id: App.uid(), title, date: d, memo, seriesId });
          });
        });
        App.toast("カレンダーに追加しました", "calendar");
      },
    });
  }

  // ---- 追加・編集シート ----
  function openContactSheet(contact) {
    const isEdit = !!contact;
    // 写真アップロードの紐付け先IDとして、新規作成でも保存前から使う(nameInput等と同じ並び)
    const contactId = isEdit ? contact.id : App.uid();
    const nameInput = App.el("input", { type: "text", value: isEdit ? contact.name : "", placeholder: "例:みーちゃん・ゆうたくん" });
    const birthdayInput = App.el("input", { type: "date", value: isEdit ? (contact.birthday || "") : "" });

    // 顔写真(任意・1枚のみ)。あとで見返すときに「あの子誰だっけ」を防ぐのが狙いなので、
    // 日記のような複数枚ギャラリーではなくプロフィール写真1枚で十分と判断した
    let photo = isEdit ? (contact.photo || null) : null;
    let uploadingPhoto = false;
    const photoInput = App.el("input", { type: "file", accept: "image/*", style: "display: none;" });
    const photoPreview = App.el("button", { type: "button", class: "contact-photo", "aria-label": "写真を追加・変更する" });
    const photoRemoveBtn = App.el("button", {
      type: "button",
      class: "section-header__action",
      style: "margin: 0 auto var(--spacing-4); display: none;",
      html: App.icon("trash", 14) + "<span>写真を削除</span>",
    });
    const syncPhotoUI = () => {
      photoPreview.classList.toggle("is-empty", !photo);
      photoPreview.style.backgroundImage = photo ? `url('${photo.url}')` : "none";
      photoPreview.innerHTML = photo ? "" : App.icon("camera", 24);
      photoRemoveBtn.style.display = photo ? "" : "none";
    };
    syncPhotoUI();
    photoPreview.addEventListener("click", () => {
      if (uploadingPhoto) return;
      if (!App.sync.enabled()) { App.toast("写真の保存には「家族と共有」の設定が必要です", "info"); return; }
      photoInput.click();
    });
    photoInput.addEventListener("change", async () => {
      const file = photoInput.files && photoInput.files[0];
      photoInput.value = "";
      if (!file) return;
      uploadingPhoto = true;
      photoPreview.classList.add("is-uploading");
      try {
        const base64 = await App.compressImageFile(file);
        const { id, url } = await App.sync.uploadPhoto(contactId, base64, "image/jpeg", contactId);
        const prevId = photo && photo.id;
        photo = { id, url };
        syncPhotoUI();
        if (prevId) App.sync.deletePhoto(prevId).catch(() => { /* サーバー側の削除に失敗しても表示からは消す */ });
        App.toast("写真を設定しました", "sparkle");
      } catch (e) {
        App.toast("写真をアップロードできませんでした。通信状況を確認してください。", "info");
      } finally {
        uploadingPhoto = false;
        photoPreview.classList.remove("is-uploading");
      }
    });
    photoRemoveBtn.addEventListener("click", () => {
      const prevId = photo && photo.id;
      photo = null;
      syncPhotoUI();
      if (prevId) App.sync.deletePhoto(prevId).catch(() => { /* サーバー側の削除に失敗しても表示からは消す */ });
    });
    const photoField = App.el("div", { style: "text-align: center;" }, [photoPreview, photoInput, photoRemoveBtn]);

    // 関係(保育園のクラス・習い事名など)。既にある関係から選ぶか、無ければ新規入力
    const NEW_CONTEXT = "__new__";
    const existingContexts = [...new Set(contactsOf().map((c) => c.context).filter(Boolean))].sort();
    const initialContext = isEdit ? (contact.context || "") : "";
    let getContext;
    let contextField;
    if (existingContexts.length > 0) {
      const knownInitial = initialContext && existingContexts.includes(initialContext);
      const contextSelect = App.el("select", {}, [
        ...existingContexts.map((c) =>
          App.el("option", { value: c, text: c, selected: c === initialContext ? "selected" : null })
        ),
        App.el("option", { value: NEW_CONTEXT, text: "＋ 新しい関係を追加", selected: knownInitial ? null : "selected" }),
      ]);
      const newContextInput = App.el("input", { type: "text", value: knownInitial ? "" : initialContext, placeholder: "例:保育園ひまわり組・スイミング" });
      const newContextField = App.field("新しい関係の名前", newContextInput);
      const syncContextMode = () => { newContextField.style.display = contextSelect.value === NEW_CONTEXT ? "" : "none"; };
      contextSelect.addEventListener("change", () => { syncContextMode(); if (contextSelect.value === NEW_CONTEXT) newContextInput.focus(); });
      syncContextMode();
      contextField = App.el("div", {}, [App.field("関係(保育園・習い事など)", contextSelect), newContextField]);
      getContext = () => (contextSelect.value === NEW_CONTEXT ? newContextInput.value.trim() : contextSelect.value);
    } else {
      const contextInput = App.el("input", { type: "text", value: initialContext, placeholder: "例:保育園ひまわり組・スイミング" });
      contextField = App.field("関係(保育園・習い事など)", contextInput);
      getContext = () => contextInput.value.trim();
    }

    // どの子の関係か(任意。学年の相対表示・一覧の絞り込みに使う)
    // ※ chipSelectは空文字を「未選択」として扱ってしまうため、「指定なし」にはダミー値を使う
    const NONE_VALUE = "__none__";
    const fam = App.store.state.family;
    let relatedMemberId = isEdit ? (contact.relatedMemberId || "") : "";
    const relatedChips = fam.length
      ? App.chipSelect(
          [{ value: NONE_VALUE, label: "指定なし" }, ...fam.map((m) => ({ value: m.id, label: m.name }))],
          relatedMemberId || NONE_VALUE,
          (v) => { relatedMemberId = v === NONE_VALUE ? "" : v; syncGradeVisibility(); }
        )
      : null;

    // 学年(生年月日が分からない時の代わり。対象の子との相対学年を直接選ぶ)。
    // 選択肢が多い(上下6学年ずつ)ためチップではなくプルダウン(Bottom Sheet)で表現する
    let gradeOffset = isEdit && contact.gradeOffset !== undefined ? String(contact.gradeOffset) : "";
    const gradeOptions = [{ value: "", label: "不明" }];
    for (let o = 6; o >= -6; o--) gradeOptions.push({ value: String(o), label: gradeLabel(o) });
    const gradeField = App.pickerField(
      "学年(生年月日が分からない場合。対象の子との比較)",
      gradeOptions,
      gradeOffset,
      (v) => (gradeOffset = v),
      { placeholder: "不明" }
    );
    function syncGradeVisibility() {
      gradeField.style.display = relatedMemberId ? "" : "none";
    }
    syncGradeVisibility();

    const noteInput = App.el("textarea", { style: "min-height: 64px;", placeholder: "例:お母さんは◯◯さん。人見知りしない子。" });
    if (isEdit && contact.note) noteInput.value = contact.note;

    const saveBtn = App.el("button", { class: "btn-primary", text: isEdit ? "変更を保存" : "追加する" });
    const content = [photoField, App.field("呼び方(いつも呼んでいる名前)", nameInput), contextField];
    if (relatedChips) {
      content.push(
        App.el("div", { class: "field" }, [
          App.el("span", { class: "field__label", text: "どの子の関係?(任意)" }),
          relatedChips,
        ]),
        gradeField
      );
    }
    content.push(
      App.field("生年月日(任意。分かれば年齢・学年を自動計算します)", birthdayInput),
      App.field("メモ(任意)", noteInput),
      saveBtn
    );

    if (isEdit) {
      const del = App.el("button", { class: "btn-danger-text", html: App.icon("trash", 16) + "<span>削除する</span>" });
      del.addEventListener("click", () => {
        App.confirm({
          title: "削除しますか?",
          message: `「${contact.name}」の記録を削除します。この操作は取り消せません。`,
          okLabel: "削除する",
          danger: true,
          onOk: () => {
            s.close();
            App.store.update((st) => {
              st.contacts = contactsOf().filter((c) => c.id !== contact.id);
            });
            App.toast("削除しました", "trash");
          },
        });
      });
      content.push(del);
    }

    const s = App.sheet(isEdit ? "お友達の情報を編集" : "お友達を追加", content);
    saveBtn.addEventListener("click", () => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); App.toast("なまえを入力してください", "info"); return; }
      const context = getContext();
      const note = noteInput.value.trim();
      const birthday = birthdayInput.value || undefined;
      const finalGradeOffset = relatedMemberId && gradeOffset !== "" ? Number(gradeOffset) : undefined;
      const savedFields = { name, context, note, birthday, relatedMemberId: relatedMemberId || undefined, gradeOffset: finalGradeOffset, photo: photo || undefined };
      // 誕生日が新しく登録された/変わった時だけカレンダー追加を案内する(毎回は聞かない)
      const birthdayChanged = !!birthday && (!isEdit || birthday !== (contact.birthday || ""));
      s.close();
      App.store.update((st) => {
        if (isEdit) {
          const c = contactsOf().find((x) => x.id === contact.id);
          if (c) Object.assign(c, savedFields);
        } else {
          contactsOf().push({ id: contactId, ...savedFields, createdAt: Date.now() });
        }
      });
      App.toast(isEdit ? "変更しました" : `「${name}」を追加しました`);
      if (birthdayChanged) offerAddBirthdayToCalendar(savedFields);
    });
  }

  App.screens.contacts = {
    title: "お友達・知り合い",
    back: true,

    render(container) {
      container.appendChild(
        App.el("p", {
          class: "section",
          style: "font-size: var(--text-sub); color: var(--color-text-secondary);",
          text: "保育園・習い事などのお友達を記録しておけます。",
        })
      );

      const all = contactsOf();
      const section = App.el("section", { class: "section", style: "margin-top: 0;" });

      if (all.length === 0) {
        section.appendChild(
          App.el("div", { class: "card card--lg" }, [
            App.emptyState("heart", "まだ記録がありません", "右下の+から、お友達の名前と関係を残しておけます。"),
          ])
        );
        container.appendChild(section);
        container.appendChild(App.fab("お友達を追加", () => openContactSheet(null)));
        return;
      }

      // 2つのフィルタ(誰の関係・どこの関係)は互いに独立させる。選択肢は常に全件(all)から作り、
      // 一方を切り替えてももう一方の選択肢が入れ替わらない/選択が失われないようにする
      const ALL_VALUE = "__all__";
      const fam = App.store.state.family;
      if (fam.length > 1) {
        section.appendChild(
          App.el("div", {}, [
            App.el("span", { class: "field__label", text: "誰の関係" }),
            App.chipSelect(
              [{ value: ALL_VALUE, label: "ALL" }, ...fam.map((m) => ({ value: m.id, label: m.name }))],
              memberFilter || ALL_VALUE,
              (v) => { memberFilter = v === ALL_VALUE ? null : v; App.refresh(); }
            ),
          ])
        );
      } else {
        memberFilter = null;
      }

      const contexts = [...new Set(all.map((c) => c.context || "関係未設定"))].sort();
      // 関係の種類が1つでもあれば出す(「保育園」しかまだ無くても、後で増えたときのために
      // ALL/保育園を先に見せておく。実際に絞り込みが要らないのは全員が無関係のときだけ)
      if (contexts.length > 1 || (contexts.length === 1 && contexts[0] !== "関係未設定")) {
        if (contextFilter && !contexts.includes(contextFilter)) contextFilter = null;
        // 関係の種類は際限なく増えうるため、折り返さず横スクロールにする(誰の関係は
        // 家族という少人数の固定集合なので折り返しのままでよい)
        const contextChips = App.chipSelect(
          [{ value: ALL_VALUE, label: "ALL" }, ...contexts.map((c) => ({ value: c, label: c }))],
          contextFilter || ALL_VALUE,
          (v) => { contextFilter = v === ALL_VALUE ? null : v; App.refresh(); }
        );
        contextChips.classList.add("chip-row--scroll");
        section.appendChild(
          App.el("div", { style: "margin-top: var(--spacing-4);" }, [
            App.el("span", { class: "field__label", text: "どこの関係" }),
            contextChips,
          ])
        );
      } else {
        contextFilter = null;
      }

      const filtered = all
        .filter((c) => !memberFilter || c.relatedMemberId === memberFilter)
        .filter((c) => !contextFilter || (c.context || "関係未設定") === contextFilter)
        .slice()
        .sort((a, b) => (a.name || "").localeCompare(b.name || "", "ja"));

      const card = App.el("div", { class: "card card--lg", style: "margin-top: var(--spacing-3);" });
      if (filtered.length === 0) {
        card.appendChild(App.emptyState("heart", "該当するお友達がいません", ""));
      }
      filtered.forEach((c) => {
        const age = App.ageLabel(c.birthday);
        const grade = relativeGradeText(c);
        const subParts = [c.context || "関係未設定"];
        if (age) subParts.push(age);
        if (grade) subParts.push(grade);
        const avatarEl = c.photo
          ? App.el("span", { class: "avatar avatar--photo", style: `background-image: url('${c.photo.url}');` })
          : App.el("span", { class: "avatar", style: "background: var(--cat-family-bg); color: var(--cat-family);", html: App.icon("heart", 18) });
        card.appendChild(
          App.el("button", {
            class: "list-row",
            "aria-label": `${c.name}の情報を編集`,
            onclick: () => openContactSheet(c),
          }, [
            avatarEl,
            App.el("span", { class: "list-row__body" }, [
              App.el("span", { text: c.name }),
              App.el("span", { class: "list-row__sub", text: subParts.join("・") }),
            ]),
            App.el("span", { class: "chevron", html: App.icon("chevron", 16) }),
          ])
        );
      });
      section.appendChild(card);
      container.appendChild(section);

      container.appendChild(App.fab("お友達を追加", () => openContactSheet(null)));
    },
  };
})();
