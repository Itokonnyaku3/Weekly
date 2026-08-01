// ビューア。フレームワークは使わず、素の DOM で組む。
// 数千枚を扱うので、サムネは loading="lazy" にして描画も一括で流し込む。

const $ = (id) => document.getElementById(id);
const el = { date: $("date"), count: $("count"), refresh: $("refresh"),
             list: $("list"), empty: $("empty"), toast: $("toast") };

const state = {
  date: null,
  shots: [],
  selected: -1,   // 選択中のインデックス
  signature: "",  // 描画済みの内容。変化がなければ作り直さない。
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
  toast.timer = setTimeout(() => el.toast.classList.remove("show"), 1400);
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
  img.src = `/thumb/${state.date}/${shot.name}`;
  // 読み込み前から高さを確保しておき、スクロール位置が飛ばないようにする
  if (shot.w && shot.h) img.style.aspectRatio = `${shot.w} / ${shot.h}`;

  article.append(head, img);

  if (shot.note) {
    const note = document.createElement("div");
    note.className = "note";
    note.textContent = shot.note;
    article.append(note);
  }
  return article;
}

// 一覧の中身を表す文字列。これが同じなら DOM を作り直す必要はない。
const signature = () =>
  state.date + "|" + state.shots.map((s) => `${s.name}:${s.w}x${s.h}:${s.note}`).join(",");

function render() {
  const next = signature();
  if (next === state.signature) return;  // 定期更新で毎回作り直さない
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
}

async function refresh() {
  try {
    await loadDates();
  } catch (e) {
    toast(e.message, true);
  }
}

// --- 操作 ---------------------------------------------------------------

async function copy(index) {
  const shot = state.shots[index];
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

el.list.addEventListener("click", (ev) => {
  const node = ev.target.closest(".card");
  if (!node) return;
  const index = Number(node.dataset.index);
  select(index, false);
  copy(index);
});

el.date.addEventListener("change", () => {
  state.date = el.date.value;
  state.selected = -1;
  loadShots().catch((e) => toast(e.message, true));
});

el.refresh.addEventListener("click", refresh);

document.addEventListener("keydown", (ev) => {
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    if (!state.shots.length) return;
    ev.preventDefault();
    const next = state.selected < 0
      ? 0
      : Math.min(state.shots.length - 1, Math.max(0, state.selected + (ev.key === "ArrowDown" ? 1 : -1)));
    select(next);
  } else if (ev.key === "c" && ev.ctrlKey) {
    if (state.selected >= 0) { ev.preventDefault(); copy(state.selected); }
  } else if (ev.key === "F5") {
    ev.preventDefault();
    refresh();
  }
});

// ドックに戻ってきたときに、その間に撮った分を取り込む
window.addEventListener("focus", refresh);

refresh();
