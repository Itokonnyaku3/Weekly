// プロジェクトビュー: ランディング（PJ一覧）＋ 選択PJのノートページ。
// ノートページは daily の renderOutlinePage を共用（編集・ナビ・@メンション・バックリンクをそのまま再利用）。
const _q = new URL(import.meta.url).search;
const { renderOutlinePage, focusCard } = await import('./daily.js' + _q);

function countDescendants(store, refId){
  let n = 0;
  for (const r of store.childRefs(refId)){ n++; n += countDescendants(store, r.id); }
  return n;
}

export function renderProjectView(store, mount, requestRender, projState){
  mount.innerHTML = '';
  const body = projState.projId ? store.getBody(projState.projId) : null;
  if (!projState.projId || !body || body.kind !== 'project'){   // 一覧（未選択／消えたPJ）
    projState.projId = null; projState.rootRef = null;
    renderLanding(store, mount, requestRender, projState);
    return;
  }
  renderPage(store, mount, requestRender, projState);
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

function renderPage(store, mount, requestRender, projState){
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
}
