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
