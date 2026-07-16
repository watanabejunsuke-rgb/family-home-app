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

  // ---- 追加・編集シート ----
  function openContactSheet(contact) {
    const isEdit = !!contact;
    const nameInput = App.el("input", { type: "text", value: isEdit ? contact.name : "", placeholder: "例:ゆうたくん" });
    const birthdayInput = App.el("input", { type: "date", value: isEdit ? (contact.birthday || "") : "" });

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
    // ※ chipSelectは空文字を「未選択」として扱ってしまうため、「指定なし」「不明」にはダミー値を使う
    const NONE_VALUE = "__none__";
    const UNKNOWN_VALUE = "__unknown__";
    const fam = App.store.state.family;
    let relatedMemberId = isEdit ? (contact.relatedMemberId || "") : "";
    const relatedChips = fam.length
      ? App.chipSelect(
          [{ value: NONE_VALUE, label: "指定なし" }, ...fam.map((m) => ({ value: m.id, label: m.name }))],
          relatedMemberId || NONE_VALUE,
          (v) => { relatedMemberId = v === NONE_VALUE ? "" : v; syncGradeVisibility(); }
        )
      : null;

    // 学年(生年月日が分からない時の代わり。対象の子との相対学年を直接選ぶ)
    let gradeOffset = isEdit && contact.gradeOffset !== undefined ? String(contact.gradeOffset) : "";
    const gradeChips = App.chipSelect(
      [
        { value: UNKNOWN_VALUE, label: "不明" },
        { value: "2", label: "2つ上" }, { value: "1", label: "1つ上" }, { value: "0", label: "同学年" },
        { value: "-1", label: "1つ下" }, { value: "-2", label: "2つ下" },
      ],
      gradeOffset || UNKNOWN_VALUE,
      (v) => (gradeOffset = v === UNKNOWN_VALUE ? "" : v)
    );
    const gradeField = App.el("div", { class: "field" }, [
      App.el("span", { class: "field__label", text: "学年(生年月日が分からない場合。対象の子との比較)" }),
      gradeChips,
    ]);
    function syncGradeVisibility() {
      gradeField.style.display = relatedMemberId ? "" : "none";
    }
    syncGradeVisibility();

    const noteInput = App.el("textarea", { style: "min-height: 64px;", placeholder: "例:お母さんは◯◯さん。人見知りしない子。" });
    if (isEdit && contact.note) noteInput.value = contact.note;

    const saveBtn = App.el("button", { class: "btn-primary", text: isEdit ? "変更を保存" : "追加する" });
    const content = [
      App.field("なまえ", nameInput),
      App.field("生年月日(任意。分かれば年齢・学年を自動計算します)", birthdayInput),
      contextField,
    ];
    if (relatedChips) {
      content.push(
        App.el("div", { class: "field" }, [
          App.el("span", { class: "field__label", text: "どの子の関係?(任意)" }),
          relatedChips,
        ]),
        gradeField
      );
    }
    content.push(App.field("メモ(任意)", noteInput), saveBtn);

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
      s.close();
      App.store.update((st) => {
        if (isEdit) {
          const c = contactsOf().find((x) => x.id === contact.id);
          if (c) Object.assign(c, { name, context, note, birthday, relatedMemberId: relatedMemberId || undefined, gradeOffset: finalGradeOffset });
        } else {
          contactsOf().push({
            id: App.uid(), name, context, note, birthday,
            relatedMemberId: relatedMemberId || undefined,
            gradeOffset: finalGradeOffset,
            createdAt: Date.now(),
          });
        }
      });
      App.toast(isEdit ? "変更しました" : `「${name}」を追加しました`);
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

      // どの子の関係かで絞り込み(ALL + 家族の各メンバー)
      // ※ chipSelectは空文字を「未選択」として扱ってしまうため、ALLにはダミー値を使う
      const ALL_VALUE = "__all__";
      const fam = App.store.state.family;
      if (fam.length > 1) {
        section.appendChild(
          App.chipSelect(
            [{ value: ALL_VALUE, label: "ALL" }, ...fam.map((m) => ({ value: m.id, label: m.name }))],
            memberFilter || ALL_VALUE,
            (v) => { memberFilter = v === ALL_VALUE ? null : v; App.refresh(); }
          )
        );
      } else {
        memberFilter = null;
      }

      const byMember = memberFilter ? all.filter((c) => c.relatedMemberId === memberFilter) : all;

      // 関係での絞り込み(2種類以上あるときだけ出す。※ 対象は「どの子」フィルタ後の一覧から作る)
      const contexts = [...new Set(byMember.map((c) => c.context || "関係未設定"))].sort();
      if (contexts.length > 1) {
        section.appendChild(
          App.el("div", { style: "margin-top: var(--spacing-3);" }, [
            App.chipSelect(
              ["すべて", ...contexts],
              contextFilter || "すべて",
              (v) => { contextFilter = v === "すべて" ? null : v; App.refresh(); }
            ),
          ])
        );
      } else {
        contextFilter = null;
      }

      const filtered = (contextFilter ? byMember.filter((c) => (c.context || "関係未設定") === contextFilter) : byMember)
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
        card.appendChild(
          App.el("button", {
            class: "list-row",
            "aria-label": `${c.name}の情報を編集`,
            onclick: () => openContactSheet(c),
          }, [
            App.el("span", { class: "list-row__icon", style: "background: var(--cat-family-bg); color: var(--cat-family);", html: App.icon("heart", 18) }),
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
