// デイリービュー（編集可能・最小アウトライナー）
// 入力=その場編集 / Enter=分割 / Tab・Shift+Tab=インデント / Backspace(行頭)=結合 / ↑↓=移動 /
// Ctrl+Enter=メモ→タスク→完了→メモ の3状態サイクル / 「•」クリックでタスク化 /
// 子持ちは ▾▸ で折りたたみ(ref.collapsed) / ↑↓は日付見出しも選択対象 /
// 日付見出しで Alt+↓=その日だけにフォーカス・Alt+↑=解除（クリックでもフォーカス可）/
// 「⋯」で行メニュー（メモ⇄タスク・優先度・期限・プロジェクト割当・削除）。
// 描画方針: テキスト入力では再描画しない（caret保持）。構造変更だけ requestRender＋caret復元。

let _openMenu = null;       // 行メニューを開いている ref.id（再描画をまたいで保持）
let _menuCloser = null;     // 外側クリックで閉じる document リスナ
let _dragRef = null;        // ドラッグ中のカード ref.id
let _focusRef = null;       // ズーム中のカード ref.id（null=全日表示）
let _focusDate = null;      // 日フォーカス中の 'YYYY-MM-DD'（null=全日表示）
let _mentionJump = null;    // @チップのクリック→移動（app から設定）
let _mPanel = null, _mCloser = null;   // @メンション検索ポップアップ
// 現在表示中のページ文脈（ナビ補助 navEls/visibleFlat が参照）。
// rootRef=null は「全日表示」、ref なら「そのルート配下のページ」（デイリーのズーム／プロジェクトノート）。
let _ctx = { rootRef: null, container: null, requestRender: null };
let _imageLoader = null;    // 画像カードの表示ローダ（repoパス→objectURL。app から設定）

// 折りたたみアイコン（シェブロン）: 既定は右向き、展開時は .expanded で90°回転＝下向き
const CHEVRON_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// 複数選択（Shift+↑↓ / Shift+クリック）。選択中の ref.id 集合＋アンカー/ヘッド。
const _sel = new Set();
let _selAnchor = null, _selHead = null;

export function renderDaily(store, mount, requestRender, onMentionJump){
  if (onMentionJump) _mentionJump = onMentionJump;
  mount.innerHTML = '';
  _ctx = { rootRef: null, container: mount, requestRender, ...dailyZoomHandlers(store, requestRender) };  // 全日＝rootRef:null

  // ズーム中: フォーカスしたカードのサブツリーだけ表示
  if (_focusRef){
    const fref = store.getRef(_focusRef);
    const fbody = fref && store.getBody(fref.bodyId);
    if (fref && fbody){ renderZoomed(store, mount, requestRender, fref, fbody); manageOutsideClose(requestRender); return; }
    _focusRef = null; // 無効になっていたら解除
  }

  const days = store.queryBodies(b => b.kind === 'day')
    .sort((a, b) => (a.content < b.content ? 1 : -1)); // 新しい日付を上に
  if (!days.length){
    mount.innerHTML = '<p style="color:var(--tx3)">まだカードがありません。右上の「＋ 今日に追加」で始めてください。</p>';
    return;
  }

  // 日フォーカス中: その日だけ表示（パンくず「全体」で戻る）
  if (_focusDate){
    const day = days.find(d => d.content === _focusDate);
    if (day){
      const crumb = document.createElement('div'); crumb.className = 'zoom-crumb';
      const home = document.createElement('span'); home.className = 'crumb-item'; home.textContent = '全体';
      home.onclick = () => { _focusDate = null; requestRender(); };
      crumb.appendChild(home); crumb.appendChild(crumbSep());
      const cur = document.createElement('span'); cur.className = 'crumb-item crumb-cur'; cur.textContent = _focusDate;
      crumb.appendChild(cur);
      mount.appendChild(crumb);
      mount.appendChild(renderDaySection(store, day, requestRender, false));
      manageOutsideClose(requestRender);
      return;
    }
    _focusDate = null; // 対象日が無くなっていたら解除
  }

  for (const day of days){
    mount.appendChild(renderDaySection(store, day, requestRender, true));
  }
  manageOutsideClose(requestRender);   // メニューが開いていれば外側クリックで閉じる
}

// 1日分のセクション（日付見出し＋カード＋「＋追加」）。focusable=true で見出しクリック→その日にフォーカス
function renderDaySection(store, day, requestRender, focusable){
  const dayRef = store.refsForBody(day.id).find(r => r.parentRefId === null);
  const sec = document.createElement('div');
  sec.className = 'day-sec';
  sec.dataset.date = day.content;        // カレンダーからのスクロール用
  const head = document.createElement('div');
  head.className = 'day-head';
  head.textContent = day.content;
  head.tabIndex = -1;                 // ↑↓ でカードと同様に選択できるように
  head.dataset.date = day.content;
  head.addEventListener('keydown', (e) => onDayHeadKey(e, store, day, requestRender));
  if (focusable){
    head.classList.add('day-head-clk');
    head.title = 'クリックでこの日にフォーカス（Alt+↓でも可）';
    head.onclick = () => { _focusRef = null; _focusDate = day.content; requestRender(); focusDayHead(day.content); };
  }
  sec.appendChild(head);
  if (dayRef){
    renderChildren(store, dayRef.id, sec, 0, requestRender);
    const add = document.createElement('div');
    add.className = 'card-add'; add.textContent = '＋ 追加';
    add.onclick = () => {
      const { ref } = store.createCard({ kind:'memo', content:'', parentRefId: dayRef.id });
      requestRender();
      focusCard(ref.id, 0);
    };
    sec.appendChild(add);
  }
  return sec;
}

