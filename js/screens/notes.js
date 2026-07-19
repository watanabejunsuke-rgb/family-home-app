// ============================================
// メモ・日記 — 残しておきたいことを気軽に
// ============================================
window.App = window.App || {};
App.screens = App.screens || {};

(function () {
  let tab = "memo"; // "memo" | "diary"
  // タグでの絞り込み(タブごとに独立。セッション中だけ保持し、タブ切り替えで解除)
  let tagFilter = null;

  function tagsOf(n) {
    if (!n.tags) n.tags = [];
    return n.tags;
  }

  // ---- 検討ノートへの追記(コメント)。Slackのスレッド返信のように本文とは別に積み上げる ----
  function commentsOf(n) {
    if (!n.comments) n.comments = [];
    return n.comments;
  }
  function fmtDateTime(ts) {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  // ---- AIに相談する時に貼り付けやすいよう、依頼文つきでコピーする ----
  const AI_PROMPT_TEMPLATE =
    "以下は家族で書き溜めているメモです。内容を整理して、次に考えたり決めたりすると良いことをアドバイスしてください。";

  // ---- 新規作成中の下書き(画面を離れても消えないよう端末内に残す。世帯同期はしない) ----
  const DRAFT_KEY = "wagaya-home-note-draft-v1";
  function loadDrafts() {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveDraft(type, draft) {
    const all = loadDrafts();
    all[type] = draft;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(all)); } catch (e) { /* 容量オーバー等は諦める */ }
  }
  function clearDraft(type) {
    const all = loadDrafts();
    delete all[type];
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(all)); } catch (e) { /* 容量オーバー等は諦める */ }
  }

  // ---- メモ・日記への写真登録(Google Driveに保存。植物の写真と同じ仕組みを流用) ----
  function photosOf(n) {
    if (!n.photos) n.photos = [];
    return n.photos;
  }

  function openNotePhotoSheet(photo, onDelete) {
    const delBtn = App.el("button", { class: "btn-danger-text", html: App.icon("trash", 16) + "<span>この写真を削除</span>" });
    const s = App.sheet("写真", [
      App.el("img", { src: photo.url, alt: "日記の写真", class: "photo-viewer__img" }),
      delBtn,
    ]);
    delBtn.addEventListener("click", () => {
      s.close();
      onDelete(photo);
    });
  }

  function openNoteSheet(note) {
    const isEdit = !!note;
    const type = isEdit ? note.type : tab;
    const isDiary = type === "diary";
    const isThread = type === "thread";
    // 新規作成中に画面を離れても消えないよう、既存の下書きがあれば復元する(編集時は本物のデータがあるので対象外)
    const draft = !isEdit ? loadDrafts()[type] : null;
    // 新規作成でも先にIDを決めておき、「保存」を待たずに下書き段階から写真を追加できるようにする
    const noteId = isEdit ? note.id : (draft && draft.noteId) || App.uid();
    let draftPhotos = isEdit ? photosOf(note).slice() : (draft && draft.photos) || [];
    // 追記(コメント)は本文と違って下書き保存の対象にしない(保存済みの検討ノートにのみ追記できる)
    let draftComments = isEdit ? commentsOf(note).slice() : [];
    let uploading = false;

    const titleInput = App.el("input", {
      type: "text",
      value: isEdit ? note.title : (draft && draft.title) || "",
      placeholder: isThread ? "例:子供の習い事、旅行の行き先" : "例:保育園の夏祭り",
    });
    const dateInput = App.el("input", { type: "date", value: isEdit ? note.date : (draft && draft.date) || App.date.today() });
    const bodyInput = App.el("textarea", {
      class: "textarea--note-body",
      placeholder: isDiary
        ? "今日あったこと、感じたことを自由に。"
        : isThread
        ? "きっかけや今考えていることを書いてください。あとから気づいたことを追記できます。"
        : "気づいたこと、あとで見直したいことを書いてください",
    });
    if (isEdit) bodyInput.value = note.body;
    else if (draft && draft.body) bodyInput.value = draft.body;
    const saveBtn = App.el("button", { class: "btn-primary", text: isEdit ? "変更を保存" : "保存する" });

    if (!isEdit && draft && (draft.title || draft.body || draftPhotos.length)) {
      App.toast("下書きを復元しました", "info");
    }

    // 新規作成中は入力のたびに下書きとして端末内に保存する(離脱しても次回復元できる)
    let draftSaveTimer = null;
    const commitDraft = () => {
      if (isEdit) return;
      const body = bodyInput.value;
      const title = titleInput.value;
      if (!body.trim() && !title.trim() && draftPhotos.length === 0) {
        clearDraft(type);
        return;
      }
      saveDraft(type, { noteId, title, body, date: dateInput.value, photos: draftPhotos, tags: tagsInput.value, savedAt: Date.now() });
    };
    const commitDraftDebounced = () => {
      if (isEdit) return;
      clearTimeout(draftSaveTimer);
      draftSaveTimer = setTimeout(commitDraft, 500);
    };
    titleInput.addEventListener("input", commitDraftDebounced);
    bodyInput.addEventListener("input", commitDraftDebounced);
    dateInput.addEventListener("input", commitDraftDebounced);

    // 本文にURLがあれば、その場で開けるボタンを出す(入力中もリアルタイムに追随)
    const linkBtn = App.el("button", { class: "btn-secondary", style: "margin-bottom: var(--spacing-3);", html: App.icon("link", 16) + "<span>リンクを開く</span>" });
    const syncLinkBtn = () => {
      const url = App.firstUrl(bodyInput.value);
      linkBtn.style.display = url ? "" : "none";
      linkBtn.onclick = () => window.open(url, "_blank", "noopener,noreferrer");
    };
    bodyInput.addEventListener("input", syncLinkBtn);
    syncLinkBtn();

    const content = [];
    if (isDiary) content.push(App.field("日付", dateInput));
    else content.push(App.field("タイトル", titleInput));
    content.push(App.field(isDiary ? "今日のできごと" : isThread ? "最初のメモ" : "内容", bodyInput));
    content.push(linkBtn);

    // 写真登録(メモ・日記どちらも。新規作成中でも追加でき、保存すると紐づく)
    {
      const photoStrip = App.el("div", { class: "photo-strip" });
      const photoInput = App.el("input", { type: "file", accept: "image/*", style: "display: none;" });
      const addTile = App.el("button", {
        class: "photo-strip__add",
        "aria-label": "写真を追加",
        html: App.icon("plus", 20),
        onclick: () => {
          if (uploading) return;
          if (!App.sync.enabled()) {
            App.toast("写真の保存には「家族と共有」の設定が必要です", "info");
            return;
          }
          photoInput.click();
        },
      });

      // App.refreshは背後の画面(#screen)だけを再描画し、開いているシートには届かないため、
      // 写真の増減はこの中で直接ストリップを描き直す
      const renderPhotoStrip = () => {
        photoStrip.innerHTML = "";
        draftPhotos.forEach((ph) => {
          photoStrip.appendChild(
            App.el("button", {
              class: "photo-strip__thumb",
              "aria-label": "写真を見る",
              style: `background-image: url('${ph.url}');`,
              onclick: () => openNotePhotoSheet(ph, removeDraftPhoto),
            })
          );
        });
        photoStrip.appendChild(addTile);
      };

      // 編集中なら保存ボタンを待たずに写真の増減をその場で永続化し、新規作成中なら下書きに反映する
      const persistPhotos = () => {
        if (isEdit) {
          App.store.update((st) => {
            const n = st.notes.find((x) => x.id === note.id);
            if (n) n.photos = draftPhotos.slice();
          });
        } else {
          commitDraft();
        }
      };

      function removeDraftPhoto(photo) {
        draftPhotos = draftPhotos.filter((ph) => ph.id !== photo.id);
        persistPhotos();
        App.sync.deletePhoto(photo.id).catch(() => { /* サーバー側の削除に失敗しても表示からは消す */ });
        renderPhotoStrip();
        App.toast("写真を削除しました", "trash");
      }

      photoInput.addEventListener("change", async () => {
        const file = photoInput.files && photoInput.files[0];
        photoInput.value = "";
        if (!file) return;
        uploading = true;
        addTile.classList.add("is-uploading");
        addTile.innerHTML = App.icon("clock", 20);
        try {
          const base64 = await App.compressImageFile(file);
          const { id, url } = await App.sync.uploadPhoto(noteId, base64, "image/jpeg", noteId);
          draftPhotos.push({ id, url, addedAt: App.date.today() });
          persistPhotos();
          App.toast("写真を追加しました", "sparkle");
        } catch (e) {
          App.toast("写真をアップロードできませんでした。通信状況を確認してください。", "info");
        } finally {
          uploading = false;
          addTile.classList.remove("is-uploading");
          addTile.innerHTML = App.icon("plus", 20);
          renderPhotoStrip();
        }
      });

      renderPhotoStrip();
      content.push(
        App.el("div", { class: "field" }, [
          App.el("span", { class: "field__label", text: "写真" }),
          photoStrip,
          photoInput,
        ])
      );
    }

    // 検討ノートへの追記(コメント)。保存済みのノートにのみ、Slackのスレッド返信のように積み上げていく
    if (isThread && isEdit) {
      const threadList = App.el("div", { style: "margin-bottom: var(--spacing-3);" });

      const persistComments = () => {
        App.store.update((st) => {
          const n = st.notes.find((x) => x.id === note.id);
          if (n) { n.comments = draftComments.slice(); n.updatedAt = Date.now(); }
        });
      };

      const renderThread = () => {
        threadList.innerHTML = "";
        if (draftComments.length === 0) {
          threadList.appendChild(
            App.el("p", { style: "font-size: var(--text-caption); color: var(--color-text-muted);", text: "まだやりとりはありません。気づいたことを追記していきましょう。" })
          );
        }
        draftComments.forEach((c) => {
          const delBtn = App.el("button", { class: "icon-btn", "aria-label": "この追記を削除", html: App.icon("x", 14) });
          delBtn.addEventListener("click", () => {
            App.confirm({
              title: "この追記を削除しますか?",
              message: "この操作は取り消せません。",
              okLabel: "削除する",
              danger: true,
              onOk: () => {
                draftComments = draftComments.filter((x) => x.id !== c.id);
                persistComments();
                renderThread();
                App.toast("削除しました", "trash");
              },
            });
          });
          threadList.appendChild(
            App.el("div", { class: "card", style: "margin-bottom: var(--spacing-2); padding: var(--spacing-3); display: flex; gap: var(--spacing-2); align-items: flex-start; justify-content: space-between;" }, [
              App.el("div", {}, [
                App.el("p", { style: "font-size: var(--text-caption); color: var(--color-text-muted); margin-bottom: 2px;", text: fmtDateTime(c.createdAt) }),
                App.el("p", { style: "font-size: var(--text-sub); white-space: pre-wrap;", text: c.text }),
              ]),
              delBtn,
            ])
          );
        });
      };

      const commentInput = App.el("textarea", { style: "min-height: 64px;", placeholder: "気づいたこと、次に考えたいことを追記できます。" });
      const commentAddBtn = App.el("button", { class: "btn-secondary", html: App.icon("send", 16) + "<span>追記する</span>" });
      commentAddBtn.addEventListener("click", () => {
        const text = commentInput.value.trim();
        if (!text) return;
        draftComments.push({ id: App.uid(), text, createdAt: Date.now() });
        persistComments();
        commentInput.value = "";
        renderThread();
        App.toast("追記しました", "sparkle");
      });

      renderThread();
      content.push(
        App.el("div", { class: "field" }, [
          App.el("span", { class: "field__label", text: "やりとり" }),
          threadList,
          commentInput,
          App.el("div", { style: "margin-top: var(--spacing-2);" }, [commentAddBtn]),
        ])
      );
    } else if (isThread) {
      content.push(
        App.el("p", { style: "font-size: var(--text-caption); color: var(--color-text-muted); margin-top: -8px; margin-bottom: var(--spacing-4);", text: "保存すると、あとから気づいたことをここに追記していけます。" })
      );
    }

    // タグ(スペース区切りで複数。過去に使ったタグはチップから追加できる)
    const existingTags = [...new Set(App.store.state.notes.flatMap((n) => tagsOf(n)))].sort();
    const tagsInput = App.el("input", { type: "text", value: isEdit ? tagsOf(note).join(" ") : (draft && draft.tags) || "", placeholder: "例: 学校 病院(スペース区切り)" });
    tagsInput.addEventListener("input", commitDraftDebounced);
    const tagFields = [App.field("タグ(任意)", tagsInput)];
    if (existingTags.length) {
      tagFields.push(
        App.el("div", { class: "chip-row", style: "margin-top: var(--spacing-2);" }, existingTags.map((t) =>
          App.el("button", {
            class: "chip", type: "button", text: t,
            onclick: () => {
              const cur = tagsInput.value.trim().split(/\s+/).filter(Boolean);
              if (!cur.includes(t)) { cur.push(t); tagsInput.value = cur.join(" "); }
            },
          })
        ))
      );
    }
    content.push(...tagFields);

    // AIに相談する時に貼り付けやすいよう、含める項目を選んでまとめてコピーできるようにする
    if (isThread) {
      const copyOpts = { title: true, tags: true, body: true, comments: isEdit, prompt: true };
      const makeCheckRow = (key, label) => {
        const box = App.el("span", { class: "check-row__box", html: App.icon("check", 14) });
        const row = App.el("button", {
          class: "check-row",
          type: "button",
          "aria-pressed": String(copyOpts[key]),
          onclick: () => {
            copyOpts[key] = !copyOpts[key];
            row.setAttribute("aria-pressed", String(copyOpts[key]));
          },
        }, [box, App.el("span", { text: label })]);
        return row;
      };
      const checkRows = [
        makeCheckRow("title", "タイトル"),
        makeCheckRow("tags", "タグ"),
        makeCheckRow("body", "本文"),
      ];
      if (isEdit) checkRows.push(makeCheckRow("comments", "やりとり(コメント)"));
      checkRows.push(makeCheckRow("prompt", "AIへの依頼文を添える"));

      const copyBtn = App.el("button", { class: "btn-secondary", html: App.icon("copy", 16) + "<span>コピーする</span>" });
      copyBtn.addEventListener("click", () => {
        const parts = [];
        if (copyOpts.prompt) parts.push(AI_PROMPT_TEMPLATE);
        const titleVal = titleInput.value.trim();
        const tagsVal = tagsInput.value.trim().split(/\s+/).filter(Boolean);
        const bodyVal = bodyInput.value.trim();
        if (copyOpts.title && titleVal) parts.push(`【タイトル】\n${titleVal}`);
        if (copyOpts.tags && tagsVal.length) parts.push(`【タグ】\n${tagsVal.join(" ")}`);
        if (copyOpts.body && bodyVal) parts.push(`【本文】\n${bodyVal}`);
        if (copyOpts.comments && draftComments.length) {
          parts.push(`【やりとり】\n${draftComments.map((c) => `- ${fmtDateTime(c.createdAt)} ${c.text}`).join("\n")}`);
        }
        const text = parts.join("\n\n");
        if (!text) { App.toast("コピーする内容がありません", "info"); return; }
        App.copyText(text)
          .then(() => App.toast("コピーしました。AIアプリに貼り付けてください", "sparkle"))
          .catch(() => App.toast("コピーできませんでした", "info"));
      });

      content.push(
        App.el("div", { class: "field" }, [
          App.el("span", { class: "field__label", text: "AI相談用にコピー" }),
          App.el("div", { style: "display: flex; flex-direction: column; gap: var(--spacing-2);" }, checkRows),
          App.el("div", { style: "margin-top: var(--spacing-3);" }, [copyBtn]),
        ])
      );
    }

    // メモは「やること」に近い内容になることがあるので、ワンタップで移せる導線を置く
    // (検討ノートはやりとり(コメント)が失われてしまうため対象外)
    if (isEdit && !isDiary && !isThread) {
      const convert = App.el("button", {
        class: "btn-secondary",
        style: "margin-top: var(--spacing-3);",
        html: App.icon("checkCircle", 16) + "<span>このメモをやることにする</span>",
      });
      convert.addEventListener("click", () => {
        const body = bodyInput.value.trim();
        const title = (titleInput.value.trim() || body.split("\n")[0] || "").slice(0, 60);
        if (!title) { App.toast("内容を入力してください", "info"); return; }
        s.close();
        // やること追加シートを開いて日付(今日/日付を指定/いつでも)を選んでもらう。
        // URLや詳しい内容が消えてしまわないよう、本文はそのままメモ欄に引き継ぐ。
        // 保存されたときだけ元メモを削除する(キャンセルすればメモは残る)
        App.openTaskSheet(null, {
          prefillTitle: title,
          prefillMemo: body,
          onCreate: (st) => { st.notes = st.notes.filter((n) => n.id !== note.id); },
          successToast: "やることに移しました",
        });
      });
      content.push(convert);
    }

    // メモは書いた後に「これは検討ノートだった/日記だった」と気づくことがあるので、タブをまたいで移せるようにする
    if (isEdit && type === "memo") {
      const moveNote = (newType) => {
        const titleVal = titleInput.value.trim();
        const bodyVal = bodyInput.value.trim();
        const tagsVal = tagsInput.value.trim().split(/\s+/).filter(Boolean);
        s.close();
        clearTimeout(draftSaveTimer);
        App.store.update((st) => {
          const n = st.notes.find((x) => x.id === note.id);
          if (!n) return;
          n.tags = tagsVal;
          n.updatedAt = Date.now();
          if (newType === "diary") {
            // 日記にタイトル欄はないので、本文の先頭に含めて引き継ぐ
            n.type = "diary";
            n.title = "";
            n.body = titleVal ? `${titleVal}\n\n${bodyVal}` : bodyVal;
            if (!n.date) n.date = App.date.today();
          } else {
            n.type = newType;
            n.title = titleVal;
            n.body = bodyVal;
          }
        });
        App.toast(newType === "diary" ? "日記に移しました" : "検討ノートに移しました", "sparkle");
      };

      const moveToThread = App.el("button", {
        class: "btn-secondary",
        style: "margin-top: var(--spacing-3);",
        html: App.icon("sparkle", 16) + "<span>検討ノートに移す</span>",
      });
      moveToThread.addEventListener("click", () => moveNote("thread"));
      content.push(moveToThread);

      const moveToDiary = App.el("button", {
        class: "btn-secondary",
        style: "margin-top: var(--spacing-3);",
        html: App.icon("heart", 16) + "<span>日記にする</span>",
      });
      moveToDiary.addEventListener("click", () => moveNote("diary"));
      content.push(moveToDiary);
    }

    if (isEdit) {
      const del = App.el("button", { class: "btn-danger-text", html: App.icon("trash", 16) + "<span>削除する</span>" });
      del.addEventListener("click", () => {
        App.confirm({
          title: isDiary ? "日記を削除しますか?" : isThread ? "検討ノートを削除しますか?" : "メモを削除しますか?",
          message: "この操作は取り消せません。",
          okLabel: "削除する",
          danger: true,
          onOk: () => {
            s.close();
            App.store.update((st) => {
              st.notes = st.notes.filter((n) => n.id !== note.id);
            });
            App.toast("削除しました", "trash");
          },
        });
      });
      content.push(del);
    }

    // 保存ボタンは本文を広く取っても押しやすいよう、シート下部に固定して最後に置く
    content.push(App.el("div", { class: "note-save-bar" }, [saveBtn]));

    const s = App.sheet(
      isEdit
        ? isDiary ? "日記を編集" : isThread ? "検討ノートを編集" : "メモを編集"
        : isDiary ? "今日の日記" : isThread ? "検討ノートを追加" : "メモを追加",
      content
    );
    s.node.classList.add("sheet--note-edit");
    saveBtn.addEventListener("click", () => {
      const body = bodyInput.value.trim();
      const title = titleInput.value.trim();
      if (!body && !title) {
        (isDiary ? bodyInput : titleInput).focus();
        App.toast("内容を入力してください", "info");
        return;
      }
      s.close();
      clearTimeout(draftSaveTimer);
      if (!isEdit) clearDraft(type);
      const tags = tagsInput.value.trim().split(/\s+/).filter(Boolean);
      App.store.update((st) => {
        if (isEdit) {
          const n = st.notes.find((x) => x.id === note.id);
          if (n) Object.assign(n, { title, body, date: isDiary ? dateInput.value : n.date, updatedAt: Date.now(), tags });
        } else {
          st.notes.unshift({
            id: noteId,
            type,
            title: isDiary ? "" : title,
            body,
            date: isDiary ? dateInput.value : App.date.today(),
            updatedAt: Date.now(),
            ...(draftPhotos.length ? { photos: draftPhotos.slice() } : {}),
            ...(tags.length ? { tags } : {}),
          });
        }
      });
      App.toast("保存しました");
    });
  }

  App.screens.notes = {
    title: "メモ・日記",
    back: true,

    render(container) {
      const segment = App.el("div", { class: "segment", role: "tablist" });
      [
        { key: "memo", label: "メモ" },
        { key: "thread", label: "検討" },
        { key: "diary", label: "日記" },
      ].forEach((t) => {
        segment.appendChild(
          App.el("button", {
            class: "segment__btn",
            role: "tab",
            "aria-pressed": String(tab === t.key),
            text: t.label,
            onclick: () => { tab = t.key; App.refresh(); },
          })
        );
      });
      container.appendChild(segment);

      // タグ絞り込み(タブ内に1つでもタグが使われていれば出す)
      const tabNotes = App.store.state.notes.filter((n) => n.type === tab);
      const allTags = [...new Set(tabNotes.flatMap((n) => tagsOf(n)))].sort();
      if (allTags.length > 0) {
        container.appendChild(
          App.el("div", { class: "section", style: "margin-top: var(--spacing-3);" }, [
            App.chipSelect(
              ["すべて", ...allTags],
              tagFilter || "すべて",
              (v) => { tagFilter = v === "すべて" ? null : v; App.refresh(); }
            ),
          ])
        );
      } else {
        tagFilter = null;
      }

      // 検討ノートは日付でなく「最近やりとりがあった順」で並べる
      const notes = tabNotes
        .filter((n) => !tagFilter || tagsOf(n).includes(tagFilter))
        .sort((a, b) =>
          tab === "thread"
            ? (b.updatedAt || 0) - (a.updatedAt || 0)
            : (b.date || "").localeCompare(a.date || "")
        );

      const section = App.el("section", { class: "section", style: "margin-top: 0;" });
      if (notes.length === 0) {
        section.appendChild(
          App.el("div", { class: "card card--lg" }, [
            tab === "memo"
              ? App.emptyState("note", "メモはまだありません", "覚えておきたいことを気軽に残しましょう。")
              : tab === "thread"
              ? App.emptyState("sparkle", "検討ノートはまだありません", "気になることを書き留めて、あとから気づいたことを追記していきましょう。")
              : App.emptyState("heart", "日記はまだありません", "一行だけでも、あとで宝物になります。"),
          ])
        );
      } else if (tab === "memo") {
        // メモ:タイトル主役の付箋ボード(北欧トーンの色を並び順で循環)
        const board = App.el("div", { class: "note-board" });
        notes.forEach((n, i) => {
          const c = App.paletteColor((i % 6) + 1);
          board.appendChild(
            App.el("button", {
              class: "note-sticky",
              style: `background: ${c.bg};`,
              "aria-label": `${n.title || "メモ"}を開く`,
              onclick: () => openNoteSheet(n),
            }, [
              n.title ? App.el("p", { class: "note-sticky__title", style: `color: ${c.fg};`, text: n.title }) : null,
              App.el("p", { class: "note-sticky__body" }, [
                App.firstUrl(n.body) ? App.el("span", { class: "link-badge", html: App.icon("link", 12) }) : null,
                n.body,
              ]),
              n.photos && n.photos.length
                ? App.el("p", { class: "note-sticky__meta", html: App.icon("camera", 12) + `<span>${n.photos.length}枚</span>` })
                : null,
              n.tags && n.tags.length
                ? App.el("div", { style: "display: flex; flex-wrap: wrap; gap: 4px; margin-top: var(--spacing-1);" },
                    n.tags.map((t) => App.el("span", { class: "badge badge--muted", text: t }))
                  )
                : null,
            ])
          );
        });
        section.appendChild(board);
      } else if (tab === "thread") {
        // 検討ノート:タイトル主役のカードリスト(やりとり件数を添える)
        notes.forEach((n) => {
          const commentCount = commentsOf(n).length;
          section.appendChild(
            App.el("button", {
              class: "card card--lg card--tappable note-card",
              style: "width: 100%; text-align: left; display: block;",
              "aria-label": `${n.title || "検討ノート"}を開く`,
              onclick: () => openNoteSheet(n),
            }, [
              n.title ? App.el("p", { class: "note-card__title", text: n.title }) : null,
              App.el("p", { class: "note-card__body" }, [
                App.firstUrl(n.body) ? App.el("span", { class: "link-badge", html: App.icon("link", 12) }) : null,
                n.body,
              ]),
              commentCount
                ? App.el("p", { class: "note-sticky__meta", html: App.icon("send", 12) + `<span>${commentCount}件のやりとり</span>` })
                : null,
              n.photos && n.photos.length
                ? App.el("img", { src: n.photos[0].url, alt: "", class: "note-card__thumb" })
                : null,
              n.tags && n.tags.length
                ? App.el("div", { style: "display: flex; flex-wrap: wrap; gap: 4px; margin-top: var(--spacing-2);" },
                    n.tags.map((t) => App.el("span", { class: "badge badge--muted", text: t }))
                  )
                : null,
            ])
          );
        });
      } else {
        // 日記:日付主役のタイムライン
        notes.forEach((n) => {
          section.appendChild(
            App.el("button", {
              class: "card card--lg card--tappable note-card",
              style: "width: 100%; text-align: left; display: block;",
              "aria-label": `${App.fmtDate(n.date)}の日記を開く`,
              onclick: () => openNoteSheet(n),
            }, [
              App.el("p", { class: "note-card__date", text: App.fmtDate(n.date) }),
              App.el("p", { class: "note-card__body" }, [
                App.firstUrl(n.body) ? App.el("span", { class: "link-badge", html: App.icon("link", 12) }) : null,
                n.body,
              ]),
              n.photos && n.photos.length
                ? App.el("img", { src: n.photos[0].url, alt: "", class: "note-card__thumb" })
                : null,
              n.tags && n.tags.length
                ? App.el("div", { style: "display: flex; flex-wrap: wrap; gap: 4px; margin-top: var(--spacing-2);" },
                    n.tags.map((t) => App.el("span", { class: "badge badge--muted", text: t }))
                  )
                : null,
            ])
          );
        });
      }
      container.appendChild(section);

      const fabLabel = tab === "memo" ? "メモを追加" : tab === "thread" ? "検討ノートを追加" : "日記を書く";
      container.appendChild(App.fab(fabLabel, () => openNoteSheet(null)));
    },
  };
})();
