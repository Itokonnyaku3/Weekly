// ビューア。フレームワークは使わず、素の DOM で組む。
// 数千枚を扱うので、サムネは loading="lazy" にし、内容が変わったときだけ描き直す。

const $ = (id) => document.getElementById(id);
const el = {
  date: $("date"), count: $("count"), refresh: $("refresh"),
  list: $("list"), empty: $("empty"), toast: $("toast"), menu: $("menu"),
  overlay: $("overlay"), ovImg: $("ovImg"), ovSel: $("ovSel"),
  ovStage: $("ovStage"), ovTitle: $("ovTitle"), ovHint: $("ovHint"),
};

const state = {
  date: null,
  shots: [],
  selected: -1,   // 一覧で選択中のインデックス
  signature: "",  // 描画済みの内容。変化がなければ作り直さない。
  rev: {},        // ファイル名 -> 編集回数。画像の再取得に使う。
  menuFor: -1,    // 右クリックメニューの対象
  open: -1,       // 拡大表示中のインデックス。-1 なら閉じている。
  crop: null,     // 選択中の範囲（表示座標）
};

// --- 通信 ---------------------------------------------------------------

async function api(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

const post = (path, body) =>
  api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// --- 表示 ---------------------------------------------------------------

function toast(message, isError = false) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  el.toast.classList.add("show");
  el.toast.style.background = isError ? "#b91c1c" : "";
  el.toast.style.color = isError ? "#fff" : "";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.toast.classList.remove("show"), 1600);
}

const rev = (name) => state.rev[name] || 0;
const thumbUrl = (name) => `/thumb/${state.date}/${name}?r=${rev(name)}`;
const imgUrl = (name) => `/img/${state.date}/${name}?r=${rev(name)}`;