function renderChildren(store, parentRefId, mountEl, depth, requestRender){
  for (const ref of store.childRefs(parentRefId)){
    const body = store.getBody(ref.bodyId);
    if (!body) continue;
    const kids = store.childRefs(ref.id);

    const row = document.createElement('div');
    row.className = 'card-row';
    row.style.paddingLeft = (depth * 18) + 'px';
    if (_sel.has(ref.id)) row.classList.add('selected');
    setupRowDrop(row, ref.id, store, requestRender);

    // ドラッグハンドル
    const handle = document.createElement('span');
    handle.className = 'card-drag'; handle.textContent = '⠿'; handle.title = 'ドラッグで移動';
    handle.draggable = true;
    handle.addEventListener('dragstart', (e) => { _dragRef = ref.id; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', ref.id); } catch(_){} });
    handle.addEventListener('dragend', () => { _dragRef = null; clearDropIndicators(); });
    row.appendChild(handle);

    // 折りたたみトグル
    const tog = document.createElement('span');
    tog.className = 'card-toggle';
    if (kids.length){
      tog.innerHTML = CHEVRON_SVG;
      if (!ref.collapsed) tog.classList.add('expanded');   // 展開中は下向き
      tog.title = ref.collapsed ? '展開' : '折りたたみ';
      tog.onclick = () => { store.updateRef(ref.id, { collapsed: !ref.collapsed }); requestRender(); };
    } else { tog.classList.add('leaf'); }
    row.appendChild(tog);

    if (body.kind === 'table'){
      row.appendChild(buildTableWidget(store, ref, body, requestRender));   // 表ブロック（テキストではない葉）
    } else if (body.kind === 'image'){
      row.appendChild(buildImageWidget(store, ref, body));                  // 画像ブロック
    } else {
      // マーカー
      if (body.kind === 'task'){
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = !!body.done;
        cb.onchange = () => { store.updateBody(body.id, { done: cb.checked }); requestRender(); };
        row.appendChild(cb);
      } else {
        const dot = document.createElement('span');
        dot.className = 'card-dot'; dot.textContent = '•';
        dot.title = 'クリックでタスク化';
        dot.onclick = () => { store.updateBody(body.id, { kind:'task' }); requestRender(); focusCard(ref.id, -1); };
        row.appendChild(dot);
      }

      // テキスト
      const txt = document.createElement('span');
      txt.className = 'card-txt';
      txt.contentEditable = 'true';
      txt.spellcheck = false;
      txt.dataset.ref = ref.id;
      fillEditable(txt, body.content || '', store);   // ⟦id⟧ マーカー→@チップ
      if (body.kind === 'task' && body.done) txt.classList.add('done');
      txt.addEventListener('input', () => store.updateBody(body.id, { content: serializeEditable(txt) }));
      txt.addEventListener('keydown', (e) => onKey(e, store, ref, body, requestRender));
      txt.addEventListener('mousedown', (e) => { if (e.shiftKey){ e.preventDefault(); shiftClickSelect(store, ref.id); } else clearSelection(); });
      row.appendChild(txt);

      // 属性の小バッジ（設定済みのみ・控えめ表示）
      appendBadges(row, store, body);
    }

    // ⋯ メニュー
    const menuBtn = document.createElement('button');
    menuBtn.type = 'button'; menuBtn.className = 'card-menu-btn'; menuBtn.textContent = '⋯'; menuBtn.title = '設定';
    menuBtn.onclick = (e) => { e.stopPropagation(); _openMenu = (_openMenu === ref.id ? null : ref.id); requestRender(); };
    row.appendChild(menuBtn);

    mountEl.appendChild(row);
    if (_openMenu === ref.id){
      const m = buildCardMenu(store, ref, body, requestRender);
      m.style.marginLeft = (depth * 18 + 30) + 'px';
      mountEl.appendChild(m);
    }
    if (kids.length && !ref.collapsed) renderChildren(store, ref.id, mountEl, depth + 1, requestRender);
  }
}

const PRIO_LABEL = ['なし', '低', '中', '高'];

function appendBadges(row, store, body){
  if (body.kind !== 'task') return;
  if (body.prio){ const b = document.createElement('span'); b.className = 'cd-badge prio-' + body.prio; b.textContent = PRIO_LABEL[body.prio]; row.appendChild(b); }
  if (body.due){ const b = document.createElement('span'); b.className = 'cd-badge'; b.textContent = '📅' + body.due.slice(5); row.appendChild(b); }
  if (body.proj){ const p = store.getBody(body.proj); if (p){ const b = document.createElement('span'); b.className = 'cd-badge'; b.textContent = '#' + (p.content || 'PJ'); row.appendChild(b); } }
}

// ── 表ブロック（kind:'table'・content は {rows:[[...]]} のJSON）──
export function tableRows(body){
  let o; try { o = JSON.parse(body.content || '{}'); } catch(_){ o = {}; }
  let rows = Array.isArray(o.rows) && o.rows.length
    ? o.rows.map(r => Array.isArray(r) ? r.map(c => (c == null ? '' : String(c))) : [''])
    : [['', '']];
  const ncol = Math.max(1, ...rows.map(r => r.length));
  rows.forEach(r => { while (r.length < ncol) r.push(''); });   // 矩形に正規化
  return rows;
}
function saveTable(store, body, rows){ store.updateBody(body.id, { content: JSON.stringify({ rows }) }); }
function buildTableWidget(store, ref, body, requestRender){
  const wrap = document.createElement('div'); wrap.className = 'cardtable-wrap';
  const rows = tableRows(body);
  const tbl = document.createElement('table'); tbl.className = 'cardtable';

  // 列削除コントロール行（× を各列の上に）
  const ctr = document.createElement('tr'); ctr.className = 'ct-ctrlrow';
  ctr.appendChild(document.createElement('td'));            // 左上の角
  rows[0].forEach((_, c) => {
    const td = document.createElement('td'); td.className = 'ct-coldel';
    const b = document.createElement('button'); b.type = 'button'; b.textContent = '×'; b.title = '列を削除';
    b.onclick = () => { if (rows[0].length > 1){ rows.forEach(rw => rw.splice(c, 1)); saveTable(store, body, rows); requestRender(); } };
    td.appendChild(b); ctr.appendChild(td);
  });
  tbl.appendChild(ctr);

  // データ行（先頭に行削除×、続いてセル）
  rows.forEach((row, r) => {
    const tr = document.createElement('tr');
    const delTd = document.createElement('td'); delTd.className = 'ct-rowdel';
    const delBtn = document.createElement('button'); delBtn.type = 'button'; delBtn.textContent = '×'; delBtn.title = '行を削除';
    delBtn.onclick = () => { if (rows.length > 1){ rows.splice(r, 1); saveTable(store, body, rows); requestRender(); } };
    delTd.appendChild(delBtn); tr.appendChild(delTd);
    row.forEach((cell, c) => {
      const td = document.createElement('td'); td.className = 'ct-cell' + (r === 0 ? ' ct-head' : '');
      td.contentEditable = 'true'; td.spellcheck = false; td.textContent = cell;
      td.addEventListener('input', () => { rows[r][c] = td.textContent; saveTable(store, body, rows); });
      tr.appendChild(td);
    });
    tbl.appendChild(tr);
  });
  wrap.appendChild(tbl);

  const ctrl = document.createElement('div'); ctrl.className = 'ct-ctrl';
  const addRow = document.createElement('button'); addRow.type = 'button'; addRow.className = 'ct-btn'; addRow.textContent = '＋行';
  addRow.onclick = () => { rows.push(new Array(rows[0].length).fill('')); saveTable(store, body, rows); requestRender(); };
  const addCol = document.createElement('button'); addCol.type = 'button'; addCol.className = 'ct-btn'; addCol.textContent = '＋列';
  addCol.onclick = () => { rows.forEach(rw => rw.push('')); saveTable(store, body, rows); requestRender(); };
  ctrl.appendChild(addRow); ctrl.appendChild(addCol);
  wrap.appendChild(ctrl);
  return wrap;
}

// ── 画像ブロック（kind:'image'・content は repoパス or data/httpのURL）──
export function setImageLoader(fn){ _imageLoader = fn; }   // repoパス→objectURL（app から設定）
function loadImg(img, src){
  if (!src) return;
  if (/^(data:|https?:|blob:)/.test(src)){ img.src = src; return; }   // 直接URL（data: 等）はそのまま
  if (_imageLoader){ _imageLoader(src).then(u => { img.src = u; }).catch(() => { img.alt = '画像を読み込めません'; img.classList.add('broken'); }); }
  else { img.alt = '画像（表示には GitHub 設定が必要）'; img.classList.add('broken'); }
}
function buildImageWidget(store, ref, body){
  const wrap = document.createElement('div'); wrap.className = 'cardimg-wrap';
  const img = document.createElement('img'); img.className = 'cardimg'; img.alt = '画像';
  loadImg(img, body.content || '');
  wrap.appendChild(img);
  return wrap;
}

function buildCardMenu(store, ref, body, requestRender){
  const menu = document.createElement('div');
  menu.className = 'card-menu';
  menu.addEventListener('keydown', (e) => { if (e.key === 'Escape'){ _openMenu = null; requestRender(); } });

  if (body.kind === 'table' || body.kind === 'image'){     // 表/画像は削除のみ
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'cm-btn cm-del'; del.textContent = body.kind === 'table' ? '表を削除' : '画像を削除';
    del.onclick = () => { store.deleteRef(ref.id); _openMenu = null; requestRender(); };
    menu.appendChild(del);
    return menu;
  }

  const kindBtn = document.createElement('button');
  kindBtn.type = 'button'; kindBtn.className = 'cm-btn';
  kindBtn.textContent = body.kind === 'task' ? '• メモにする' : '☐ タスクにする';
  kindBtn.onclick = () => { store.updateBody(body.id, { kind: body.kind === 'task' ? 'memo' : 'task' }); requestRender(); };
  menu.appendChild(kindBtn);

  menu.appendChild(cmField('優先度', selectEl(PRIO_LABEL.map((l, i) => [String(i), l]), String(body.prio || 0),
    v => { store.updateBody(body.id, { prio: Number(v) }); requestRender(); })));

  const due = document.createElement('input'); due.type = 'date'; due.value = body.due || '';
  due.onchange = () => { store.updateBody(body.id, { due: due.value || '' }); requestRender(); };
  menu.appendChild(cmField('期限', due));

  const projOpts = [['', '—'], ...store.listProjects().map(p => [p.id, p.content || '(無題)'])];
  menu.appendChild(cmField('PJ', selectEl(projOpts, body.proj || '',
    v => { store.updateBody(body.id, { proj: v || undefined }); requestRender(); })));

  const del = document.createElement('button');
  del.type = 'button'; del.className = 'cm-btn cm-del'; del.textContent = '削除';
  del.onclick = () => {
    const kids = store.childRefs(ref.id).length;
    if (kids && !confirm(`このカードには子が ${kids} 件あります。まとめて削除しますか？`)) return;
    store.deleteRef(ref.id); _openMenu = null; requestRender();
  };
  menu.appendChild(del);
  return menu;
}
function cmField(label, control){
  const f = document.createElement('label'); f.className = 'cm-field';
  f.appendChild(document.createTextNode(label)); f.appendChild(control);
  return f;
}

function setupRowDrop(row, refId, store, requestRender){
  row.addEventListener('dragover', (e) => {
    if (!_dragRef || _dragRef === refId) return;
    e.preventDefault();
    const rect = row.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    clearDropIndicators();
    row.classList.add(after ? 'drop-after' : 'drop-before');
    row._dropAfter = after;
  });
  row.addEventListener('dragleave', () => { row.classList.remove('drop-before', 'drop-after'); });
  row.addEventListener('drop', (e) => {
    if (!_dragRef) return;
    e.preventDefault();
    doDrop(store, _dragRef, refId, !!row._dropAfter, requestRender);
  });
}
function doDrop(store, dragId, targetId, after, requestRender){
  clearDropIndicators();
  _dragRef = null;
  if (dragId === targetId) return;
  // 循環防止: target が drag の子孫なら不可（drag が target の祖先チェーンに居たら中止）
  let p = store.getRef(targetId);
  while (p){ if (p.id === dragId) return; p = p.parentRefId ? store.getRef(p.parentRefId) : null; }
  const target = store.getRef(targetId);
  if (!target) return;
  store.updateRef(dragId, { parentRefId: target.parentRefId, order: after ? store.orderAfter(targetId) : store.orderBefore(targetId) });
  requestRender();
}
function clearDropIndicators(){
  document.querySelectorAll('.card-row.drop-before, .card-row.drop-after')
    .forEach(r => r.classList.remove('drop-before', 'drop-after'));
}

// ── ズーム（フォーカス）──
function zoomIn(store, refId, requestRender){
  _focusRef = refId;
  requestRender();
  const fc = store.childRefs(refId)[0];
  focusCard(fc ? fc.id : refId, 0);
}
function zoomOut(store){
  if (!_focusRef) return;
  const fref = store.getRef(_focusRef);
  if (!fref){ _focusRef = null; return; }
  const parent = fref.parentRefId ? store.getRef(fref.parentRefId) : null;
  _focusRef = (parent && store.getBody(parent.bodyId)?.kind !== 'day') ? parent.id : null;
}
function crumbSep(){ const s = document.createElement('span'); s.className = 'crumb-sep'; s.textContent = '›'; return s; }
// デイリーのズーム操作（Alt+↓/↑）。_ctx 経由で onKey から呼ばれる。
function dailyZoomHandlers(store, requestRender){
  return {
    onZoomIn: (refId) => zoomIn(store, refId, requestRender),
    onZoomOut: (refId, pos) => { zoomOut(store); requestRender(); focusCard(refId, pos); },
  };
}
function renderZoomed(store, mount, requestRender, fref, fbody){
  const crumb = [{ label: '全体', onClick: () => { _focusRef = null; requestRender(); } }];
  const path = [];
  let p = fref.parentRefId ? store.getRef(fref.parentRefId) : null;
  while (p){ path.push(p); p = p.parentRefId ? store.getRef(p.parentRefId) : null; }
  path.reverse();
  for (const aref of path){
    const ab = store.getBody(aref.bodyId); if (!ab) continue;
    crumb.push({ label: ab.kind === 'day' ? ab.content : (ab.content || '(空)'),
                 onClick: () => { _focusRef = ab.kind === 'day' ? null : aref.id; requestRender(); } });
  }
  renderOutlinePage(store, mount, requestRender, fref, fbody, { crumb, ...dailyZoomHandlers(store, requestRender) });
}
// 1つのルート参照を「ページ」として描画（デイリーのズーム／プロジェクトノートで共用）。
// opts: { crumb:[{label,onClick}], inheritProj, onZoomIn(refId), onZoomOut(refId,pos) }
export function renderOutlinePage(store, mount, requestRender, fref, fbody, opts){
  opts = opts || {};
  _ctx = { rootRef: fref.id, container: mount, requestRender, onZoomIn: opts.onZoomIn, onZoomOut: opts.onZoomOut };

  const crumbEl = document.createElement('div'); crumbEl.className = 'zoom-crumb';
  (opts.crumb || []).forEach((c, i) => {
    if (i) crumbEl.appendChild(crumbSep());
    const it = document.createElement('span'); it.className = 'crumb-item'; it.textContent = c.label;
    it.onclick = c.onClick;
    crumbEl.appendChild(it);
  });
  mount.appendChild(crumbEl);

  const title = document.createElement('div'); title.className = 'zoom-title';
  const tt = document.createElement('span');
  tt.className = 'card-txt zoom-title-txt'; tt.contentEditable = 'true'; tt.spellcheck = false;
  tt.dataset.ref = fref.id; tt.textContent = fbody.content || '';
  tt.addEventListener('input', () => store.updateBody(fbody.id, { content: tt.textContent }));
  tt.addEventListener('keydown', (e) => onKey(e, store, fref, fbody, requestRender));   // タイトルからも Alt+↑ で出る等
  title.appendChild(tt);
  mount.appendChild(title);

  const wrap = document.createElement('div'); wrap.className = 'zoom-children';
  renderChildren(store, fref.id, wrap, 0, requestRender);
  const add = document.createElement('div'); add.className = 'card-add'; add.textContent = '＋ 追加';
  add.onclick = () => {
    const attrs = { kind:'memo', content:'', parentRefId: fref.id };
    if (opts.inheritProj) attrs.proj = opts.inheritProj;   // プロジェクトページで作るカードは所属PJを継承
    const { ref } = store.createCard(attrs); requestRender(); focusCard(ref.id, 0);
  };
  wrap.appendChild(add);
  mount.appendChild(wrap);

  // バックリンク（このカード/PJを ⟦id⟧ で参照しているカード）
  const backs = store.queryBodies(b => b.id !== fbody.id && (b.content || '').includes('⟦' + fbody.id + '⟧'));
  if (backs.length){
    const bl = document.createElement('div'); bl.className = 'backlinks';
    const h = document.createElement('div'); h.className = 'backlinks-head'; h.textContent = '🔗 バックリンク (' + backs.length + ')';
    bl.appendChild(h);
    for (const b of backs){
      const item = document.createElement('div'); item.className = 'backlink-item';
      item.textContent = ((b.content || '').replace(MENTION_RE, '@…').slice(0, 80)) || '(空)';
      item.onclick = () => { if (_mentionJump) _mentionJump(b.id); };
      bl.appendChild(item);
    }
    mount.appendChild(bl);
  }
}

function manageOutsideClose(requestRender){
  if (_menuCloser){ document.removeEventListener('mousedown', _menuCloser); _menuCloser = null; }
  if (!_openMenu) return;
  _menuCloser = (e) => {
    if (!e.target.closest('.card-menu') && !e.target.closest('.card-menu-btn')){
      _openMenu = null;
      document.removeEventListener('mousedown', _menuCloser); _menuCloser = null;
      requestRender();
    }
  };
  setTimeout(() => { if (_menuCloser) document.addEventListener('mousedown', _menuCloser); }, 0);
}

function onKey(e, store, ref, body, requestRender){
  if (e.isComposing || e.keyCode === 229) return; // IME変換中は素通り

  const el = e.target;
  const text = serializeEditable(el);
  const pos = caretOffset(el);

  // 複数選択: Shift+↑↓ で拡張 / それ以外のキーで解除（Ctrl系・修飾単独は維持）
  const _isShiftArrow = e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown');
  if (!_isShiftArrow && !e.ctrlKey && !e.metaKey && !['Shift','Control','Alt','Meta'].includes(e.key)) clearSelection();
  if (_isShiftArrow){ e.preventDefault(); extendSelection(store, ref.id, e.key === 'ArrowDown' ? 'down' : 'up'); return; }

  // @ でメンション検索（カード/日付）。挿入位置を覚えてチップ化。Esc は @ を文字として挿入
  if (e.key === '@' && !e.ctrlKey && !e.metaKey){
    e.preventDefault();
    const at = pos;
    openMentionSearch(store, el, (targetId) => {
      const cur = store.getBody(body.id).content || '';
      const ins = targetId ? '⟦' + targetId + '⟧' : '@';
      store.updateBody(body.id, { content: cur.slice(0, at) + ins + cur.slice(at) });
      requestRender();
      focusCard(ref.id, at + ins.length);
    });
    return;
  }

  // ズーム: Alt+↓ で潜る / Alt+↑ で出る（出たあとも同じカードにフォーカスを残す）
  if (e.altKey && !e.shiftKey && e.key === 'ArrowDown'){ e.preventDefault(); if (_ctx.onZoomIn) _ctx.onZoomIn(ref.id); return; }
  if (e.altKey && !e.shiftKey && e.key === 'ArrowUp'){ e.preventDefault(); if (_ctx.onZoomOut) _ctx.onZoomOut(ref.id, pos); return; }
  // Workflowy: 折りたたみ(Ctrl+↑) / 展開(Ctrl+↓)
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')){
    if (!store.childRefs(ref.id).length) return;
    e.preventDefault();
    store.updateRef(ref.id, { collapsed: e.key === 'ArrowUp' });   // ↑=折りたたみ / ↓=展開
    requestRender(); focusCard(ref.id, pos);
    return;
  }

  // Ctrl/⌘+Enter: メモ → タスク(未完) → 完了 → メモ の3状態サイクル
  // （完了の単純トグルはチェックボックスのクリックで可能）
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)){
    e.preventDefault();
    if (body.kind !== 'task')   store.updateBody(body.id, { kind: 'task', done: false });
    else if (!body.done)        store.updateBody(body.id, { done: true });
    else                        store.updateBody(body.id, { kind: 'memo', done: false });
    requestRender();
    focusCard(ref.id, pos);
    return;
  }
  if (e.key === 'Enter'){
    e.preventDefault();
    store.updateBody(body.id, { content: text.slice(0, pos) });
    const created = store.createCard({
      kind: body.kind, content: text.slice(pos), proj: body.proj,
      parentRefId: ref.parentRefId, order: store.orderAfter(ref.id),
    });
    requestRender();
    focusCard(created.ref.id, 0);
    return;
  }
  if (e.key === 'Tab'){
    e.preventDefault();
    if (e.shiftKey){
      const parentRef = store.getRef(ref.parentRefId);
      if (!parentRef) return;
      if (store.getBody(parentRef.bodyId)?.kind === 'day') return;
      store.updateRef(ref.id, { parentRefId: parentRef.parentRefId, order: store.orderAfter(parentRef.id) });
    } else {
      const prev = store.prevSiblingRef(ref.id);
      if (!prev) return;
      store.updateRef(ref.id, { parentRefId: prev.id, order: store.endOrder(prev.id) });
    }
    requestRender();
    focusCard(ref.id, pos);
    return;
  }
  // Workflowy: 削除（Ctrl/⌘+Shift+Backspace）
  if (e.key === 'Backspace' && e.shiftKey && (e.ctrlKey || e.metaKey)){
    e.preventDefault();
    const flat = visibleFlat(store);
    const idx = flat.indexOf(ref.id);
    if (store.childRefs(ref.id).length && !confirm('子を含めて削除しますか？')) return;
    store.deleteRef(ref.id);
    requestRender();
    const target = flat[idx - 1] || flat[idx + 1];
    if (target) focusCard(target, -1);
    return;
  }
  if (e.key === 'Backspace' && pos === 0 && window.getSelection().isCollapsed){
    const flat = visibleFlat(store);
    const idx = flat.indexOf(ref.id);
    if (idx <= 0) return;
    const prevRefId = flat[idx - 1];
    const prevBody = store.getBody(store.getRef(prevRefId).bodyId);
    if (prevBody.kind === 'table' || prevBody.kind === 'image') return;   // 表/画像へは結合しない
    e.preventDefault();
    const mergePos = (prevBody.content || '').length;
    store.updateBody(prevBody.id, { content: (prevBody.content || '') + text });
    for (const child of store.childRefs(ref.id)){
      store.updateRef(child.id, { parentRefId: prevRefId, order: store.endOrder(prevRefId) });
    }
    store.deleteRef(ref.id);
    requestRender();
    focusCard(prevRefId, mergePos);
    return;
  }
  if (e.altKey && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')){
    e.preventDefault();                              // 兄弟内で上下に並べ替え
    const sibs = store.siblings(ref.id);
    const i = sibs.findIndex(x => x.id === ref.id);
    const j = e.key === 'ArrowUp' ? i - 1 : i + 1;
    if (j < 0 || j >= sibs.length) return;
    const oi = sibs[i].order, oj = sibs[j].order;   // 入れ替え前に値を退避（更新で参照が変わるため）
    store.updateRef(sibs[i].id, { order: oj });
    store.updateRef(sibs[j].id, { order: oi });
    requestRender();
    focusCard(ref.id, pos);
    return;
  }
  if (e.key === 'ArrowLeft' && pos === 0 && window.getSelection().isCollapsed){
    const flat = visibleFlat(store);
    const idx = flat.indexOf(ref.id);
    if (idx > 0){ e.preventDefault(); focusCard(flat[idx - 1], -1); return; }   // 行頭← → 前カードの文末へ
  }
  if (e.key === 'ArrowRight' && pos === text.length && window.getSelection().isCollapsed){
    const flat = visibleFlat(store);
    const idx = flat.indexOf(ref.id);
    if (idx < flat.length - 1){ e.preventDefault(); focusCard(flat[idx + 1], 0); return; }   // 行末→ → 次カードの先頭へ
  }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown'){
    const els = navEls();
    const idx = els.indexOf(el);
    const target = els[idx + (e.key === 'ArrowUp' ? -1 : 1)];
    if (!target) return;
    e.preventDefault();
    if (target.classList.contains('day-head')) target.focus();   // 日付見出しも選択対象に含める
    else setCaret(target, pos);                                   // カードは桁位置を維持
    return;
  }
}

