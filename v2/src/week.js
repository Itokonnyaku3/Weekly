// 週次ビューの純ロジック: 週キー計算 / カードの所属週 / PJ×週の集約 / カーソル移動 / 週報生成。
// DOM に触らない＝単体テスト可能。依存は props.js（#タグ抽出）のみ＝循環なし。
// 週は月曜始まり。週キーはその週の月曜 'YYYY-MM-DD'（辞書順＝時系列順でソートできる）。
const _q = new URL(import.meta.url).search;
const { cardTags, TAG_RE } = await import('./props.js' + _q);
const { dateOf } = await import('./time.js' + _q);       // createdAt/doneAt（UTCのISO）→ JSTの日付

export const WEEK_COUNT = 6;                  // 同時に表示する週数
export const WEEK_BACK  = 1;                  // 表示範囲に含める過去週数（先週を1つ）
export const MS_TAG = 'マイルストーン';        // マイルストーン判定に使うタグ名

const _parse = (s) => Date.parse(String(s || '').slice(0, 10) + 'T00:00:00');
const _fmt = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
};
// 日数の加減算。ミリ秒加算ではなく setDate を使う（夏時間のある環境でもズレない）
export function shiftDays(dateStr, n){
  const t = _parse(dateStr);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t); d.setDate(d.getDate() + n); return _fmt(d);
}
// その日が属する週の月曜（不正値は null＝壊れた保存データでクラッシュしない）
export function weekStart(dateStr){
  const t = _parse(dateStr);
  if (!Number.isFinite(t)) return null;
  const dy = new Date(t).getDay();                       // 0=日曜
  return shiftDays(dateStr, -(dy === 0 ? 6 : dy - 1));
}
export function weekAdd(wk, n){ return shiftDays(wk, n * 7); }
export function weekLabel(wk){
  const a = new Date(_parse(wk)), b = new Date(_parse(shiftDays(wk, 6)));
  return (a.getMonth() + 1) + '/' + a.getDate() + '〜' + (b.getMonth() + 1) + '/' + b.getDate();
}
// 表示する週キーの配列。offset=0 で [今週-WEEK_BACK … ] の WEEK_COUNT 週
export function weeksFor(today, offset = 0){
  const base = weekAdd(weekStart(today), offset - WEEK_BACK);
  return Array.from({ length: WEEK_COUNT }, (_, i) => weekAdd(base, i));
}

// ── カードの所属週 ──
// 優先順位: ref.gridWk（明示上書き）> body.due（期限の週）> 出所日（day祖先）の週 > createdAt の週
export function cardWeekOf(body, ref, dayDate){
  if (ref && ref.gridWk) return ref.gridWk;
  if (body && body.due) return weekStart(body.due);
  if (dayDate) return weekStart(dayDate);
  if (body && body.createdAt) return weekStart(dateOf(body.createdAt));
  return null;
}

// ── マイルストーン（本文の #マイルストーン タグ）──
export function isMilestone(body){
  return cardTags(body && body.content).has(MS_TAG);
}
// #マイルストーン を付け外しした本文を返す（他のタグ・別名タグには触らない）
export function toggleMsContent(content){
  const t = String(content || '');
  if (!cardTags(t).has(MS_TAG)) return (t + ' #' + MS_TAG).trim();
  let out = '', last = 0, m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(t))){
    if (m[1] !== MS_TAG) continue;              // 別タグ（#マイルストーン2 等）はそのまま残す
    out += t.slice(last, m.index);
    last = m.index + m[0].length;
  }
  out += t.slice(last);
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

