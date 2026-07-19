// プロジェクトビュー: ランディング（PJ一覧）＋ 選択PJのノートページ。
// ノートページは daily の renderOutlinePage を共用（編集・ナビ・@メンション・バックリンクをそのまま再利用）。
const _q = new URL(import.meta.url).search;
const { renderOutlinePage, renderChildren, focusCard, isDoneHidden } = await import('./daily.js' + _q);

// 割当カード（📌）の簡易フィルタ状態（セッション内・#6）
let _mirrorFilter = { kw: '', hideDone: false, due: 'all' };
let _restoreKw = false;   // キーワード入力の再フォーカス（1入力ごと）

// 割当カードのルート群をフィルタ（キーワード=content部分一致 / 完了を隠す / 期限）。純ロジック（テスト対象）。
export function filterMirrorRoots(roots, f, today){
  const kw = (f && f.kw || '').trim().toLowerCase();
  const due = (f && f.due) || 'all';
  const hideDone = !!(f && f.hideDone);
  return roots.filter(({ body }) => {
    if (kw && !(body.content || '').toLowerCase().includes(kw)) return false;
    if (hideDone && body.done) return false;
    if (due !== 'all'){
      const d = body.due || '';
      if (due === 'has') return !!d;
      if (!d) return false;
      const diff = Math.round((Date.parse(d + 'T00:00:00') - Date.parse(today + 'T00:00:00')) / 86400000);
      if (due === 'overdue' && diff >= 0) return false;
      if (due === 'soon' && !(diff >= 0 && diff <= 7)) return false;
    }
    return true;
  });
}

// このPJのタグが付いた「最上位」カードを出所の日付ごとに集める（ノートページ内・別対象の子孫は除外）
export function collectMirrorRoots(store, projId, pageRootId){
  const inPage = (refId) => { let p = refId; while (p){ if (p === pageRootId) return true; const r = store.getRef(p); p = r ? r.parentRefId : null; } return false; };
  const hasProjAncestor = (ref) => { let p = ref.parentRefId; while (p){ const pr = store.getRef(p); if (!pr) break; const pb = store.getBody(pr.bodyId); if (pb && pb.proj === projId) return true; p = pr.parentRefId; } return false; };
  const dayOf = (ref) => { let p = ref.id; while (p){ const r = store.getRef(p); if (!r) break; const b = store.getBody(r.bodyId); if (b && b.kind === 'day') return b.content; p = r.parentRefId; } return null; };
  const roots = [];
  for (const b of store.queryBodies(x => x.proj === projId && x.kind !== 'project')){
    const ref = store.refsForBody(b.id)[0];
    if (!ref || inPage(ref.id) || hasProjAncestor(ref)) continue;
    roots.push({ ref, body: b, day: dayOf(ref) });
  }
  return roots;
}
// 出所の日付でグループ化（新しい日が上・出所不明は「その他」を末尾）
function groupByDay(roots){
  const groups = {};
  for (const r of roots){ const k = r.day || 'その他'; (groups[k] = groups[k] || []).push(r); }
  const keys = Object.keys(groups).sort((a, b) => {
    if (a === 'その他') return 1; if (b === 'その他') return -1;
    return a < b ? 1 : a > b ? -1 : 0;
  });
  return keys.map(k => ({ day: k, roots: groups[k] }));
}

function countDescendants(store, refId){
  let n = 0;
  for (const r of store.childRefs(refId)){ n++; n += countDescendants(store, r.id); }
  return n;
}

export function renderProjectView(store, mount, requestRender, projState, onJump){
  mount.innerHTML = '';
  const body = projState.projId ? store.getBody(projState.projId) : null;
  if (!projState.projId || !body || body.kind !== 'project'){   // 一覧（未選択／消えたPJ）
    projState.projId = null; projState.rootRef = null;
    renderLanding(store, mount, requestRender, projState);
    return;
  }
  renderPage(store, mount, requestRender, projState, onJump);
}