// ── caret / 走査 / 小物 ──
// ── メンション: 本文文字列は ⟦bodyId⟧ マーカーでリンクを表す。描画時にチップ化／編集時に文字列へ戻す ──
const MENTION_RE = /⟦([^⟧]+)⟧/g;
const mlen = (n) => n.nodeType === 3 ? n.textContent.length
  : (n.classList && n.classList.contains('mention')) ? ('⟦' + n.dataset.ref + '⟧').length
  : n.textContent.length;

function makeChip(targetId, store){
  const sp = document.createElement('span');
  sp.className = 'mention'; sp.contentEditable = 'false'; sp.dataset.ref = targetId;
  const b = store.getBody(targetId);
  sp.textContent = '@' + (b ? (b.kind === 'day' ? b.content : (b.content || '無題').slice(0, 24)) : '?');
  if (!b) sp.classList.add('broken');
  sp.addEventListener('mousedown', (e) => { e.preventDefault(); if (_mentionJump) _mentionJump(targetId); });
  return sp;
}
function fillEditable(el, content, store){
  el.textContent = '';
  let last = 0, m; MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(content))){
    if (m.index > last) el.appendChild(document.createTextNode(content.slice(last, m.index)));
    el.appendChild(makeChip(m[1], store));
    last = m.index + m[0].length;
  }
  if (last < content.length) el.appendChild(document.createTextNode(content.slice(last)));
}
function serializeEditable(el){
  let out = '';
  el.childNodes.forEach(n => {
    if (n.nodeType === 3) out += n.textContent;
    else if (n.nodeType === 1 && n.classList && n.classList.contains('mention')) out += '⟦' + n.dataset.ref + '⟧';
    else if (n.nodeType === 1) out += n.textContent;
  });
  return out;
}
function caretOffset(el){              // 直列化文字列における caret 位置
  const sel = window.getSelection();
  if (!sel.rangeCount) return 0;
  const r = sel.getRangeAt(0);
  if (!el.contains(r.startContainer)) return 0;
  let idx = 0;
  const nodes = el.childNodes;
  for (let i = 0; i < nodes.length; i++){
    if (r.startContainer === el && r.startOffset === i) return idx;
    if (nodes[i] === r.startContainer) return idx + r.startOffset;
    idx += mlen(nodes[i]);
  }
  return idx;
}
function setCaret(el, pos){            // pos: 直列化インデックス（<0 で末尾）
  el.focus();
  const content = serializeEditable(el);
  const target = pos < 0 ? content.length : Math.min(pos, content.length);
  const sel = window.getSelection();
  const r = document.createRange();
  const nodes = [...el.childNodes];
  let idx = 0;
  for (let i = 0; i < nodes.length; i++){
    const n = nodes[i], len = mlen(n);
    if (target <= idx + len){
      if (n.nodeType === 3){ r.setStart(n, Math.max(0, target - idx)); }
      else { r.setStart(el, i + (target <= idx ? 0 : 1)); }   // チップ前後の境界へ
      r.collapse(true); sel.removeAllRanges(); sel.addRange(r); return;
    }
    idx += len;
  }
  if (!nodes.length) r.setStart(el, 0); else r.setStartAfter(nodes[nodes.length - 1]);
  r.collapse(true); sel.removeAllRanges(); sel.addRange(r);
}
export function focusCard(refId, pos = 0){
  const root = _ctx.container || document;
  const el = root.querySelector(`.card-txt[data-ref="${refId}"]`) || document.querySelector(`.card-txt[data-ref="${refId}"]`);
  if (el) setCaret(el, pos);
}
// ↑↓ ナビ対象（描画順）= 日付見出し＋カード。折りたたみ/ズーム/日フォーカスは DOM が反映済み
function navEls(){ return [...(_ctx.container || document).querySelectorAll('.day-head, .card-txt')]; }
function focusDayHead(date){ const el = document.querySelector(`#view-daily .day-head[data-date="${date}"]`); if (el) el.focus(); }
// 日付見出し上のキー操作: Alt+↓=この日にフォーカス / Alt+↑=解除 / ↑↓=隣のカード・見出しへ
function onDayHeadKey(e, store, day, requestRender){
  if (e.isComposing) return;
  if (e.altKey && !e.shiftKey && e.key === 'ArrowDown'){
    e.preventDefault();
    _focusRef = null; _focusDate = day.content;
    requestRender(); focusDayHead(day.content);
    return;
  }
  if (e.altKey && !e.shiftKey && e.key === 'ArrowUp'){
    e.preventDefault();
    if (_focusDate){ _focusDate = null; requestRender(); focusDayHead(day.content); }
    return;
  }
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey){
    e.preventDefault();
    const els = navEls();
    const idx = els.indexOf(e.currentTarget);
    const target = els[idx + (e.key === 'ArrowUp' ? -1 : 1)];
    if (!target) return;
    if (target.classList.contains('day-head')) target.focus();
    else setCaret(target, e.key === 'ArrowDown' ? 0 : -1);
    return;
  }
}
export function resetZoom(){ _focusRef = null; }       // カードズーム解除（パレットからのジャンプ用）
export function clearDayFocus(){ _focusDate = null; }  // 日フォーカス解除（ジャンプ/カレンダー用）
export function setZoom(refId){ _focusRef = refId; _focusDate = null; }   // 指定ノードにズーム（リスト↗用）
export function setMentionJump(fn){ _mentionJump = fn; }   // @チップ/バックリンクのクリック先（app から設定）