// ── 集約 ──
// 祖先walkのメモ化索引。描画ごとに全カードを走査するため O(N) を維持する
// （project.js の collectMirrorRoots を全PJ1パスに一般化したもの）。
function makeAncIndex(store){
  const topMemo = new Map();     // refId -> { rootRefId, dayDate }
  const projMemo = new Map();    // refId -> Set（祖先の proj 値）
  function topInfo(refId){
    if (topMemo.has(refId)) return topMemo.get(refId);
    const r = store.getRef(refId);
    let out;
    if (!r) out = { rootRefId: null, dayDate: null };
    else if (!r.parentRefId){
      const b = store.getBody(r.bodyId);
      out = { rootRefId: r.id, dayDate: (b && b.kind === 'day') ? b.content : null };
    } else out = topInfo(r.parentRefId);
    topMemo.set(refId, out);
    return out;
  }
  function ancProjs(refId){
    if (projMemo.has(refId)) return projMemo.get(refId);
    const r = store.getRef(refId);
    let out;
    if (!r || !r.parentRefId) out = new Set();
    else {
      const pr = store.getRef(r.parentRefId);
      const pb = pr && store.getBody(pr.bodyId);
      out = new Set(ancProjs(r.parentRefId));
      if (pb && pb.proj) out.add(pb.proj);
    }
    projMemo.set(refId, out);
    return out;
  }
  return { topInfo, ancProjs };
}

const _cmp = (a, b) => { a = a || ''; b = b || ''; return a < b ? -1 : a > b ? 1 : 0; };
const _dueCmp = (a, b) => {
  const x = a.body.due, y = b.body.due;
  if (!x && !y) return 0;
  if (!x) return 1;                      // 期限なしは後ろ
  if (!y) return -1;
  return _cmp(x, y);
};
const CMP = {
  ms:   (a, b) => _cmp(a.body.due || a.day, b.body.due || b.day) || _cmp(a.body.content, b.body.content),
  todo: (a, b) => (b.body.prio || 0) - (a.body.prio || 0) || _dueCmp(a, b) || _cmp(a.day, b.day) || _cmp(a.body.content, b.body.content),
  done: (a, b) => _cmp(a.body.doneAt, b.body.doneAt) || _cmp(a.body.content, b.body.content),
  memo: (a, b) => _cmp(a.day, b.day) || _cmp(a.body.content, b.body.content),
  over: (a, b) => _cmp(a.wk, b.wk) || (b.body.prio || 0) - (a.body.prio || 0) || _cmp(a.body.content, b.body.content),
};
export const BLOCK_KEYS = ['ms', 'todo', 'done', 'memo', 'over'];
const LINK_NODE = 'リンク';                // この名前の直下ノードの「子」がリンク列になる