function autoGrow(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function card(shot, index) {
  const article = document.createElement("article");
  article.className = "card";
  article.dataset.index = index;

  const head = document.createElement("div");
  head.className = "head";
  head.innerHTML =
    `<span class="no">${String(shot.no).padStart(3, "0")}</span>` +
    `<time>${shot.time}</time>` +
    `<span class="size">${shot.w}×${shot.h}</span>`;

  const img = document.createElement("img");
  img.loading = "lazy";
  img.decoding = "async";
  img.alt = `${shot.time} のスクリーンショット`;
  img.src = thumbUrl(shot.name);
  // 読み込み前から高さを確保しておき、スクロール位置が飛ばないようにする
  if (shot.w && shot.h) img.style.aspectRatio = `${shot.w} / ${shot.h}`;

  const box = document.createElement("div");
  box.className = "shot";
  box.append(img);

  const note = document.createElement("textarea");
  note.className = "note";
  note.rows = 1;
  note.placeholder = "メモ…";
  note.value = shot.note || "";
  note.dataset.index = index;

  article.append(head, box, note);
  decorateAuto(article, shot);
  return article;
}

// 自動トリミングの候補を、サムネの上に破線の枠とバッジで重ねる。
function decorateAuto(article, shot) {
  article.querySelector(".auto-frame")?.remove();
  article.querySelector(".auto-badge")?.remove();

  const auto = shot.auto;
  if (!auto || !shot.w || !shot.h) return;

  const [x, y, w, h] = auto.rect;
  const frame = document.createElement("div");
  frame.className = "auto-frame";
  Object.assign(frame.style, {
    left: `${(x / shot.w) * 100}%`,
    top: `${(y / shot.h) * 100}%`,
    width: `${(w / shot.w) * 100}%`,
    height: `${(h / shot.h) * 100}%`,
  });

  const badge = document.createElement("button");
  badge.className = "auto-badge";
  badge.type = "button";
  badge.textContent = `⌗ ${auto.kind}`;
  badge.title = "この枠で切り抜く（右クリックのメニューから微調整もできます）";

  article.querySelector(".shot").append(frame, badge);
}

// 一覧の中身を表す文字列。これが同じなら DOM を作り直す必要はない。
const signature = () =>
  state.date + "|" +
  state.shots.map((s) => `${s.name}:${s.w}x${s.h}:${rev(s.name)}`).join(",");

let pendingRender = false;

function render() {
  const next = signature();
  if (next === state.signature) return;  // 定期更新で毎回作り直さない

  // メモを書いている最中に作り直すと、書きかけの文字ごと消えてしまう。
  // 入力が終わってから改めて描く。
  if (isTyping(document.activeElement)) {
    pendingRender = true;
    return;
  }
  pendingRender = false;
  state.signature = next;

  // 作り直すとスクロールが先頭へ戻ってしまうので、位置を持ち越す
  const scroll = el.list.scrollTop;

  const frag = document.createDocumentFragment();
  state.shots.forEach((shot, i) => {
    if (shot.gap && i > 0) {
      const sep = document.createElement("div");
      sep.className = "gap";
      sep.textContent = shot.time.slice(0, 5);
      frag.append(sep);
    }
    frag.append(card(shot, i));
  });

  el.list.replaceChildren(frag);
  el.list.scrollTop = scroll;
  el.list.querySelectorAll(".note").forEach(autoGrow);
  el.empty.hidden = state.shots.length > 0;
  el.count.textContent = state.shots.length ? `${state.shots.length} 枚` : "";
  select(state.shots.length ? Math.min(state.selected, state.shots.length - 1) : -1, false);
}

function select(index, scroll = true) {
  el.list.querySelector(".card.selected")?.classList.remove("selected");
  state.selected = index;
  if (index < 0) return;
  const node = el.list.querySelector(`.card[data-index="${index}"]`);
  if (!node) return;
  node.classList.add("selected");
  if (scroll) node.scrollIntoView({ block: "nearest" });
}

// --- 読み込み -----------------------------------------------------------

let dateSignature = "";

async function loadDates() {
  const { dates } = await api("/api/dates");
  // 中身が変わっていないのに作り直すと、開いているドロップダウンが閉じてしまう
  const sig = dates.map((d) => `${d.date}:${d.count}`).join(",");
  if (sig !== dateSignature) {
    dateSignature = sig;
    el.date.replaceChildren(
      ...dates.map(({ date, count }) => new Option(`${date}　(${count})`, date))
    );
  }
  if (!dates.length) {
    state.date = null;
    state.shots = [];
    render();
    return;
  }
  state.date = dates.some((d) => d.date === state.date) ? state.date : dates[0].date;
  el.date.value = state.date;
  await loadShots();
}

async function loadShots() {
  if (!state.date) return;
  const { shots } = await api(`/api/shots?date=${state.date}`);
  state.shots = shots;
  render();
  fillAuto();
}

// 自動トリミングの候補を裏で1枚ずつ求めていく。1枚あたり数十msかかるので
// まとめて走らせず、結果が出たカードから順に枠を足す（一覧は作り直さない）。
let autoRunning = false;

async function fillAuto() {
  if (autoRunning) return;
  autoRunning = true;
  const forDate = state.date;
  try {
    for (let i = 0; i < state.shots.length; i++) {
      if (state.date !== forDate) return;  // 日付が切り替わったらやめる
      const shot = state.shots[i];
      if ("auto" in shot) continue;
      try {
        const { auto } = await api(
          `/api/autocrop?date=${forDate}&name=${encodeURIComponent(shot.name)}`
        );
        shot.auto = auto;
      } catch {
        shot.auto = null;  // 失敗しても次へ。提案が出ないだけで害はない。
      }
      const node = el.list.querySelector(`.card[data-index="${i}"]`);
      if (node) decorateAuto(node, shot);
    }
  } finally {
    autoRunning = false;
  }
}

async function refresh() {
  try {
    await loadDates();
  } catch (e) {
    toast(e.message, true);
  }
}

// --- 操作 ---------------------------------------------------------------

const shotAt = (index) => state.shots[index];

// イベントの発生元は Element とは限らない（document に届くこともある）。
// closest / matches は Element にしかないので、ここで吸収しておく。
const closestOf = (target, selector) =>
  target instanceof Element ? target.closest(selector) : null;
const isTyping = (target) =>
  target instanceof Element && target.matches("textarea, input");

async function copy(index) {
  const shot = shotAt(index);
  if (!shot) return;
  try {
    await post("/api/copy", { date: state.date, name: shot.name });
    const node = el.list.querySelector(`.card[data-index="${index}"]`);
    node?.classList.remove("flash");
    void node?.offsetWidth;  // アニメーションを再スタートさせる
    node?.classList.add("flash");
    toast("コピーしました");
  } catch (e) {
    toast(e.message, true);
  }
}

// メモは入力が止まったところで自動保存する。フォーカスが外れるのを待つと、
// 書きかけのまま別アプリへ移ったときに消えてしまう。
let noteTimer = null;

function scheduleNoteSave(index, text) {
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => saveNote(index, text), 600);
}