// ── @メンション検索ポップアップ ──
function closeMention(){
  if (_mCloser){ document.removeEventListener('mousedown', _mCloser); _mCloser = null; }
  if (_mPanel){ _mPanel.remove(); _mPanel = null; }
}
function parseDateQuery(q){
  q = q.trim(); const p = (n) => String(n).padStart(2, '0');
  const fmt = (d) => d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(q)){ const [y, mo, d] = q.split('-').map(Number); return y + '-' + p(mo) + '-' + p(d); }
  if (/^\d{1,2}\/\d{1,2}$/.test(q)){ const [mo, d] = q.split('/').map(Number); return new Date().getFullYear() + '-' + p(mo) + '-' + p(d); }
  if (q === '今日') return fmt(new Date());
  if (q === '明日'){ const d = new Date(); d.setDate(d.getDate() + 1); return fmt(d); }
  return null;
}
function openMentionSearch(store, anchorEl, onPick){
  closeMention();
  const panel = document.createElement('div'); panel.className = 'mention-pop';
  const input = document.createElement('input'); input.className = 'mention-input'; input.type = 'text'; input.placeholder = '@ カード名 / 2026-06-25 / 6/25 / 今日'; input.spellcheck = false;
  const list = document.createElement('div'); list.className = 'mention-list';
  panel.appendChild(input); panel.appendChild(list); document.body.appendChild(panel); _mPanel = panel;
  const sel = window.getSelection();
  let rect = sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
  if (!rect || (!rect.top && !rect.left)) rect = anchorEl.getBoundingClientRect();
  panel.style.left = Math.round(rect.left) + 'px'; panel.style.top = Math.round(rect.bottom + 4) + 'px';

  let items = [], si = 0;
  const compute = (q) => {
    const ql = q.trim().toLowerCase(); const out = [];
    const ds = parseDateQuery(q);
    if (ds) out.push({ label: '📅 ' + ds, hint: '日付', run: () => onPick(store.ensureDayCard(ds).body.id) });
    if (ql) store.queryBodies(b => (b.kind === 'task' || b.kind === 'memo' || b.kind === 'day' || b.kind === 'project') && (b.content || '').toLowerCase().includes(ql))
      .slice(0, 12)
      .forEach(b => out.push({
        label: (b.kind === 'day' ? '📅 ' : b.kind === 'project' ? '📁 ' : '') + (b.content || '(空)').slice(0, 30),
        hint: b.kind === 'task' ? 'タスク' : b.kind === 'day' ? '日付' : b.kind === 'project' ? 'PJ' : 'メモ',
        run: () => onPick(b.id),
      }));
    return out;
  };
  const exec = (it) => { closeMention(); it.run(); };
  const render = () => {
    list.innerHTML = '';
    if (!items.length){ const e = document.createElement('div'); e.className = 'mention-empty'; e.textContent = 'カード名 / 2026-06-25 / 6/25 / 今日'; list.appendChild(e); return; }
    items.forEach((it, i) => {
      const el = document.createElement('div'); el.className = 'mention-item' + (i === si ? ' sel' : '');
      const lab = document.createElement('span'); lab.textContent = it.label; el.appendChild(lab);
      if (it.hint){ const h = document.createElement('span'); h.className = 'mention-hint'; h.textContent = it.hint; el.appendChild(h); }
      el.onmousedown = (ev) => { ev.preventDefault(); exec(it); };
      list.appendChild(el);
    });
    const s = list.querySelector('.mention-item.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
  };
  const update = () => { items = compute(input.value); si = 0; render(); };
  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown'){ e.preventDefault(); si = Math.min(si + 1, items.length - 1); render(); }
    else if (e.key === 'ArrowUp'){ e.preventDefault(); si = Math.max(si - 1, 0); render(); }
    else if (e.key === 'Enter'){ e.preventDefault(); if (items[si]) exec(items[si]); }
    else if (e.key === 'Escape'){ e.preventDefault(); closeMention(); onPick(null); }
  });
  update(); input.focus();
  _mCloser = (e) => { if (!e.target.closest('.mention-pop')) closeMention(); };
  setTimeout(() => { if (_mCloser) document.addEventListener('mousedown', _mCloser); }, 0);
}

