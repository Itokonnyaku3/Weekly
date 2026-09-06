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
//   [{ headRefId, headBodyId, label, count, day, kinds }]
// kinds は種類ごとの件数（{memo:3, image:2} 等）。
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
            headKind: hb ? hb.kind : '', count: 0, day, kinds: {} };
      groups.set(head.id, g);
    }
    g.count++;
    g.kinds[b.kind] = (g.kinds[b.kind] || 0) + 1;
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || (a.day < b.day ? 1 : -1));
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

// ── 描画 ───────────────────────────────────────────────────────
let _jump = null;
export function setTriageJump(fn){ _jump = fn; }   // 塊の頭をクリックしたときの移動（app から設定）

export function renderTriageView(store, mount, requestRender, state){
  mount.innerHTML = '';
  const all = untaggedIslands(store);
  const showSolo = !!state.showSolo;
  const rows = showSolo ? all : all.filter(g => g.count >= 2);

  const head = document.createElement('div'); head.className = 'tri-title';
  head.textContent = '🧹 無タグの塊の棚卸し';
  mount.appendChild(head);

  const note = document.createElement('p'); note.className = 'tri-note';
  const total = all.reduce((a, g) => a + g.count, 0);
  note.textContent = '検索やプロジェクトから辿れないカードを、塊ごとにまとめています。'
    + '頭の1枚にプロジェクトかタグを付ければ、配下ごと拾えるようになります。'
    + `　残り ${all.length} 塊 / ${total} 件`;
  mount.appendChild(note);

  const bar = document.createElement('div'); bar.className = 'tri-bar';
  const lab = document.createElement('label'); lab.className = 'tri-check';
  const cbx = document.createElement('input'); cbx.type = 'checkbox'; cbx.checked = showSolo;
  cbx.onchange = () => { state.showSolo = cbx.checked; requestRender(); };
  lab.appendChild(cbx);
  lab.appendChild(document.createTextNode(`1件だけの塊も表示（${all.filter(g => g.count === 1).length}件）`));
  bar.appendChild(lab);
  mount.appendChild(bar);

  if (!rows.length){
    const e = document.createElement('p'); e.className = 'tri-empty';
    e.textContent = all.length ? '2件以上の塊は片付きました。上のチェックで単発も表示できます。'
                               : '到達できないカードはありません。';
    mount.appendChild(e);
    return;
  }

  const projects = store.listProjects();
  const table = document.createElement('table'); table.className = 'tri-table';
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  for (const [t, cls] of [['件数','c-n'], ['塊の頭','c-head'], ['元の場所','c-where'],
                          ['内訳','c-kinds'], ['プロジェクト','c-proj'], ['タグ','c-tags']]){
    const th = document.createElement('th'); th.textContent = t; th.className = cls; htr.appendChild(th);
  }
  thead.appendChild(htr); table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const g of rows) tbody.appendChild(buildRow(store, requestRender, g, projects));
  table.appendChild(tbody);
  mount.appendChild(table);
}

function buildRow(store, requestRender, g, projects){
  const tr = document.createElement('tr');

  const n = document.createElement('td'); n.className = 'c-n'; n.textContent = g.count; tr.appendChild(n);

  const h = document.createElement('td'); h.className = 'c-head';
  const link = document.createElement('span'); link.className = 'tri-head-link';
  link.textContent = g.label; link.title = '元の場所へ移動';
  link.onclick = () => { if (_jump) _jump(g.headBodyId); };
  h.appendChild(link);
  tr.appendChild(h);

  const w = document.createElement('td'); w.className = 'c-where'; w.textContent = g.day || '—'; tr.appendChild(w);

  const k = document.createElement('td'); k.className = 'c-kinds'; k.textContent = kindsSummary(g.kinds); tr.appendChild(k);

  // プロジェクト: 選んだ瞬間に頭カードへ付ける＝その塊は一覧から消える
  const p = document.createElement('td'); p.className = 'c-proj';
  const sel = document.createElement('select'); sel.className = 'tri-sel';
  for (const [v, label] of [['', '（未割当）'], ...projects.map(x => [x.id, x.content || '(名前なし)'])]){
    const o = document.createElement('option'); o.value = v; o.textContent = label; sel.appendChild(o);
  }
  sel.value = '';
  sel.onchange = () => {
    if (!sel.value) return;
    store.updateBody(g.headBodyId, { proj: sel.value });
    requestRender();
  };
  p.appendChild(sel); tr.appendChild(p);

  // タグ: Enter か離れたときに本文末尾へ追記
  const t = document.createElement('td'); t.className = 'c-tags';
  const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'tri-tags';
  inp.placeholder = '空白区切り（#不要）';
  const apply = () => {
    const tags = inp.value.split(/[\s,]+/).filter(Boolean);
    if (!tags.length) return;
    const b = store.getBody(g.headBodyId); if (!b) return;
    const next = withTags(b.content, tags);
    if (next === b.content){ inp.value = ''; return; }
    store.updateBody(g.headBodyId, { content: next });
    requestRender();
  };
  inp.onkeydown = (e) => { if (e.key === 'Enter'){ e.preventDefault(); apply(); } };
  inp.onblur = apply;
  t.appendChild(inp); tr.appendChild(t);

  return tr;
}