// PJ×週のグリッドデータを作る（DOM非依存）。weeks は weeksFor() の結果。
export function buildWeeklyGrid(store, { weeks, today, hideEmpty = false } = {}){
  const wkSet = new Set(weeks);
  const curWk = weekStart(today);
  const projs = store.listProjects();
  const mkCells = () => {
    const c = {};
    for (const w of weeks) c[w] = { ms:[], todo:[], done:[], memo:[], over:[] };
    return c;
  };
  const pageRoots = new Map();             // PJページのルート refId -> projId
  const rowByProj = new Map();
  for (const p of projs){
    const row = { projId: p.id, proj: p, kids: [], links: [], cells: mkCells(), total: 0 };
    rowByProj.set(p.id, row);
    const root = store.refsForBody(p.id).find(r => r.parentRefId === null);
    if (!root) continue;
    pageRoots.set(root.id, p.id);
    for (const c of store.childRefs(root.id)){        // PJ直下ノード／リンク列
      const b = store.getBody(c.bodyId);
      if (!b) continue;
      if ((b.content || '').trim() === LINK_NODE){
        for (const gr of store.childRefs(c.id)){
          const gb = store.getBody(gr.bodyId);
          if (gb) row.links.push({ ref: gr, body: gb });
        }
      } else row.kids.push({ ref: c, body: b });
    }
  }
  const unassigned = { projId: null, proj: null, kids: [], links: [], cells: mkCells(), total: 0 };
  const { topInfo, ancProjs } = makeAncIndex(store);

  for (const b of store.queryBodies(x => x.kind !== 'project' && x.kind !== 'day')){
    const ref = store.refsForBody(b.id)[0];
    if (!ref) continue;
    const top = topInfo(ref.id);
    if (pageRoots.has(top.rootRefId)) continue;            // PJページ内は除外（PJ列に出ている）
    const ancs = ancProjs(ref.id);
    let row;
    if (b.proj){
      if (ancs.has(b.proj)) continue;                      // 同PJの祖先を持つ＝最上位だけ拾う
      row = rowByProj.get(b.proj);
      if (!row) continue;                                  // 消えたPJを指している
    } else {
      if (b.kind !== 'task' || b.done) continue;           // 未割当行は未完了タスクのみ
      let hasProjAnc = false;
      for (const v of ancs) if (v){ hasProjAnc = true; break; }
      if (hasProjAnc) continue;                            // 割当済みタスクのサブタスクは拾わない
      row = unassigned;
    }
    const wk = cardWeekOf(b, ref, top.dayDate);
    const e = { ref, body: b, day: top.dayDate, wk };
    if (isMilestone(b)){                                   // マイルストーンは所属週の先頭・繰越しない
      if (wkSet.has(wk)){ row.cells[wk].ms.push(e); row.total++; }
    } else if (b.kind === 'task' && b.done){
      const dw = b.doneAt ? weekStart(dateOf(b.doneAt)) : wk;   // やったこと＝完了週（JSTの完了日で判定）
      if (wkSet.has(dw)){ row.cells[dw].done.push(e); row.total++; }
    } else if (b.kind === 'task'){
      if (wkSet.has(wk)){ row.cells[wk].todo.push(e); row.total++; }
      for (const w of weeks){                              // 繰越: 所属週 < w ≤ 今週
        if (wk && w > wk && w <= curWk){ row.cells[w].over.push(e); row.total++; }
      }
    } else {
      if (wkSet.has(wk)){ row.cells[wk].memo.push(e); row.total++; }
    }
  }
  const rows = [];
  for (const p of projs){
    const row = rowByProj.get(p.id);
    for (const w of weeks) for (const k of BLOCK_KEYS) row.cells[w][k].sort(CMP[k]);
    if (!hideEmpty || row.total > 0) rows.push(row);
  }
  if (unassigned.total){
    for (const w of weeks) unassigned.cells[w].todo.sort(CMP.todo);
    rows.push(unassigned);
  }
  return { weeks: weeks.map(w => ({ wk: w, label: weekLabel(w), isCurrent: w === curWk })), rows };
}

// ── カーソル移動（グリッドのキー操作）──
// shape = { rows:[rowId…], cols:[colId…], counts: Map(`rowId|colId` → スロット数) }
//   cols は ['proj','link', …週キー]。空セルもスロット1（セル自体にフォーカス）＝どの (row,col) も1以上。
// cursor = { row, colIdx, idx }（列は添字で持つ＝週送りで週キーが変わっても端に留まれる）
// 戻り値 = { cursor, page }（page: -1|0|+1 の週送り要求。呼び出し側が weeks を作り直す）
export const FIRST_WEEK_COL = 2;