// ── 複数選択 ──
function applySelStyles(root){
  (root || document).querySelectorAll('.card-row').forEach(rw => {
    const t = rw.querySelector('.card-txt');
    rw.classList.toggle('selected', !!(t && _sel.has(t.dataset.ref)));
  });
}
export function clearSelection(){
  if (!_sel.size && !_selAnchor) return;
  _sel.clear(); _selAnchor = null; _selHead = null;
  document.querySelectorAll('.card-row.selected').forEach(rw => rw.classList.remove('selected'));
}
function rebuildSelRange(store){       // _sel = visible順で anchor..head を内包
  const flat = visibleFlat(store);
  const ai = flat.indexOf(_selAnchor), hi = flat.indexOf(_selHead);
  _sel.clear();
  if (ai < 0 || hi < 0) return;
  const lo = Math.min(ai, hi), up = Math.max(ai, hi);
  for (let i = lo; i <= up; i++) _sel.add(flat[i]);
}
function extendSelection(store, currentRefId, dir){
  if (!_selAnchor){ _selAnchor = currentRefId; _selHead = currentRefId; }
  const flat = visibleFlat(store);
  const next = flat[flat.indexOf(_selHead) + (dir === 'down' ? 1 : -1)];
  if (next) _selHead = next;
  rebuildSelRange(store);
  applySelStyles();
  if (next) focusCard(next, -1);       // caret は選択ヘッドへ
}
function shiftClickSelect(store, refId){
  const focused = document.activeElement;
  const focusedRef = (focused && focused.classList && focused.classList.contains('card-txt')) ? focused.dataset.ref : null;
  if (!_selAnchor) _selAnchor = focusedRef || refId;
  _selHead = refId;
  rebuildSelRange(store);
  applySelStyles();
}
function visibleFlat(store){
  const out = [];
  const walk = (refId) => { for (const r of store.childRefs(refId)){ out.push(r.id); if (!r.collapsed) walk(r.id); } };
  if (_ctx.rootRef && store.getRef(_ctx.rootRef)){ out.push(_ctx.rootRef); walk(_ctx.rootRef); return out; }   // ページ（ズーム/PJ）はルート＋サブツリー
  let days = store.queryBodies(b => b.kind === 'day').sort((a, b) => (a.content < b.content ? 1 : -1));
  if (_focusDate) days = days.filter(d => d.content === _focusDate);   // 日フォーカス中はその日だけ
  for (const day of days){
    const dayRef = store.refsForBody(day.id).find(r => r.parentRefId === null);
    if (dayRef) walk(dayRef.id);
  }
  return out;
}
function selectEl(options, value, onChange){
  const sel = document.createElement('select');
  for (const [v, label] of options){
    const o = document.createElement('option');
    o.value = v; o.textContent = label;
    if (v === value) o.selected = true;
    sel.appendChild(o);
  }
  sel.onchange = () => onChange(sel.value);
  return sel;
}