function renderLanding(store, mount, requestRender, projState){
  const wrap = document.createElement('div'); wrap.className = 'proj-landing';
  const head = document.createElement('div'); head.className = 'proj-landing-head'; head.textContent = 'プロジェクト一覧';
  wrap.appendChild(head);
  const projs = store.listProjects();
  if (!projs.length){
    const e = document.createElement('p'); e.className = 'proj-landing-empty';
    e.textContent = 'プロジェクトがありません。下の「＋ プロジェクト」で作成してください。';
    wrap.appendChild(e);
  }
  // PJを開く（＝そのPJにズームイン）。ページの先頭カード（無ければタイトル）へフォーカス。
  const openProj = (pid) => {
    projState.projId = pid; projState.rootRef = null;
    requestRender();
    const fc = mount.querySelector('.card-row .card-txt, .card-row .card-block');
    if (fc && fc.dataset.ref) focusCard(fc.dataset.ref, 0);
    else { const t = mount.querySelector('.zoom-title-txt'); if (t) t.focus(); }
  };
  // 一覧の行キー操作（デイリーの日付見出しと同様）: Alt+↓/Enter=ズームイン / ↑↓=行移動
  const onRowKey = (e, pid) => {
    if (e.isComposing) return;
    if (e.key === 'Enter' || (e.altKey && !e.shiftKey && e.key === 'ArrowDown')){ e.preventDefault(); openProj(pid); return; }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey){
      e.preventDefault();
      const all = [...mount.querySelectorAll('.proj-land-row')];
      const i = all.indexOf(e.currentTarget);
      const t = all[i + (e.key === 'ArrowUp' ? -1 : 1)];
      if (t) t.focus();
    }
  };
  for (const p of projs){
    const row = document.createElement('div'); row.className = 'proj-land-row';
    row.tabIndex = -1; row.dataset.proj = p.id;                 // ↑↓選択・Alt+↓ズームインのためフォーカス可能に
    const root = store.refsForBody(p.id).find(r => r.parentRefId === null);
    const count = root ? countDescendants(store, root.id) : 0;
    const name = document.createElement('span'); name.className = 'proj-land-name'; name.textContent = p.content || '(無題)';
    const cnt = document.createElement('span'); cnt.className = 'proj-land-count'; cnt.textContent = count ? (count + ' 件') : '空';
    row.appendChild(name); row.appendChild(cnt);
    row.onclick = () => openProj(p.id);
    row.addEventListener('keydown', (e) => onRowKey(e, p.id));
    wrap.appendChild(row);
  }
  const add = document.createElement('button'); add.className = 'btn proj-land-add'; add.textContent = '＋ プロジェクト';
  add.onclick = () => {
    const p = store.createProject('新規プロジェクト');
    projState.projId = p.id; projState.rootRef = null; requestRender();
    setTimeout(() => {                                       // タイトルを全選択して即リネーム
      const t = mount.querySelector('.zoom-title-txt');
      if (t){ t.focus(); const r = document.createRange(); r.selectNodeContents(t); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    }, 0);
  };
  wrap.appendChild(add);
  mount.appendChild(wrap);
}

// PJページ内のズーム操作（Alt+↓/↑）。PJルートで Alt+↑ は一覧へ戻り、そのPJ行へフォーカス。
function projZoomHandlers(store, requestRender, projState, pageRootId, mount){
  return {
    onZoomIn: (refId) => { projState.rootRef = refId; requestRender(); const fc = store.childRefs(refId)[0]; focusCard(fc ? fc.id : refId, 0); },
    onZoomOut: (refId, pos) => {
      const curRoot = projState.rootRef || pageRootId;
      if (curRoot === pageRootId){                            // PJルート → 一覧へ戻り、出てきたPJ行へフォーカス
        const pid = projState.projId;
        projState.projId = null; projState.rootRef = null;
        requestRender();
        const row = mount.querySelector(`.proj-land-row[data-proj="${pid}"]`);
        if (row) row.focus();
        return;
      }
      const cur = store.getRef(curRoot);
      const parent = cur && cur.parentRefId ? store.getRef(cur.parentRefId) : null;
      projState.rootRef = parent ? parent.id : pageRootId;
      requestRender(); focusCard(refId, pos);
    },
  };
}

