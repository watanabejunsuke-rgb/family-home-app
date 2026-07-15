// ============================================
// メモ・日記 — 残しておきたいことを気軽に
// ============================================
window.App = window.App || {};
App.screens = App.screens || {};

(function () {
  let tab = "memo"; // "memo" | "diary"

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
    // 新規作成中に画面を離れても消えないよう、既存の下書きがあれば復元する(編集時は本物のデータがあるので対象外)
    const draft = !isEdit ? loadDrafts()[type] : null;
    // 新規作成でも先にIDを決めておき、「保存」を待たずに下書き段階から写真を追加できるようにする
    const noteId = isEdit ? note.id : (draft && draft.noteId) || App.uid();
    let draftPhotos = isEdit ? photosOf(note).slice() : (draft && draft.photos) || [];
    let uploading = false;

    const titleInput = App.el("input", { type: "text", value: isEdit ? note.title : (draft && draft.title) || "", placeholder: "例:保育園の夏祭り" });
    const dateInput = App.el("input", { type: "date", value: isEdit ? note.date : (draft && draft.date) || App.date.today() });
    const bodyInput = App.el("textarea", { placeholder: isDiary ? "今日あったこと、感じたことを自由に。" : "内容をメモしておきましょう。" });
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
      saveDraft(type, { noteId, title, body, date: dateInput.value, photos: draftPhotos, savedAt: Date.now() });
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
    content.push(App.field(isDiary ? "今日のできごと" : "内容", bodyInput));
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

    content.push(saveBtn);

    // メモは「やること」に近い内容になることがあるので、ワンタップで移せる導線を置く
    if (isEdit && !isDiary) {
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

    if (isEdit) {
      const del = App.el("button", { class: "btn-danger-text", html: App.icon("trash", 16) + "<span>削除する</span>" });
      del.addEventListener("click", () => {
        App.confirm({
          title: isDiary ? "日記を削除しますか?" : "メモを削除しますか?",
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

    const s = App.sheet(
      isEdit ? (isDiary ? "日記を編集" : "メモを編集") : isDiary ? "今日の日記" : "メモを追加",
      content
    );
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
      App.store.update((st) => {
        if (isEdit) {
          const n = st.notes.find((x) => x.id === note.id);
          if (n) Object.assign(n, { title, body, date: isDiary ? dateInput.value : n.date, updatedAt: Date.now() });
        } else {
          st.notes.unshift({
            id: noteId,
            type,
            title: isDiary ? "" : title,
            body,
            date: isDiary ? dateInput.value : App.date.today(),
            updatedAt: Date.now(),
            ...(draftPhotos.length ? { photos: draftPhotos.slice() } : {}),
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

      const notes = App.store.state.notes
        .filter((n) => n.type === tab)
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

      const section = App.el("section", { class: "section", style: "margin-top: 0;" });
      if (notes.length === 0) {
        section.appendChild(
          App.el("div", { class: "card card--lg" }, [
            tab === "memo"
              ? App.emptyState("note", "メモはまだありません", "覚えておきたいことを気軽に残しましょう。")
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
            ])
          );
        });
        section.appendChild(board);
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
            ])
          );
        });
      }
      container.appendChild(section);

      container.appendChild(App.fab(tab === "memo" ? "メモを追加" : "日記を書く", () => openNoteSheet(null)));
    },
  };
})();
