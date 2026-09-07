// 無タグの塊の棚卸し。到達手段の無いカードを「塊」単位で数え、頭1枚にPJ/タグを付けて拾えるようにする。
//
// なぜ塊単位か: project.js の collectMirrorRoots は「祖先にタグがあれば子孫は拾わない＝親だけ出す」
// 設計なので、塊の頭1枚にPJかタグを付ければ配下ごと到達可能になる。全カードに付ける必要はない。
// 実データ（2026-07-31・本体1286件）では 357件が到達不能で 91塊。既定表示（2件以上）の
// 40塊で306件（86%）を占め、残り51塊は1件だけの単発。
//
// 到達不能の定義: 自分にも祖先にも「拾う手がかり」が無く、祖先に project カードも無い。
// 手がかり = proj（PJビュー・PJ条件で拾える）または #タグ（検索のタグ条件で拾える）。
// タグを第2の軸に選んだので、タグも到達手段として数える。ここを proj だけにすると
// 棚卸しでタグを付けても塊が消えず、進捗が見えない。

const _q = new URL(import.meta.url).search;
const { pathLabel } = await import('./daily.js' + _q);   // 塊の頭の見せ方は検索のパンくずと揃える
const { cardTags } = await import('./props.js' + _q);    // #タグの抽出（検索と同じ規則）

// 拾う手がかりを持っているか（PJの割当 or 本文の #タグ）
const hasHandle = (b) => !!(b && (b.proj || cardTags(b.content).size));

// ── 純ロジック（テスト対象）─────────────────────────────────────
// 到達不能な塊を件数の降順で返す。
//   [{ headRefId, headBodyId, label, count, day, kinds, hasMedia, triaged }]
// kinds は種類ごとの件数（{memo:3, image:2} 等）。
// hasMedia = 画像/表を含む＝文字が無く検索でも辿れないので優先度が高い。
// triaged = 頭カードに「タグ不要」の印が付いている（呼び出し側で出す/出さないを決める）。
export function untaggedIslands(store){
  const groups = new Map();
  for (const b of store.queryBodies(x => x.kind !== 'day' && x.kind !== 'project')){
    if (hasHandle(b)) continue;                            // 自分に手がかりがあれば拾える
    const ref = store.refsForBody(b.id)[0];
    if (!ref) continue;
    // 祖先を1回たどって「拾えるか」と「day 直下の祖先（＝塊の頭）」を同時に求める
    let head = ref, reachable = false, day = null;
    for (let r = ref; ;){
      if (!r.parentRefId) break;
      const pr = store.getRef(r.parentRefId); if (!pr) break;
      const pb = store.getBody(pr.bodyId); if (!pb) break;
      if (pb.kind === 'day'){ day = pb.content; break; }
      if (hasHandle(pb) || pb.kind === 'project'){ reachable = true; break; }
      head = pr; r = pr;
    }
    if (reachable || !day) continue;                       // 拾える／日の下にない（孤児）は対象外
    let g = groups.get(head.id);
    if (!g){
      const hb = store.getBody(head.bodyId);
      g = { headRefId: head.id, headBodyId: head.bodyId, label: pathLabel(hb),
            headKind: hb ? hb.kind : '', count: 0, day, kinds: {},
            hasMedia: false, triaged: !!(hb && hb.triaged) };
      groups.set(head.id, g);
    }
    g.count++;
    g.kinds[b.kind] = (g.kinds[b.kind] || 0) + 1;
    if (b.kind === 'image' || b.kind === 'table') g.hasMedia = true;   // 文字を持たない＝検索でも辿れない
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || (a.day < b.day ? 1 : -1));
}

// 既存の #タグを使用回数の多い順に返す（棚卸しの選択肢用）。
export function allTags(store){
  const n = new Map();
  for (const b of store.queryBodies(() => true)){
    for (const t of cardTags(b.content)) n.set(t, (n.get(t) || 0) + 1);
  }
  return [...n.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([tag, count]) => ({ tag, count }));
}