async function saveNote(index, text, quiet = false) {
  clearTimeout(noteTimer);
  const shot = shotAt(index);
  if (!shot || shot.note === text) return;
  try {
    await post("/api/note", { date: state.date, name: shot.name, note: text });
    shot.note = text;  // 手元も合わせておき、次の更新で作り直さない
    if (!quiet) toast("メモを保存しました");
  } catch (e) {
    toast(e.message, true);
  }
}

async function edit(index, op, params) {
  const shot = shotAt(index);
  if (!shot) return;
  try {
    const size = await post("/api/edit", { date: state.date, name: shot.name, op, ...params });
    shot.w = size.w;
    shot.h = size.h;
    delete shot.auto;  // 画像が変わったので候補は求め直す
    state.rev[shot.name] = rev(shot.name) + 1;
    render();
    fillAuto();
    if (state.open === index) showOverlay(index);
    toast(op === "crop" ? "切り抜きました（Ctrl+Z で戻せます）" : "回転しました");
  } catch (e) {
    toast(e.message, true);
  }
}

async function undo() {
  try {
    const r = await post("/api/undo", {});
    state.rev[r.name] = rev(r.name) + 1;
    const i = state.shots.findIndex((s) => s.name === r.name);
    if (i >= 0) {
      state.shots[i].w = r.w;
      state.shots[i].h = r.h;
      delete state.shots[i].auto;
    }
    render();
    fillAuto();
    if (state.open >= 0) showOverlay(state.open);
    toast(`${r.name.slice(0, 3)} を元に戻しました`);
  } catch (e) {
    toast(e.message, true);
  }
}

async function remove(index) {
  const shot = shotAt(index);
  if (!shot) return;
  if (!confirm(`${shot.no} (${shot.time}) を削除します。\n保存先の _trash フォルダへ移動します。`)) return;
  try {
    await post("/api/delete", { date: state.date, name: shot.name });
    closeOverlay();
    await refresh();
    toast("削除しました");
  } catch (e) {
    toast(e.message, true);
  }
}

async function reveal(index) {
  const shot = shotAt(index);
  if (!shot) return;
  try {
    await post("/api/reveal", { date: state.date, name: shot.name });
  } catch (e) {
    toast(e.message, true);
  }
}

// --- 右クリックメニュー -------------------------------------------------

function openMenu(index, x, y) {
  state.menuFor = index;
  // 候補が見つかったものにだけ「自動トリミング」を出す
  el.menu.querySelector('[data-act="auto"]').hidden = !shotAt(index)?.auto;
  el.menu.hidden = false;
  // 画面からはみ出さない位置に置く
  const box = el.menu.getBoundingClientRect();
  el.menu.style.left = `${Math.min(x, innerWidth - box.width - 6)}px`;
  el.menu.style.top = `${Math.min(y, innerHeight - box.height - 6)}px`;
}

function closeMenu() {
  el.menu.hidden = true;
  state.menuFor = -1;
}

el.menu.addEventListener("click", (ev) => {
  const act = ev.target.closest("button")?.dataset.act;
  const index = state.menuFor;
  closeMenu();
  if (!act || index < 0) return;
  runAction(act, index);
});

function runAction(act, index) {
  switch (act) {
    case "crop": showOverlay(index); break;
    case "auto": showOverlay(index, shotAt(index)?.auto?.rect); break;
    case "rotR": edit(index, "rotate", { degrees: 90 }); break;
    case "rotL": edit(index, "rotate", { degrees: 270 }); break;
    case "copy": copy(index); break;
    case "note": el.list.querySelector(`.note[data-index="${index}"]`)?.focus(); break;
    case "reveal": reveal(index); break;
    case "delete": remove(index); break;
  }
}

