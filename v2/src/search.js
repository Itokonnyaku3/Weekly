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