export function slotCount(shape, rowId, colId){
  const n = shape.counts.get(rowId + '|' + colId);
  return n && n > 0 ? n : 1;
}
export function moveCursor(shape, cursor, key){
  const rows = shape.rows, cols = shape.cols;
  if (!rows.length || !cols.length) return { cursor, page: 0 };
  let ri = rows.indexOf(cursor.row); if (ri < 0) ri = 0;
  const ci0 = Math.min(Math.max(cursor.colIdx | 0, 0), cols.length - 1);
  const count = (r, c) => slotCount(shape, rows[r], cols[c]);
  const put = (r, c, i) => ({ row: rows[r], colIdx: c, idx: Math.min(Math.max(i, 0), count(r, c) - 1) });
  const stay = { cursor: put(ri, ci0, cursor.idx | 0), page: 0 };
  const idx = stay.cursor.idx;              // クランプ済みの縦位置

  switch (key){
    case 'ArrowDown':
      if (idx + 1 < count(ri, ci0))  return { cursor: put(ri, ci0, idx + 1), page: 0 };
      if (ri + 1 < rows.length)      return { cursor: put(ri + 1, ci0, 0), page: 0 };
      return stay;
    case 'ArrowUp':
      if (idx > 0)                   return { cursor: put(ri, ci0, idx - 1), page: 0 };
      if (ri > 0)                    return { cursor: put(ri - 1, ci0, count(ri - 1, ci0) - 1), page: 0 };
      return stay;
    case 'ArrowRight':
      if (ci0 + 1 < cols.length)     return { cursor: put(ri, ci0 + 1, idx), page: 0 };
      return { cursor: { row: rows[ri], colIdx: cols.length - 1, idx: 0 }, page: 1 };
    case 'ArrowLeft':
      if (ci0 > 0)                   return { cursor: put(ri, ci0 - 1, idx), page: 0 };
      return { cursor: { row: rows[ri], colIdx: Math.min(FIRST_WEEK_COL, cols.length - 1), idx: 0 }, page: -1 };
    case 'Tab':
      if (ci0 + 1 < cols.length)     return { cursor: put(ri, ci0 + 1, 0), page: 0 };
      if (ri + 1 < rows.length)      return { cursor: put(ri + 1, 0, 0), page: 0 };
      return stay;
    case 'ShiftTab':
      if (ci0 > 0)                   return { cursor: put(ri, ci0 - 1, 0), page: 0 };
      if (ri > 0)                    return { cursor: put(ri - 1, cols.length - 1, 0), page: 0 };
      return stay;
    case 'Home': return { cursor: put(ri, 0, 0), page: 0 };
    case 'End':  return { cursor: put(ri, cols.length - 1, 0), page: 0 };
    default:     return stay;
  }
}

// ── 週報の組み立て（1週ぶんを HTML＋プレーンテキストに）──
// 表示用テキストは #マイルストーン タグを落とす（読み物として不要なため）。
const _escHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const _label = (s) => String(s || '').replace(new RegExp('\\s*#' + MS_TAG + '(?=\\s|$)', 'g'), '').trim();
const REPORT_BLOCKS = [
  ['ms',   'マイルストーン', '🏁 '],
  ['done', 'やったこと',    '・'],
  ['todo', 'やること',      '・'],
  ['memo', 'メモ',          '・'],
  ['over', '期限切れ',      '・'],
];

export function buildWeekReport(grid, wk){
  const head = (grid.weeks || []).find(w => w.wk === wk);
  if (!head) return { plain: '', html: '' };
  let plain = '週次レポート ' + head.label + '\n', html = '<h2>週次レポート ' + _escHtml(head.label) + '</h2>';
  for (const row of grid.rows || []){
    const cell = row.cells && row.cells[wk];
    if (!cell) continue;
    const blocks = REPORT_BLOCKS.filter(([k]) => (cell[k] || []).length);
    if (!blocks.length) continue;
    const name = row.proj ? (row.proj.content || '(無題)') : '未割当';
    plain += '\n■ ' + name + '\n';
    html += '<h3>' + _escHtml(name) + '</h3>';
    for (const [k, title, bullet] of blocks){
      plain += '  【' + title + '】\n';
      html += '<p><b>' + _escHtml(title) + '</b></p><ul>';
      for (const e of cell[k]){
        const t = _label(e.body.content) || '(空)';
        const note = (k === 'over' && e.wk && e.wk !== wk) ? '（' + weekLabel(e.wk).split('〜')[0] + '週）' : '';
        plain += '    ' + bullet + t + note + '\n';
        html += '<li>' + _escHtml(t + note) + '</li>';
      }
      html += '</ul>';
    }
  }
  return { plain, html };
}