// --- 拡大表示とトリミング -----------------------------------------------

function showOverlay(index, preset = null) {
  const shot = shotAt(index);
  if (!shot) return;
  state.open = index;
  state.crop = null;
  el.ovSel.hidden = true;
  el.ovHint.textContent = "ドラッグで範囲を選び Enter で切り抜き";
  // 画像の寸法が確定してからでないと、候補の枠を置く位置を計算できない
  el.ovImg.onload = preset ? () => selectRect(preset) : null;
  el.ovImg.src = imgUrl(shot.name);
  el.ovTitle.textContent = `${String(shot.no).padStart(3, "0")}  ${shot.time}  ${shot.w}×${shot.h}`;
  el.overlay.hidden = false;
}

/** 原寸座標の矩形を、いま表示している倍率に合わせて選択範囲として置く。 */
function selectRect([x, y, w, h]) {
  const img = el.ovImg.getBoundingClientRect();
  if (!el.ovImg.naturalWidth || !img.width) return;
  const scale = img.width / el.ovImg.naturalWidth;
  drawSelection({
    left: img.left + x * scale,
    top: img.top + y * scale,
    width: w * scale,
    height: h * scale,
  });
  el.ovHint.textContent = "Enter で切り抜き ・ ドラッグで選び直し ・ Esc で閉じる";
}

