// 検索/ライブクエリ: 純ロジック（テスト対象）＋ 検索ビュー描画。
const _q = new URL(import.meta.url).search;
const { dueGroupMatch, projMatch } = await import('./list.js' + _q);
const { renderChildren } = await import('./daily.js' + _q);

const TAG_RE = /#([^\s#⟦⟧]+)/g;
// 本文中の #タグ 名の集合
export function cardTags(content){
  const set = new Set(); let m; TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(content || ''))) set.add(m[1]);
  return set;
}
// カードが query に AND で一致するか。対象は memo/task のみ。
export function matchCard(body, query, today){
  if (!body || (body.kind !== 'memo' && body.kind !== 'task')) return false;
  const q = query || {};
  if (q.keyword){ if (!(body.content || '').toLowerCase().includes(q.keyword.toLowerCase())) return false; }
  if (q.tags && q.tags.length){ const tags = cardTags(body.content); for (const t of q.tags) if (!tags.has(t)) return false; }
  if (q.proj && q.proj !== 'all'){ if (!projMatch(body.proj, q.proj)) return false; }
  if (q.due && q.due.mode && q.due.mode !== 'any'){ if (!dueGroupMatch(body.due, q.due, today)) return false; }
  if (q.done && q.done.mode === 'done'  && !body.done) return false;
  if (q.done && q.done.mode === 'notDone' && body.done) return false;
  if (q.prio && q.prio !== 'all'){ if (String(body.prio || 0) !== q.prio) return false; }
  return true;
}
// 一致カードのうち「祖先も一致するもの」は除外し、最上位の一致だけを {ref, body} で返す（ミラー重複除外）。
export function runQuery(store, query, today){
  const matched = store.queryBodies(b => matchCard(b, query, today));
  const ids = new Set(matched.map(b => b.id));
  const out = [];
  for (const b of matched){
    const ref = store.refsForBody(b.id)[0];
    if (!ref) continue;
    let p = ref.parentRefId, skip = false;
    while (p){ const pr = store.getRef(p); if (!pr) break; if (ids.has(pr.bodyId)){ skip = true; break; } p = pr.parentRefId; }
    if (!skip) out.push({ ref, body: b });
  }
  return out;
}
// 出所の日付（親をたどって最初の day）。無ければ null。
export function sourceDay(store, refId){
  let p = refId; while (p){ const r = store.getRef(p); if (!r) break; const b = store.getBody(r.bodyId); if (b && b.kind === 'day') return b.content; p = r.parentRefId; }
  return null;
}

// ── 検索ビュー描画（クエリビルダ＋編集可能ミラー結果・ライブ）──
export function renderSearchView(store, mount, requestRender, state, onJump){
  mount.innerHTML = '';
  const today = new Date().toISOString().slice(0, 10);
  const q = state.query;

  const bar = document.createElement('div'); bar.className = 'search-bar';
  const kw = document.createElement('input'); kw.type = 'text'; kw.className = 'search-kw'; kw.placeholder = 'キーワード'; kw.value = q.keyword || '';
  kw.addEventListener('input', () => { q.keyword = kw.value; state._refocus = 'kw'; requestRender(); });
  bar.appendChild(labelWrap('語', kw));
  const tg = document.createElement('input'); tg.type = 'text'; tg.className = 'search-tags'; tg.placeholder = 'タグ（#無し・空白区切り）'; tg.value = (q.tags || []).join(' ');
  tg.addEventListener('input', () => { q.tags = tg.value.split(/[\s,]+/).map(s => s.replace(/^#/, '')).filter(Boolean); state._refocus = 'tg'; requestRender(); });
  bar.appendChild(labelWrap('タグ', tg));
  const projOpts = [['all', 'すべて'], ['none', '未割当'], ...store.listProjects().map(p => [p.id, p.content || '(無題)'])];
  bar.appendChild(labelWrap('PJ', selectEl(projOpts, q.proj || 'all', v => { q.proj = v; requestRender(); })));
  bar.appendChild(labelWrap('期限', selectEl([
    ['any','すべて'], ['overdue','期限切れ'], ['today','今日'], ['soon','今後7日'], ['none','期限なし'],
  ], duePreset(q.due), v => { q.due = presetToDue(v); requestRender(); })));
  bar.appendChild(labelWrap('完了', selectEl([['any','すべて'], ['notDone','未完了'], ['done','完了']], (q.done && q.done.mode) || 'any', v => { q.done = { mode: v }; requestRender(); })));
  bar.appendChild(labelWrap('優先度', selectEl([['all','すべて'], ['3','高'], ['2','中'], ['1','低'], ['0','なし']], q.prio || 'all', v => { q.prio = v; requestRender(); })));
  mount.appendChild(bar);

  const roots = runQuery(store, q, today);
  const cnt = document.createElement('div'); cnt.className = 'search-count'; cnt.textContent = roots.length + ' 件';
  mount.appendChild(cnt);

  if (!roots.length){
    const e = document.createElement('p'); e.className = 'search-empty'; e.textContent = '条件に一致するカードがありません。';
    mount.appendChild(e);
  } else {
    const byDay = {};
    for (const r of roots){ const d = sourceDay(store, r.ref.id) || 'その他'; (byDay[d] = byDay[d] || []).push(r); }
    Object.keys(byDay).sort((a, b) => a === 'その他' ? 1 : b === 'その他' ? -1 : (a < b ? 1 : -1)).forEach(day => {
      const g = document.createElement('div'); g.className = 'search-group';
      const dl = document.createElement('div'); dl.className = 'search-day'; dl.textContent = day;
      g.appendChild(dl);
      renderChildren(store, null, g, 0, requestRender, { refs: byDay[day].map(r => r.ref), mirrorRoot: true });
      mount.appendChild(g);
    });
    if (onJump) mount.querySelectorAll('.card-row[data-mirror-root]').forEach(row => {
      const holder = row.querySelector('[data-ref]'); if (!holder) return;
      const r = store.getRef(holder.dataset.ref); if (!r) return;
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'mirror-jump'; btn.textContent = '↗'; btn.title = '元の場所へ';
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', (e) => { e.stopPropagation(); onJump(r.bodyId); });
      row.appendChild(btn);
    });
  }
  if (state._refocus){ const el = mount.querySelector(state._refocus === 'kw' ? '.search-kw' : '.search-tags'); state._refocus = null; if (el){ el.focus(); el.selectionStart = el.selectionEnd = el.value.length; } }
}
function labelWrap(label, control){ const f = document.createElement('label'); f.className = 'search-field'; f.appendChild(document.createTextNode(label)); f.appendChild(control); return f; }
function selectEl(opts, val, onChange){ const s = document.createElement('select'); opts.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; if (v === val) o.selected = true; s.appendChild(o); }); s.addEventListener('change', () => onChange(s.value)); return s; }
function duePreset(due){ if (!due || due.mode === 'any') return 'any'; if (due.mode === 'none') return 'none'; if (due.to === -1 && due.from == null) return 'overdue'; if (due.from === 0 && due.to === 0) return 'today'; if (due.from === 0 && due.to === 7) return 'soon'; return 'any'; }
function presetToDue(v){ switch (v){ case 'overdue': return { mode:'range', from:null, to:-1 }; case 'today': return { mode:'range', from:0, to:0 }; case 'soon': return { mode:'range', from:0, to:7 }; case 'none': return { mode:'none' }; default: return { mode:'any' }; } }