// 種類の内訳を「メモ3 / 画像2」の形にする。多い順。
const KIND_JA = { memo:'メモ', task:'タスク', image:'画像', table:'表' };
export function kindsSummary(kinds){
  return Object.entries(kinds || {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => (KIND_JA[k] || k) + n)
    .join(' / ');
}

// 本文の末尾にタグを足す（既存のタグは重ねない）。タグ機構はインラインの #タグ なので本文に書く。
export function withTags(content, tags){
  const cur = String(content || '');
  const has = new Set((cur.match(/#\S+/g) || []).map(s => s.slice(1)));
  const add = (tags || []).map(s => String(s).replace(/^#/, '').trim())
    .filter(t => t && !has.has(t));
  if (!add.length) return cur;
  const sep = cur && !/\s$/.test(cur) ? ' ' : '';
  return cur + sep + add.map(t => '#' + t).join(' ');
}

// 入力欄の文字列をタグ配列にする（空白/カンマ区切り・# は付けても良い）。
export function parseTagInput(text){
  return String(text || '').split(/[\s,]+/).map(s => s.replace(/^#/, '')).filter(Boolean);
}

// ── 描画 ───────────────────────────────────────────────────────
// 編集はいったん state.pending に溜め、OK を押したときだけ本体へ書く。
// 選んだ瞬間に反映すると「油断すると消える」ので、確定は明示的にする。
let _jump = null;
export function setTriageJump(fn){ _jump = fn; }   // 塊の頭をクリックしたときの移動（app から設定）

const pendingOf = (state, id) => (state.pending || (state.pending = {}))[id] || { proj:'', tags:'' };
function setPending(state, id, patch){
  state.pending[id] = { ...pendingOf(state, id), ...patch };
}

export function renderTriageView(store, mount, requestRender, state){
  mount.innerHTML = '';
  const all = untaggedIslands(store);
  const open = all.filter(g => !g.triaged);
  const doneCount = all.length - open.length;
  const showTriaged = !!state.showTriaged;
  const showSolo = !!state.showSolo;

  let rows = showTriaged ? all.filter(g => g.triaged) : open;
  if (!showTriaged && !showSolo) rows = rows.filter(g => g.count >= 2);

  const title = document.createElement('div'); title.className = 'tri-title';
  title.textContent = '🧹 無タグの塊の棚卸し';
  mount.appendChild(title);

  const note = document.createElement('p'); note.className = 'tri-note';
  const total = open.reduce((a, g) => a + g.count, 0);
  const media = open.filter(g => g.hasMedia).length;
  note.textContent = '検索やプロジェクトから辿れないカードを塊ごとにまとめています。'
    + '頭の1枚にプロジェクトかタグを指定して OK を押すと、配下ごと拾えるようになります。'
    + '　残り ' + open.length + ' 塊 / ' + total + ' 件'
    + (media ? '　うち ' + media + ' 塊は画像・表を含みます（文字が無いので検索でも辿れません。ここが最優先）' : '');
  mount.appendChild(note);

  const bar = document.createElement('div'); bar.className = 'tri-bar';
  const check = (label, key, on) => {
    const l = document.createElement('label'); l.className = 'tri-check';
    const c = document.createElement('input'); c.type = 'checkbox'; c.checked = on;
    c.onchange = () => { state[key] = c.checked; requestRender(); };
    l.appendChild(c); l.appendChild(document.createTextNode(label));
    return l;
  };
  bar.appendChild(check('1件だけの塊も表示（' + open.filter(g => g.count === 1).length + '塊）', 'showSolo', showSolo));
  bar.appendChild(check('棚卸し済みを表示（' + doneCount + '塊）', 'showTriaged', showTriaged));
  mount.appendChild(bar);

  if (!rows.length){
    const e = document.createElement('p'); e.className = 'tri-empty';
    e.textContent = showTriaged ? '棚卸し済みの塊はありません。'
      : open.length ? '2件以上の塊は片付きました。上のチェックで単発も表示できます。'
      : '辿れないカードはありません。';
    mount.appendChild(e);
    return;
  }

  const projects = store.listProjects();
  const tags = allTags(store);
  const table = document.createElement('table'); table.className = 'tri-table';
  const thead = document.createElement('thead'); const htr = document.createElement('tr');
  const cols = showTriaged
    ? [['件数','c-n'], ['塊の頭','c-head'], ['元の場所','c-where'], ['内訳','c-kinds'], ['','c-ok']]
    : [['件数','c-n'], ['塊の頭','c-head'], ['元の場所','c-where'], ['内訳','c-kinds'],
       ['プロジェクト','c-proj'], ['タグ','c-tags'], ['','c-ok']];
  for (const [t, cls] of cols){
    const th = document.createElement('th'); th.textContent = t; th.className = cls; htr.appendChild(th);
  }
  thead.appendChild(htr); table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const g of rows) tbody.appendChild(buildRow(store, requestRender, state, g, projects, tags, showTriaged));
  table.appendChild(tbody);
  mount.appendChild(table);
}

function buildRow(store, requestRender, state, g, projects, tags, showTriaged){
  const tr = document.createElement('tr');
  if (g.hasMedia) tr.classList.add('tri-media');   // 画像/表を含む＝検索でも辿れない

  const n = document.createElement('td'); n.className = 'c-n'; n.textContent = g.count; tr.appendChild(n);

  const h = document.createElement('td'); h.className = 'c-head';
  const link = document.createElement('span'); link.className = 'tri-head-link';
  link.textContent = g.label; link.title = '元の場所へ移動';
  link.onclick = () => { if (_jump) _jump(g.headBodyId); };
  h.appendChild(link);
  tr.appendChild(h);

  const w = document.createElement('td'); w.className = 'c-where'; w.textContent = g.day || '—'; tr.appendChild(w);

  const k = document.createElement('td'); k.className = 'c-kinds';
  k.textContent = kindsSummary(g.kinds);
  if (g.hasMedia) k.title = '画像・表は文字を持たないので検索にかかりません';
  tr.appendChild(k);

  if (showTriaged){                                 // 棚卸し済みの一覧＝戻すだけ
    const back = document.createElement('td'); back.className = 'c-ok';
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tri-btn'; b.textContent = '↩ 戻す';
    b.onclick = () => { store.updateBody(g.headBodyId, { triaged: false }); requestRender(); };
    back.appendChild(b); tr.appendChild(back);
    return tr;
  }

  const pend = pendingOf(state, g.headBodyId);

  // プロジェクト（選んでも即書きしない）
  const p = document.createElement('td'); p.className = 'c-proj';
  const sel = document.createElement('select'); sel.className = 'tri-sel';
  for (const [v, label] of [['', '（未割当）'], ...projects.map(x => [x.id, x.content || '(名前なし)'])]){
    const o = document.createElement('option'); o.value = v; o.textContent = label; sel.appendChild(o);
  }
  sel.value = pend.proj || '';
  sel.onchange = () => { setPending(state, g.headBodyId, { proj: sel.value }); requestRender(); };
  p.appendChild(sel); tr.appendChild(p);

  // タグ（既存から選ぶ＋自由入力。どちらも即書きしない）
  const t = document.createElement('td'); t.className = 'c-tags';
  const pick = document.createElement('select'); pick.className = 'tri-sel tri-pick';
  const opt0 = document.createElement('option');
  opt0.value = ''; opt0.textContent = tags.length ? '既存から選ぶ…' : '既存タグなし';
  pick.appendChild(opt0);
  for (const { tag, count } of tags){
    const o = document.createElement('option');
    o.value = tag; o.textContent = '#' + tag + '（' + count + '）';
    pick.appendChild(o);
  }
  pick.disabled = !tags.length;
  const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'tri-tags';
  inp.placeholder = '空白区切り（#不要）'; inp.value = pend.tags || '';
  pick.onchange = () => {
    if (!pick.value) return;
    const cur = parseTagInput(inp.value);
    if (!cur.includes(pick.value)) cur.push(pick.value);
    setPending(state, g.headBodyId, { tags: cur.join(' ') });
    requestRender();
  };
  inp.oninput = () => setPending(state, g.headBodyId, { tags: inp.value });   // 再描画しない（caret を保つ）
  t.appendChild(pick); t.appendChild(inp); tr.appendChild(t);

  // OK（明示的に確定）と 済（タグ不要と判断）
  const ok = document.createElement('td'); ok.className = 'c-ok';
  const tagList = parseTagInput(pend.tags);
  const btn = document.createElement('button'); btn.type = 'button';
  btn.className = 'tri-btn tri-ok'; btn.textContent = 'OK';
  btn.disabled = !pend.proj && !tagList.length;
  btn.title = btn.disabled ? 'プロジェクトかタグを指定してください' : 'この塊に反映する';
  btn.onclick = () => {
    const b = store.getBody(g.headBodyId); if (!b) return;
    const patch = {};
    if (pend.proj) patch.proj = pend.proj;
    if (tagList.length){
      const next = withTags(b.content, tagList);
      if (next !== b.content) patch.content = next;
    }
    if (Object.keys(patch).length) store.updateBody(g.headBodyId, patch);
    delete state.pending[g.headBodyId];
    requestRender();
  };
  const skip = document.createElement('button'); skip.type = 'button';
  skip.className = 'tri-btn tri-skip'; skip.textContent = '済';
  skip.title = 'タグは不要と判断した（「棚卸し済みを表示」で戻せます）';
  skip.onclick = () => {
    store.updateBody(g.headBodyId, { triaged: true });
    delete state.pending[g.headBodyId];
    requestRender();
  };
  ok.appendChild(btn); ok.appendChild(skip); tr.appendChild(ok);

  return tr;
}