function drawSelection(box) {
  const stage = el.ovStage.getBoundingClientRect();
  Object.assign(el.ovSel.style, {
    left: `${box.left - stage.left}px`,
    top: `${box.top - stage.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  });
  el.ovSel.hidden = false;
  state.crop = box;
}

function closeOverlay() {
  el.overlay.hidden = true;
  state.open = -1;
  state.crop = null;
  el.ovSel.hidden = true;
}

el.overlay.addEventListener("click", (ev) => {
  const act = ev.target.closest("button")?.dataset.act;
  if (!act) return;
  if (act === "close") return closeOverlay();
  runAction(act, state.open);
});

// ドラッグで範囲を選ぶ。画像の外へはみ出しても画像内に丸める。
let dragFrom = null;

el.ovImg.addEventListener("pointerdown", (ev) => {
  ev.preventDefault();
  // 画像の外へドラッグしても追い続けたいだけなので、捕捉できなくても続行する
  try { el.ovImg.setPointerCapture(ev.pointerId); } catch { /* 無視 */ }
  dragFrom = { x: ev.clientX, y: ev.clientY };
  state.crop = null;
  el.ovSel.hidden = true;
});

el.ovImg.addEventListener("pointermove", (ev) => {
  if (!dragFrom) return;
  const img = el.ovImg.getBoundingClientRect();
  const clampX = (v) => Math.min(Math.max(v, img.left), img.right);
  const clampY = (v) => Math.min(Math.max(v, img.top), img.bottom);

  const x1 = clampX(dragFrom.x), y1 = clampY(dragFrom.y);
  const x2 = clampX(ev.clientX), y2 = clampY(ev.clientY);
  drawSelection({
    left: Math.min(x1, x2), top: Math.min(y1, y2),
    width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
  });
});

el.ovImg.addEventListener("pointerup", () => {
  dragFrom = null;
  // 誤クリック程度の大きさなら選択とみなさない
  if (state.crop && (state.crop.width < 8 || state.crop.height < 8)) {
    state.crop = null;
    el.ovSel.hidden = true;
  }
  el.ovHint.textContent = state.crop
    ? "Enter で切り抜き ・ もう一度ドラッグで選び直し ・ Esc で閉じる"
    : "ドラッグで範囲を選び Enter で切り抜き";
});

function applyCrop() {
  if (state.crop === null || state.open < 0) return;
  const img = el.ovImg.getBoundingClientRect();
  // 表示倍率から原寸の座標へ戻す。切り抜きはサーバ側が原寸に対して行う。
  const scale = el.ovImg.naturalWidth / img.width;
  const rect = [
    (state.crop.left - img.left) * scale,
    (state.crop.top - img.top) * scale,
    state.crop.width * scale,
    state.crop.height * scale,
  ].map(Math.round);
  state.crop = null;
  el.ovSel.hidden = true;
  edit(state.open, "crop", { rect });
}

// --- イベント -----------------------------------------------------------

el.list.addEventListener("click", (ev) => {
  if (ev.target.closest(".note")) return;  // メモ欄のクリックでコピーしない
  const node = ev.target.closest(".card");
  if (!node) return;
  const index = Number(node.dataset.index);

  // バッジは「この枠で切り抜く」。カードのコピーとは別扱いにする。
  if (ev.target.closest(".auto-badge")) {
    ev.stopPropagation();
    const auto = shotAt(index)?.auto;
    if (auto) edit(index, "crop", { rect: auto.rect });
    return;
  }

  select(index, false);
  copy(index);
});

el.list.addEventListener("dblclick", (ev) => {
  if (ev.target.closest(".note")) return;
  const node = ev.target.closest(".card");
  if (node) showOverlay(Number(node.dataset.index));
});

el.list.addEventListener("contextmenu", (ev) => {
  const node = ev.target.closest(".card");
  if (!node) return;
  ev.preventDefault();
  const index = Number(node.dataset.index);
  select(index, false);
  openMenu(index, ev.clientX, ev.clientY);
});

el.list.addEventListener("input", (ev) => {
  if (!ev.target.classList.contains("note")) return;
  autoGrow(ev.target);
  scheduleNoteSave(Number(ev.target.dataset.index), ev.target.value);
});

el.list.addEventListener("blur", async (ev) => {
  if (!ev.target.classList?.contains("note")) return;
  await saveNote(Number(ev.target.dataset.index), ev.target.value, true);
  if (pendingRender) render();  // 入力中に見送った更新をここで反映する
}, true);

// 別アプリへ移るときも、書きかけを取りこぼさないよう先に保存する
window.addEventListener("blur", () => {
  const note = document.activeElement;
  if (isTyping(note) && note.classList.contains("note")) {
    saveNote(Number(note.dataset.index), note.value, true);
  }
});

document.addEventListener("pointerdown", (ev) => {
  if (!el.menu.hidden && !closestOf(ev.target, ".menu")) closeMenu();
});

el.date.addEventListener("change", () => {
  state.date = el.date.value;
  state.selected = -1;
  loadShots().catch((e) => toast(e.message, true));
});

el.refresh.addEventListener("click", refresh);

document.addEventListener("keydown", (ev) => {
  const typing = isTyping(ev.target);

  if (ev.key === "Escape") {
    if (!el.menu.hidden) return closeMenu();
    if (typing) return ev.target.blur();
    if (state.open >= 0) return closeOverlay();
    return;
  }
  if (ev.key === "z" && ev.ctrlKey && !typing) { ev.preventDefault(); return undo(); }
  if (typing) return;

  if (state.open >= 0) {
    if (ev.key === "Enter") { ev.preventDefault(); applyCrop(); }
    else if (ev.key === "r" || ev.key === "R") edit(state.open, "rotate", { degrees: ev.shiftKey ? 270 : 90 });
    else if (ev.key === "c" && ev.ctrlKey) { ev.preventDefault(); copy(state.open); }
    else if (ev.key === "Delete") remove(state.open);
    return;
  }

  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    if (!state.shots.length) return;
    ev.preventDefault();
    const step = ev.key === "ArrowDown" ? 1 : -1;
    const next = state.selected < 0
      ? 0
      : Math.min(state.shots.length - 1, Math.max(0, state.selected + step));
    select(next);
  } else if (ev.key === "Enter" && state.selected >= 0) {
    ev.preventDefault();
    showOverlay(state.selected);
  } else if (ev.key === "c" && ev.ctrlKey && state.selected >= 0) {
    ev.preventDefault();
    copy(state.selected);
  } else if (ev.key === "Delete" && state.selected >= 0) {
    remove(state.selected);
  } else if (ev.key === "F5") {
    ev.preventDefault();
    refresh();
  }
});

// ドックに戻ってきたときに、その間に撮った分を取り込む
window.addEventListener("focus", refresh);

refresh();
