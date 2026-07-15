// ============================================
// 植物の記録 — 一覧(今日どうするかだけの最小情報)+ 詳細(1鉢の物語)
// 詳細は #plants/<id> というパラメータ付きルートで開く(app.jsのルーティング拡張に対応)。
// お手入れ予定は「この日」または「期間(〇日〜〇日)」で登録できる。
// ============================================
window.App = window.App || {};
App.screens = App.screens || {};

(function () {
  const CARE_TYPES = ["摘芯", "植え替え", "肥料", "剪定", "その他"];
  // クイック記録バーに常設する種類(水やりは別枠でwateredAtを直接更新するため含めない)
  const QUICK_CARE_LABELS = ["肥料", "植え替え", "剪定"];

  // 古いデータにcareTasksが無い場合に備える
  function careTasksOf(p) {
    if (!p.careTasks) p.careTasks = [];
    return p.careTasks;
  }

  // アップロード中の植物ID(一時的な表示状態。永続化しない)
  const uploadingIds = new Set();

  function fmtShort(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  // 図鑑データとの名前のゆるい一致(pedia.jsのisOwnedと対になる向き)
  function matchPedia(p) {
    return (App.PLANTPEDIA || []).find(
      (e) => p.name && (p.name.includes(e.name) || e.name.includes(p.name))
    );
  }

  // お手入れ予定の時期表示とステータス
  function careStatus(t) {
    const today = App.date.today();
    if (t.mode === "range") {
      const period = `${fmtShort(t.startDate)}〜${fmtShort(t.endDate)}`;
      if (today < t.startDate) {
        const days = Math.round((new Date(t.startDate) - new Date(today)) / 86400000);
        return { period, badge: `あと${days}日`, cls: "badge--muted" };
      }
      if (today > t.endDate) return { period, badge: "期間すぎ", cls: "badge--warning" };
      return { period, badge: "いま適期", cls: "badge--success" };
    }
    const period = App.fmtDate(t.date, { weekday: false });
    if (t.date < today) return { period, badge: "すぎています", cls: "badge--warning" };
    if (t.date === today) return { period, badge: "今日", cls: "badge--success" };
    return { period, badge: `あと${Math.round((new Date(t.date) - new Date(today)) / 86400000)}日`, cls: "badge--muted" };
  }

  // 一覧での並び:適期・今日 → 近い順
  function careSortKey(t) {
    return t.mode === "range" ? t.startDate : t.date;
  }

  // 「今日やること」を1メッセージに要約する(最優先① — 一瞬で分かることを最重要視)。
  // 優先度: 水やり目安日 > お手入れ予定(今日/適期/期限すぎ) > 平常時は次に何があるかを添える
  function heroStatus(p) {
    const today = App.date.today();
    const waterLeft = App.plantDaysLeft(p);
    if (waterLeft <= 0) {
      return {
        tone: "warn",
        headline: `「${p.name}」に水やりの目安日です`,
        sub: waterLeft === 0 ? "今日が目安日です" : `目安日から${-waterLeft}日たっています`,
      };
    }
    const tasks = careTasksOf(p);
    const withStatus = tasks.map((c) => ({ c, s: careStatus(c) }));
    const urgent = withStatus.find((x) => ["今日", "いま適期", "すぎています", "期間すぎ"].includes(x.s.badge));
    if (urgent) {
      const { c, s } = urgent;
      const phrase =
        s.badge === "いま適期" ? "いま適期です" :
        s.badge === "期間すぎ" ? "適期をすぎています" :
        s.badge === "すぎています" ? "予定日をすぎています" : "予定日です";
      return { tone: "warn", headline: `「${c.label}」が${phrase}`, sub: s.period };
    }
    // 平常時:水やりとお手入れ予定のうち、一番近いものを添える
    let sub = `次の水やりまで あと${waterLeft}日`;
    tasks.forEach((c) => {
      const target = c.mode === "range" ? c.startDate : c.date;
      if (!target) return;
      const days = Math.round((new Date(target) - new Date(today)) / 86400000);
      if (days >= 0 && days < waterLeft) sub = `「${c.label}」予定まで あと${days}日`;
    });
    return { tone: "calm", headline: "今日は何もしなくてOK", sub };
  }

  // クイック記録:同じ種類の予定(お手入れ予定)があれば完了扱いに、無ければその場でお世話履歴へ直接記録する
  function quickRecord(plant, label) {
    const pending = careTasksOf(plant).find((t) => t.label === label);
    if (pending) {
      completeCare(plant, pending);
      return;
    }
    App.store.update((st) => {
      const p = st.plants.find((x) => x.id === plant.id);
      if (!p) return;
      if (!p.careLog) p.careLog = [];
      p.careLog.push({ label, doneAt: App.date.today() });
    });
    App.toast(`「${label}」を記録しました`, "checkCircle");
  }

  // ---- お手入れ予定の追加・編集シート ----
  function openCareSheet(plant, task) {
    const isEdit = !!task;
    const data = task
      ? { ...task }
      : { label: CARE_TYPES[0], mode: "date", date: App.date.today(), startDate: App.date.today(), endDate: App.date.daysAhead(14) };

    const labelInput = App.el("input", { type: "text", value: data.label, placeholder: "例:摘芯" });
    const typeChips = App.chipSelect(CARE_TYPES, CARE_TYPES.includes(data.label) ? data.label : "その他", (v) => {
      if (v !== "その他") labelInput.value = v;
      else labelInput.value = "";
      labelInput.focus();
    });

    // 「この日」/「期間」の切替
    const dateInput = App.el("input", { type: "date", value: data.date || App.date.today() });
    const startInput = App.el("input", { type: "date", value: data.startDate || App.date.today() });
    const endInput = App.el("input", { type: "date", value: data.endDate || App.date.daysAhead(14) });
    const dateField = App.field("実施日", dateInput);
    const rangeFields = App.el("div", {}, [
      App.field("開始日", startInput),
      App.field("終了日", endInput),
    ]);
    const syncMode = () => {
      dateField.style.display = data.mode === "date" ? "" : "none";
      rangeFields.style.display = data.mode === "range" ? "" : "none";
    };
    const modeChips = App.chipSelect(
      [{ value: "date", label: "この日に" }, { value: "range", label: "期間で(〇日〜〇日)" }],
      data.mode,
      (v) => { data.mode = v; syncMode(); }
    );
    syncMode();

    const saveBtn = App.el("button", { class: "btn-primary", text: isEdit ? "変更を保存" : "お手入れ予定を追加" });
    const content = [
      App.el("div", { class: "field" }, [
        App.el("span", { class: "field__label", text: "お手入れの種類" }),
        typeChips,
      ]),
      App.field("内容", labelInput),
      App.el("div", { class: "field" }, [
        App.el("span", { class: "field__label", text: "時期の決め方" }),
        modeChips,
      ]),
      dateField,
      rangeFields,
      saveBtn,
    ];
    if (isEdit) {
      const del = App.el("button", { class: "btn-danger-text", html: App.icon("trash", 16) + "<span>この予定を削除</span>" });
      del.addEventListener("click", () => {
        s.close();
        App.store.update((st) => {
          const p = st.plants.find((x) => x.id === plant.id);
          if (p) p.careTasks = careTasksOf(p).filter((t) => t.id !== task.id);
        });
        App.toast("お手入れ予定を削除しました", "trash");
      });
      content.push(del);
    }

    const s = App.sheet(isEdit ? "お手入れ予定を編集" : `${plant.name}のお手入れ予定`, content);
    saveBtn.addEventListener("click", () => {
      const label = labelInput.value.trim();
      if (!label) { labelInput.focus(); App.toast("内容を入力してください", "info"); return; }
      if (data.mode === "range" && startInput.value > endInput.value) {
        App.toast("終了日は開始日より後にしてください", "info");
        return;
      }
      s.close();
      App.store.update((st) => {
        const p = st.plants.find((x) => x.id === plant.id);
        if (!p) return;
        const payload = {
          label,
          mode: data.mode,
          date: data.mode === "date" ? dateInput.value : null,
          startDate: data.mode === "range" ? startInput.value : null,
          endDate: data.mode === "range" ? endInput.value : null,
        };
        if (isEdit) {
          const t = careTasksOf(p).find((x) => x.id === task.id);
          if (t) Object.assign(t, payload);
        } else {
          careTasksOf(p).push({ id: App.uid(), ...payload });
        }
      });
      App.toast(isEdit ? "変更しました" : `「${label}」の予定を追加しました`);
    });
  }

  function completeCare(plant, task) {
    App.store.update((st) => {
      const p = st.plants.find((x) => x.id === plant.id);
      if (!p) return;
      p.careTasks = careTasksOf(p).filter((t) => t.id !== task.id);
      if (!p.careLog) p.careLog = [];
      p.careLog.push({ label: task.label, doneAt: App.date.today() });
    });
    App.toast(`「${task.label}」を完了しました`);
  }

  // ---- 植物の写真登録(Google Driveに保存し、URLだけをplant.photosに持つ) ----
  // 写真に「摘芯」等のコメントを付けると、同時にお世話履歴(careLog)にも記録する
  // (写真を撮る→アップロードする、お世話をした→履歴に残す、を別々の操作にせず1つの流れにする)
  const PHOTO_LABELS = ["コメントなし", "摘芯", "植え替え", "肥料", "剪定", "その他"];

  function photosOf(p) {
    if (!p.photos) p.photos = [];
    return p.photos;
  }

  function openPhotoConfirmSheet(plant, file) {
    const previewUrl = URL.createObjectURL(file);
    const labelInput = App.el("input", { type: "text", value: "", placeholder: "コメント(任意。例:摘芯しました)" });
    const chips = App.chipSelect(PHOTO_LABELS, "コメントなし", (v) => {
      if (v === "コメントなし") labelInput.value = "";
      else if (v === "その他") { labelInput.value = ""; labelInput.focus(); }
      else labelInput.value = v;
    });
    const saveBtn = App.el("button", { class: "btn-primary", html: App.icon("plus", 18) + "<span>写真を追加</span>" });
    const s = App.sheet("写真を追加", [
      App.el("img", { src: previewUrl, alt: "選んだ写真のプレビュー", class: "photo-viewer__img" }),
      App.el("div", { class: "field" }, [
        App.el("span", { class: "field__label", text: "お世話の記録(任意。付けると履歴にも残ります)" }),
        chips,
      ]),
      App.field("コメント", labelInput),
      saveBtn,
    ]);
    saveBtn.addEventListener("click", () => {
      s.close();
      uploadPhotoWithLabel(plant, file, labelInput.value.trim());
    });
  }

  async function uploadPhotoWithLabel(plant, file, label) {
    uploadingIds.add(plant.id);
    App.refresh();
    try {
      const base64 = await App.compressImageFile(file);
      const { id, url } = await App.sync.uploadPhoto(plant.id, base64, "image/jpeg", plant.id);
      App.store.update((st) => {
        const p = st.plants.find((x) => x.id === plant.id);
        if (!p) return;
        photosOf(p).push({ id, url, addedAt: App.date.today(), label: label || "" });
        if (label) {
          if (!p.careLog) p.careLog = [];
          p.careLog.push({ label, doneAt: App.date.today() });
        }
      });
      App.toast(label ? `「${label}」を記録し、写真を追加しました` : "写真を追加しました", "sparkle");
    } catch (e) {
      App.toast("写真をアップロードできませんでした。通信状況を確認してください。", "info");
    } finally {
      uploadingIds.delete(plant.id);
      App.refresh();
    }
  }

  function openPhotoSheet(plant, photo) {
    const delBtn = App.el("button", { class: "btn-danger-text", html: App.icon("trash", 16) + "<span>この写真を削除</span>" });
    const s = App.sheet(plant.name, [
      App.el("img", { src: photo.url, alt: `${plant.name}の写真`, class: "photo-viewer__img" }),
      photo.label ? App.el("span", { class: "badge badge--success", style: "margin-bottom: var(--spacing-2);", text: photo.label }) : null,
      App.el("p", { class: "photo-viewer__date", text: `${App.fmtDate(photo.addedAt, { weekday: false })}に追加` }),
      delBtn,
    ]);
    delBtn.addEventListener("click", () => {
      s.close();
      App.store.update((st) => {
        const p = st.plants.find((x) => x.id === plant.id);
        if (p) p.photos = photosOf(p).filter((ph) => ph.id !== photo.id);
      });
      App.sync.deletePhoto(photo.id).catch(() => { /* サーバー側の削除に失敗しても表示からは消す */ });
      App.toast("写真を削除しました", "trash");
    });
  }

  // ---- 植物本体の追加・編集シート ----
  // opts.name / opts.cycleDays: 図鑑「うちの植物に追加」からの事前入力(新規時のみ)
  function openPlantSheet(plant, opts) {
    const isEdit = !!plant;
    opts = opts || {};
    let cycle = isEdit ? plant.cycleDays : (opts.cycleDays || 7);
    const nameInput = App.el("input", { type: "text", value: isEdit ? plant.name : (opts.name || ""), placeholder: "例:パキラ" });
    const placeInput = App.el("input", { type: "text", value: isEdit ? plant.place : "", placeholder: "例:リビング" });
    const saveBtn = App.el("button", { class: "btn-primary", text: isEdit ? "変更を保存" : "植物を追加" });

    const content = [
      App.field("植物の名前", nameInput),
      App.field("置き場所", placeInput),
      App.el("div", { class: "field" }, [
        App.el("span", { class: "field__label", text: "水やりの間隔" }),
        App.chipSelect(
          [1, 2, 3, 5, 7, 10, 14].map((d) => ({ value: d, label: `${d}日ごと` })),
          cycle,
          (v) => (cycle = v)
        ),
      ]),
      saveBtn,
    ];
    if (isEdit) {
      const del = App.el("button", { class: "btn-danger-text", html: App.icon("trash", 16) + "<span>この植物を削除</span>" });
      del.addEventListener("click", () => {
        App.confirm({
          title: "植物を削除しますか?",
          message: `「${plant.name}」の記録を削除します。この操作は取り消せません。`,
          okLabel: "削除する",
          danger: true,
          onOk: () => {
            s.close();
            // 削除は詳細画面(設定)からしか呼べないため、消えたページに留まらず先に一覧へ戻してから消す
            App.go("plants");
            App.store.update((st) => {
              st.plants = st.plants.filter((p) => p.id !== plant.id);
            });
            App.toast("削除しました", "trash");
          },
        });
      });
      content.push(del);
    }

    const s = App.sheet(isEdit ? "植物を編集" : "植物を追加", content);
    saveBtn.addEventListener("click", () => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); App.toast("植物の名前を入力してください", "info"); return; }
      s.close();
      App.store.update((st) => {
        if (isEdit) {
          const p = st.plants.find((x) => x.id === plant.id);
          if (p) Object.assign(p, { name, place: placeInput.value.trim(), cycleDays: cycle });
        } else {
          st.plants.push({ id: App.uid(), name, place: placeInput.value.trim(), cycleDays: cycle, wateredAt: App.date.today(), careTasks: [], careLog: [], photos: [] });
        }
      });
      App.toast(isEdit ? "変更しました" : `「${name}」を追加しました`);
    });
  }

  // 図鑑「うちの植物に追加」から呼べるよう公開(App.openTaskSheetと同じパターン)
  App.openPlantSheet = openPlantSheet;

  // ============================================
  // 一覧 — 「今日どの鉢に触るべきか」だけが3秒で分かることに徹する
  // ============================================
  function renderPlantList(container) {
    const plants = App.store.state.plants;

    container.appendChild(
      App.el("section", { class: "section", style: "margin-top: var(--spacing-4);" }, [
        App.sectionHeader("うちの植物", {
          icon: "leaf",
          actionLabel: "図鑑を見る",
          onAction: () => App.go("pedia"),
        }),
      ])
    );

    const section = App.el("section", { class: "section", style: "margin-top: 0;" });

    if (plants.length === 0) {
      section.appendChild(
        App.el("div", { class: "card card--lg" }, [
          App.emptyState("leaf", "植物がまだ登録されていません", "右下の+から最初のひと鉢を追加しましょう。"),
        ])
      );
    }

    // 対応が必要なものを先に(水やり目安日 → お手入れ適期・今日・期限すぎ → それ以外は登録順)
    const rank = (p) => {
      if (App.plantDaysLeft(p) <= 0) return 0;
      const urgent = careTasksOf(p).some((t) => ["今日", "いま適期", "すぎています", "期間すぎ"].includes(careStatus(t).badge));
      return urgent ? 1 : 2;
    };
    const sorted = [...plants].sort((a, b) => rank(a) - rank(b));

    sorted.forEach((p) => {
      const left = App.plantDaysLeft(p);
      const due = left <= 0;
      const careUrgent = careTasksOf(p).find((t) => ["今日", "いま適期", "すぎています", "期間すぎ"].includes(careStatus(t).badge));
      const photos = photosOf(p);
      const latestPhoto = photos.length ? photos[photos.length - 1] : null;

      const thumb = latestPhoto
        ? App.el("span", { class: "plant-row__thumb", style: `background-image: url('${latestPhoto.url}');` })
        : App.el("span", { class: "plant-row__thumb plant-row__thumb--empty", html: App.icon("leaf", 20) });

      let badge;
      if (due) badge = App.el("span", { class: "badge badge--warning", text: "そろそろ水やり" });
      else if (careUrgent) badge = App.el("span", { class: "badge badge--warning", text: careUrgent.label });
      else badge = App.el("span", { class: "badge badge--muted", text: `あと${left}日` });

      const navBtn = App.el("button", {
        class: "plant-row__main",
        "aria-label": `「${p.name}」の詳細を見る(${due ? "そろそろ水やり" : `あと${left}日`})`,
        onclick: () => App.go("plants", p.id),
      }, [
        thumb,
        App.el("span", { class: "plant-row__body" }, [
          App.el("span", { class: "plant-row__name", text: p.name }),
          App.el("span", { class: "plant-row__place", text: p.place || "置き場所未設定" }),
        ]),
        badge,
      ]);

      const waterBtn = App.el("button", {
        class: "icon-btn plant-row__water" + (due ? " plant-row__water--due" : ""),
        "aria-label": `「${p.name}」に水やりした`,
        html: App.icon("drop", 20),
        onclick: () => {
          App.store.update((st) => {
            const x = st.plants.find((k) => k.id === p.id);
            if (x) x.wateredAt = App.date.today();
          });
          App.toast(`「${p.name}」に水やりしました`, "drop");
        },
      });

      section.appendChild(App.el("div", { class: "plant-row" }, [navBtn, waterBtn]));
    });

    container.appendChild(section);
    container.appendChild(App.fab("植物を追加", () => openPlantSheet(null)));
  }

  // ============================================
  // 詳細 — 1鉢の物語。写真→今日やること→記録→成長→履歴→設定の順
  // ============================================
  function renderPlantDetail(container, id) {
    const p = App.store.state.plants.find((x) => x.id === id);
    if (!p) {
      container.appendChild(
        App.el("div", { class: "card card--lg" }, [
          App.emptyState("leaf", "この植物は見つかりません", "削除されたか、リンクが古い可能性があります。"),
        ])
      );
      container.appendChild(
        App.el("button", {
          class: "btn-secondary", style: "margin-top: var(--spacing-3); width: 100%;",
          text: "植物の一覧へ戻る", onclick: () => App.go("plants"),
        })
      );
      return;
    }

    const status = heroStatus(p);
    const pedia = matchPedia(p);
    const photos = photosOf(p);
    const heroPhoto = photos.length ? photos[photos.length - 1] : null;

    // ---- ヒーロー写真(直近の写真。無ければ葉アイコン+淡いグラデーションへフォールバック) ----
    const hero = App.el("div", { class: "plant-hero" + (heroPhoto ? "" : " plant-hero--empty") });
    if (heroPhoto) {
      hero.appendChild(
        App.el("button", {
          class: "plant-hero__photo",
          "aria-label": "写真を見る",
          style: `background-image: url('${heroPhoto.url}');`,
          onclick: () => openPhotoSheet(p, heroPhoto),
        })
      );
      hero.appendChild(App.el("div", { class: "plant-hero__scrim" }));
    } else {
      hero.appendChild(App.el("span", { class: "plant-hero__icon", html: App.icon("leaf", 36) }));
    }
    hero.appendChild(
      App.el("div", { class: "plant-hero__caption" }, [
        App.el("p", { class: "plant-hero__name", text: p.name }),
        App.el("p", { class: "plant-hero__place", text: p.place || "置き場所未設定" }),
      ])
    );
    container.appendChild(hero);

    // ---- 状態ヒーローカード(最優先①:今日やることが一瞬で分かる) ----
    container.appendChild(
      App.el("div", { class: `plant-status plant-status--${status.tone}` }, [
        App.el("p", { class: "plant-status__headline", text: status.headline }),
        App.el("p", { class: "plant-status__sub", text: status.sub }),
      ])
    );

    // ---- クイック記録バー(最優先③:ワンタップで記録) ----
    const waterQuick = App.el("button", { class: "quick-record" }, [
      App.el("span", { class: "quick-record__icon", html: App.icon("drop", 20) }),
      App.el("span", { class: "quick-record__label", text: "水やり" }),
    ]);
    waterQuick.addEventListener("click", () => {
      App.store.update((st) => {
        const x = st.plants.find((k) => k.id === p.id);
        if (x) x.wateredAt = App.date.today();
      });
      App.toast(`「${p.name}」に水やりしました`, "drop");
    });
    const quickBar = App.el("div", { class: "quick-record-bar" }, [
      waterQuick,
      ...QUICK_CARE_LABELS.map((label) => {
        const btn = App.el("button", { class: "quick-record" }, [
          App.el("span", { class: "quick-record__icon", html: App.icon("leaf", 20) }),
          App.el("span", { class: "quick-record__label", text: label }),
        ]);
        btn.addEventListener("click", () => quickRecord(p, label));
        return btn;
      }),
    ]);
    container.appendChild(App.el("section", { class: "section" }, [quickBar]));

    // ---- お手入れ予定(あらかじめ日程を決めておくもの) ----
    const careSection = App.el("section", { class: "section" }, [
      App.sectionHeader("お手入れ予定", { icon: "leaf" }),
    ]);
    const careCard = App.el("div", { class: "card card--lg" });
    const careList = App.el("div", { class: "care-list" });
    const tasks = [...careTasksOf(p)].sort((a, b) => careSortKey(a).localeCompare(careSortKey(b)));
    if (tasks.length === 0) {
      careCard.appendChild(App.emptyState("leaf", "予定はまだありません", "植え替え・剪定などの予定日を決めておけます。"));
    } else {
      tasks.forEach((t) => {
        const st = careStatus(t);
        careList.appendChild(
          App.el("div", { class: "care-item" }, [
            App.el("button", {
              class: "care-item__main",
              "aria-label": `「${t.label}」を編集`,
              onclick: () => openCareSheet(p, t),
            }, [
              App.el("span", { class: "care-item__label", text: t.label }),
              App.el("span", { class: "care-item__period", text: st.period }),
            ]),
            App.el("span", { class: `badge ${st.cls}`, text: st.badge }),
            App.el("button", {
              class: "icon-btn",
              "aria-label": `「${t.label}」を完了にする`,
              html: App.icon("check", 18),
              onclick: () => completeCare(p, t),
            }),
          ])
        );
      });
      careCard.appendChild(careList);
    }
    careCard.appendChild(
      App.el("button", {
        class: "section-header__action",
        style: "margin-top: var(--spacing-2);",
        html: App.icon("plus", 14) + "<span>お手入れ予定を追加(摘芯・植え替えなど)</span>",
        onclick: () => openCareSheet(p, null),
      })
    );
    careSection.appendChild(careCard);
    container.appendChild(careSection);

    // ---- 成長の記録:写真タイムライン(最優先②:育っている実感) ----
    const photoInput = App.el("input", { type: "file", accept: "image/*", style: "display: none;" });
    photoInput.addEventListener("change", () => {
      const file = photoInput.files && photoInput.files[0];
      if (file) openPhotoConfirmSheet(p, file);
      photoInput.value = "";
    });
    const uploading = uploadingIds.has(p.id);
    const addTile = App.el("button", {
      class: "photo-strip__add" + (uploading ? " is-uploading" : ""),
      "aria-label": `「${p.name}」の写真を追加`,
      html: uploading ? App.icon("clock", 20) : App.icon("plus", 20),
      onclick: () => {
        if (uploading) return;
        if (!App.sync.enabled()) {
          App.toast("写真の保存には「家族と共有」の設定が必要です", "info");
          return;
        }
        photoInput.click();
      },
    });
    const growthSection = App.el("section", { class: "section" }, [
      App.sectionHeader(photos.length ? `成長の記録(${photos.length}枚)` : "成長の記録", { icon: "camera" }),
    ]);
    const growthCard = App.el("div", { class: "card card--lg" }, [
      App.el("div", { class: "photo-strip" }, [
        ...[...photos].reverse().map((ph) =>
          App.el("button", {
            class: "photo-strip__thumb",
            "aria-label": `${p.name}の写真を見る(${App.fmtDate(ph.addedAt, { weekday: false })})`,
            style: `background-image: url('${ph.url}');`,
            onclick: () => openPhotoSheet(p, ph),
          })
        ),
        addTile,
        photoInput,
      ]),
    ]);
    growthSection.appendChild(growthCard);
    container.appendChild(growthSection);

    // ---- 最近のお世話履歴 ----
    const recentLog = [...(p.careLog || [])].sort((a, b) => (b.doneAt || "").localeCompare(a.doneAt || "")).slice(0, 8);
    if (recentLog.length) {
      container.appendChild(
        App.el("section", { class: "section" }, [
          App.sectionHeader("最近のお世話", { icon: "clock" }),
          App.el("div", { class: "card card--lg" }, [
            App.el("p", {
              class: "plant-care-history__items",
              text: recentLog.map((c) => `${fmtShort(c.doneAt)} ${c.label}`).join("・"),
            }),
          ]),
        ])
      );
    }

    // ---- 今月の図鑑ヒント(参考情報) ----
    const myTips = App.data.plantPediaTips().filter((t) => t.plantId === p.id);
    if (myTips.length) {
      container.appendChild(
        App.el("section", { class: "section" }, [
          App.sectionHeader(`今月のヒント(${new Date().getMonth() + 1}月)`, { icon: "note" }),
          App.el("div", { class: "plant-pedia-tip" }, myTips.map((t) =>
            App.el("div", { class: "plant-pedia-tip__row" }, [
              App.el("p", { class: "plant-pedia-tip__item", text: `${t.label}・${t.meta}` }),
              App.el("button", {
                class: "plant-pedia-tip__skip",
                "aria-label": `「${t.label}」を今年はやらない`,
                text: "今年は見送り",
                onclick: () => {
                  App.data.skipPediaTip(p.id, t.label);
                  App.toast(`「${t.label}」は今年は見送りにしました`, "info");
                },
              }),
              App.el("button", {
                class: "plant-pedia-tip__done",
                "aria-label": `「${t.label}」をやった記録として残す`,
                text: "やった",
                onclick: () => {
                  App.data.logPediaTip(p.id, t.label);
                  App.toast(`「${p.name}」の${t.label}を記録しました`, "checkCircle");
                },
              }),
            ])
          )),
        ])
      );
    }

    // ---- 設定(置き場所・周期・図鑑・編集・削除。折りたたみ) ----
    const settingsCard = App.el("div", { class: "card card--lg", style: "display: none;" }, [
      App.el("p", { class: "plant-settings__row", text: `置き場所:${p.place || "未設定"}` }),
      App.el("p", { class: "plant-settings__row", text: `水やりの間隔:${p.cycleDays}日ごと` }),
      App.el("p", { class: "plant-settings__row", text: `前回の水やり:${App.fmtDate(p.wateredAt, { weekday: false })}` }),
      pedia
        ? App.el("button", {
            class: "section-header__action", style: "margin-top: var(--spacing-3);",
            html: App.icon("note", 14) + "<span>図鑑でこの植物を見る</span>",
            onclick: () => App.openPediaFor(pedia.id),
          })
        : null,
      App.el("button", {
        class: "btn-secondary", style: "margin-top: var(--spacing-4); width: 100%;",
        html: App.icon("edit", 16) + "<span>植物の情報を編集(削除もこちらから)</span>",
        onclick: () => openPlantSheet(p),
      }),
    ]);
    const settingsToggle = App.el("button", {
      class: "section-header__action",
      html: App.icon("settings", 14) + "<span>設定を見る(置き場所・水やり周期など)</span>",
    });
    settingsToggle.addEventListener("click", () => {
      settingsToggle.style.display = "none";
      settingsCard.style.display = "";
    });
    container.appendChild(
      App.el("section", { class: "section" }, [settingsToggle, settingsCard])
    );
  }

  App.screens.plants = {
    title: (id) => {
      if (!id) return "植物の記録";
      const p = App.store.state.plants.find((x) => x.id === id);
      return p ? p.name : "植物の記録";
    },
    back: true,

    render(container, id) {
      if (id) renderPlantDetail(container, id);
      else renderPlantList(container);
    },
  };
})();