function renderPage(store, mount, requestRender, projState, onJump){
  const page = store.ensureProjectPage(projState.projId);
  const pageRootId = page.ref.id;
  let rootRefId = projState.rootRef || pageRootId;
  let fref = store.getRef(rootRefId);
  if (!fref){ rootRefId = pageRootId; fref = page.ref; }
  projState.rootRef = rootRefId;
  const fbody = store.getBody(fref.bodyId);

  // パンくず: プロジェクト(→一覧) ＋ PJルートから fref.parent までの祖先
  const crumb = [{ label: 'プロジェクト', onClick: () => { projState.projId = null; projState.rootRef = null; requestRender(); } }];
  const path = [];
  let p = fref.parentRefId ? store.getRef(fref.parentRefId) : null;
  while (p){ path.push(p); if (p.id === pageRootId) break; p = p.parentRefId ? store.getRef(p.parentRefId) : null; }
  path.reverse();
  for (const aref of path){
    const ab = store.getBody(aref.bodyId); if (!ab) continue;
    crumb.push({ label: ab.content || (ab.kind === 'project' ? 'PJ' : '(空)'),
                 onClick: () => { projState.rootRef = aref.id; requestRender(); } });
  }

  renderOutlinePage(store, mount, requestRender, fref, fbody, {
    crumb,
    inheritProj: projState.projId,                          // ページで作るカードは所属PJを継承
    ...projZoomHandlers(store, requestRender, projState, pageRootId, mount),
  });

  // 📌 割当カード集約（PJルート表示時のみ・サブカードにズーム中は出さない）
  if (rootRefId === pageRootId) renderMirrorSection(store, mount, requestRender, projState.projId, pageRootId, onJump);
}
// 割当カードの簡易フィルタUI（#6）。キーワードは1入力ごとにフォーカスを戻す。
function buildMirrorFilter(requestRender){
  const bar = document.createElement('div'); bar.className = 'proj-mirror-filter';
  const kw = document.createElement('input');
  kw.type = 'text'; kw.className = 'pm-filter-kw'; kw.placeholder = 'キーワード'; kw.value = _mirrorFilter.kw;
  const applyKw = () => { _mirrorFilter.kw = kw.value; _restoreKw = true; requestRender(); };
  kw.addEventListener('input', (e) => { if (e.isComposing) return; applyKw(); });   // IME変換中は再描画しない（入力欄の作り直しで変換が途中確定するのを防ぐ）
  kw.addEventListener('compositionend', applyKw);                                     // 変換確定時にまとめて反映
  bar.appendChild(kw);
  const chk = document.createElement('label'); chk.className = 'pm-filter-chk';
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = _mirrorFilter.hideDone;
  cb.addEventListener('change', () => { _mirrorFilter.hideDone = cb.checked; requestRender(); });
  chk.appendChild(cb); chk.appendChild(document.createTextNode(' 完了を隠す'));
  bar.appendChild(chk);
  const due = document.createElement('select'); due.className = 'pm-filter-due';
  [['all','期限:すべて'], ['has','期限あり'], ['overdue','期限切れ'], ['soon','今後7日']].forEach(([v, t]) => {
    const o = document.createElement('option'); o.value = v; o.textContent = t; if (_mirrorFilter.due === v) o.selected = true; due.appendChild(o);
  });
  due.addEventListener('change', () => { _mirrorFilter.due = due.value; requestRender(); });
  bar.appendChild(due);
  if (_restoreKw){ _restoreKw = false; setTimeout(() => { kw.focus(); kw.selectionStart = kw.selectionEnd = kw.value.length; }, 0); }   // 入力後にフォーカスを戻す
  return bar;
}
// PJタグ付きカードのミラーを出所の日付ごとに列挙（実体を編集可能描画・全ビュー反映）
function renderMirrorSection(store, mount, requestRender, projId, pageRootId, onJump){
  const sec = document.createElement('div'); sec.className = 'proj-mirror';
  const head = document.createElement('div'); head.className = 'proj-mirror-head'; head.textContent = '📌 割当カード';
  sec.appendChild(head);
  const allRoots = collectMirrorRoots(store, projId, pageRootId);
  if (!allRoots.length){
    const e = document.createElement('p'); e.className = 'proj-mirror-empty';
    e.textContent = 'このプロジェクトのタグが付いたカードはまだありません（デイリー等で #このPJ を割り当てると集まります）。';
    sec.appendChild(e); mount.appendChild(sec); return;
  }
  sec.appendChild(buildMirrorFilter(requestRender));          // #6 簡易フィルタ（キーワード/完了を隠す/期限）
  const today = new Date().toISOString().slice(0, 10);
  let roots = filterMirrorRoots(allRoots, _mirrorFilter, today);
  roots = roots.filter(r => !isDoneHidden(store, r.ref.id));   // 全ビュー共通の完了非表示（Alt+H）にも追随＝空グループを出さない
  if (!roots.length){
    const e = document.createElement('p'); e.className = 'proj-mirror-empty';
    e.textContent = '条件に一致する割当カードがありません。';
    sec.appendChild(e); mount.appendChild(sec); return;
  }
  for (const { day, roots: rs } of groupByDay(roots)){
    const g = document.createElement('div'); g.className = 'proj-mirror-group';
    const dl = document.createElement('div'); dl.className = 'proj-mirror-day'; dl.textContent = day;
    g.appendChild(dl);
    renderChildren(store, null, g, 0, requestRender, { refs: rs.map(r => r.ref), mirrorRoot: true });
    sec.appendChild(g);
  }
  mount.appendChild(sec);
  // 各ミラールート行に「↗ 元の場所へ」
  if (onJump) sec.querySelectorAll('.card-row[data-mirror-root]').forEach(row => {
    const holder = row.querySelector('[data-ref]'); if (!holder) return;
    const r = store.getRef(holder.dataset.ref); if (!r) return;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'mirror-jump'; btn.textContent = '↗'; btn.title = '元の場所（デイリー）へ';
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => { e.stopPropagation(); onJump(r.bodyId); });
    row.appendChild(btn);
  });
}
