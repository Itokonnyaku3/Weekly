// 絞り込み条件の照合を1本化（リスト＝表 と 検索＝アウトラインで共用）。
// 条件モデル: group（グループ内AND）を groups 配列で持ち、グループ間はOR。
//   group = { keyword, tags[], proj, mid, due, done, prio }
//   query = { groups:[group,…] } … 単一 group をそのまま渡してもよい（toGroups が吸収）
// 表示（列/並べ替え/アウトライン）は各ビューの担当。ここは純ロジックのみ＝依存は props.js だけ（循環なし）。

const _q = new URL(import.meta.url).search;
const { cardTags } = await import('./props.js' + _q);

export function defaultGroup(){
  return {
    keyword: '',
    tags: [],
    proj: 'all',
    mid:  '',
    due:  { mode: 'any', from: null, to: null },
    done: { mode: 'any', from: null, to: null },
    prio: 'all',
  };
}
// 単一 group / { groups:[…] } のどちらでも group 配列に正規化（空は「条件なし」の1グループ）
export function toGroups(query){
  if (!query) return [{}];
  if (Array.isArray(query.groups)) return query.groups.length ? query.groups : [{}];
  return [query];
}

function dayDiff(date, today){
  return Math.round((Date.parse(date+'T00:00:00') - Date.parse(today+'T00:00:00')) / 86400000);
}
export function keywordMatch(content, kw){
  if (!kw) return true;
  return (content || '').toLowerCase().includes(String(kw).toLowerCase());
}
// タグ条件: 指定タグをすべて含む（AND）。空/未定義は条件なし。OR はグループの追加で表現。
export function tagsMatch(content, tags){
  if (!tags || !tags.length) return true;
  const set = cardTags(content);
  return tags.every(x => set.has(x));
}
export function projMatch(proj, filter){
  if (!filter || filter === 'all') return true;   // 未指定は「すべて」（filter=undefined で誤判定しない）
  if (filter === 'none') return !proj;
  return proj === filter;        // 特定PJのID
}
export function midMatch(mid, needle){
  if (!needle) return true;
  return (mid || '').toLowerCase().includes(String(needle).toLowerCase());
}
export function prioMatch(prio, filter){
  if (!filter || filter === 'all') return true;
  return String(prio || 0) === String(filter);
}
export function dueGroupMatch(due, cond, today){
  if (!cond || cond.mode === 'any') return true;
  if (cond.mode === 'none') return !due;
  if (!due) return false;                          // mode === 'range'
  const d = dayDiff(due, today);
  if (cond.from != null && d < cond.from) return false;
  if (cond.to   != null && d > cond.to)   return false;
  return true;
}
// 完了条件。メモ（done を持たない）は notDone 扱い＝done 指定では非該当。range は完了日（doneAt）基準。
export function doneGroupMatch(body, cond, today){
  if (!cond || cond.mode === 'any') return true;
  if (cond.mode === 'notDone') return !body.done;
  if (!body.done) return false;                    // mode === 'done'
  if (cond.from == null && cond.to == null) return true;   // 完了日は問わない
  if (!body.doneAt) return false;                   // 完了日時が未記録（過去に完了したカード）
  const d = dayDiff(body.doneAt.slice(0, 10), today);
  if (cond.from != null && d < cond.from) return false;
  if (cond.to   != null && d > cond.to)   return false;
  return true;
}
// 1グループ（AND）。未指定の項目は条件なし＝毎回のオブジェクト生成を避けて各判定側で吸収する（描画ごとに全カード分呼ばれる）。
export function matchGroup(body, g, today){
  g = g || {};
  return keywordMatch(body.content, g.keyword)
      && tagsMatch(body.content, g.tags)
      && projMatch(body.proj, g.proj)
      && midMatch(body.mid, g.mid)
      && dueGroupMatch(body.due, g.due, today)
      && doneGroupMatch(body, g.done, today)
      && prioMatch(body.prio, g.prio);
}
// クエリ全体（グループ間OR）。opts.kinds を渡すとその kind のカードだけ対象（表=task / アウトライン=memo+task）。
export function matchQuery(body, query, today, opts){
  if (!body) return false;
  const kinds = opts && opts.kinds;
  if (kinds && !kinds.includes(body.kind)) return false;
  return toGroups(query).some(g => matchGroup(body, g, today));
}

// ── 表 ⇄ アウトラインの条件受け渡し ──
// アウトライン（検索ビュー）の条件バーは単一ANDで中項目欄を持たないため、mid は落とす
// ＝「見えている条件だけが効く」を保つ。落とした事実は呼び出し側が通知する（dropped で判る）。
export function groupToFlatQuery(g){
  g = g || {};
  return {
    query: {
      keyword: g.keyword || '',
      tags: (g.tags || []).slice(),
      proj: g.proj || 'all',
      due: g.due ? { ...g.due } : { mode:'any' },
      done: g.done ? { ...g.done } : { mode:'any' },
      prio: g.prio || 'all',
    },
    dropped: g.mid ? ['mid'] : [],
  };
}
export function flatQueryToGroup(q){
  return { ...defaultGroup(), ...(q || {}), mid: '' };
}
