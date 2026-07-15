// ============================================
// 植物の記録 — 水やり周期 + お手入れ予定(摘芯・植え替え等)
// お手入れ予定は「この日」または「期間(〇日〜〇日)」で登録できる。
// ============================================
window.App = window.App || {};
App.screens = App.screens || {};

(function () {
  const CARE_TYPES = ["摘芯", "植え替え", "肥料", "剪定", "その他"];

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

  App.screens.plants = {
    title: "植物の記録",
    back: true,

    render(container) {
      const plants = App.store.state.plants;
      const pediaTips = App.data.plantPediaTips();

      // 図鑑への導線(何月に何をすべきかはこちらで確認できる)
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

      plants.forEach((p) => {
        const left = App.plantDaysLeft(p);
        const elapsedRatio = Math.min(1, Math.max(0, (p.cycleDays - left) / p.cycleDays));
        const due = left <= 0;
        const pedia = matchPedia(p);
        const badge = due
          ? App.el("span", { class: "badge badge--warning", text: "そろそろ水やり" })
          : App.el("span", { class: "badge badge--muted", text: `あと${left}日` });

        const waterBtn = App.el("button", {
          class: due ? "btn-primary" : "btn-secondary",
          html: App.icon("drop", 18) + "<span>水やりした</span>",
        });
        waterBtn.addEventListener("click", () => {
          App.store.update((st) => {
            const x = st.plants.find((k) => k.id === p.id);
            if (x) x.wateredAt = App.date.today();
          });
          App.toast(`「${p.name}」に水やりしました`, "drop");
        });

        // ---- お手入れ予定リスト ----
        const careList = App.el("div", { class: "care-list" });
        const tasks = [...careTasksOf(p)].sort((a, b) => careSortKey(a).localeCompare(careSortKey(b)));
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
        careList.appendChild(
          App.el("button", {
            class: "section-header__action",
            html: App.icon("plus", 14) + "<span>お手入れ予定を追加(摘芯・植え替えなど)</span>",
            onclick: () => openCareSheet(p, null),
          })
        );

        // 図鑑由来の今月のお世話ヒント(参考情報。「やった」を押すと履歴に記録され、今月は消える)
        const myTips = pediaTips.filter((t) => t.plantId === p.id);
        const tipBox = myTips.length
          ? App.el("div", { class: "plant-pedia-tip" }, [
              App.el("p", { class: "plant-pedia-tip__label", text: `今月のヒント(${new Date().getMonth() + 1}月)` }),
              ...myTips.map((t) =>
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
              ),
            ])
          : null;

        // 最近のお世話履歴(直近4件。水やりは頻度が高いので別扱い・ここには含めない)
        const recentLog = [...(p.careLog || [])].sort((a, b) => (b.doneAt || "").localeCompare(a.doneAt || "")).slice(0, 4);
        const historyBox = recentLog.length
          ? App.el("div", { class: "plant-care-history" }, [
              App.el("p", { class: "plant-care-history__label", text: "最近のお世話" }),
              App.el("p", {
                class: "plant-care-history__items",
                text: recentLog.map((c) => `${fmtShort(c.doneAt)} ${c.label}`).join("・"),
              }),
            ])
          : null;

        // 写真(Driveに保存。サムネイル横並び+追加タイル)
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
        const photoBox = App.el("div", { class: "plant-photos" }, [
          App.el("p", { class: "plant-photos__label", text: "写真" }),
          App.el("div", { class: "photo-strip" }, [
            ...photosOf(p).map((ph) =>
              App.el("button", {
                class: "photo-strip__thumb",
                "aria-label": `${p.name}の写真を見る`,
                style: `background-image: url('${ph.url}');`,
                onclick: () => openPhotoSheet(p, ph),
              })
            ),
            addTile,
            photoInput,
          ]),
        ]);

        section.appendChild(
          App.el("div", { class: "card card--lg plant-card" }, [
            App.el("div", { class: "plant-card__head" }, [
              App.el("span", { class: "plant-card__icon", html: App.icon("leaf", 20) }),
              App.el("div", { style: "flex: 1; min-width: 0;" }, [
                App.el("p", { class: "plant-card__name", text: p.name }),
                App.el("p", { class: "plant-card__place", text: `${p.place || "場所未設定"}・${p.cycleDays}日ごと・前回 ${App.fmtDate(p.wateredAt, { weekday: false })}` }),
              ]),
              badge,
              pedia
                ? App.el("button", {
                    class: "icon-btn",
                    "aria-label": `「${p.name}」を図鑑で見る`,
                    html: App.icon("note", 18),
                    onclick: () => App.openPediaFor(pedia.id),
                  })
                : null,
              App.el("button", {
                class: "icon-btn",
                "aria-label": `「${p.name}」を編集`,
                html: App.icon("edit", 18),
                onclick: () => openPlantSheet(p),
              }),
            ]),
            App.el("div", { class: "plant-meter" }, [
              App.el("div", { class: "plant-meter__bar", style: `width: ${Math.round(elapsedRatio * 100)}%;${due ? " background: var(--color-warning);" : ""}` }),
            ]),
            waterBtn,
            tipBox,
            careList,
            photoBox,
            historyBox,
          ])
        );
      });

      container.appendChild(section);
      container.appendChild(App.fab("植物を追加", () => openPlantSheet(null)));
    },
  };
})();
