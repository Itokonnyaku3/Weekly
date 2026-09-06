// カードの出入りの演出をここに集約する。DOM だけを触り、store は触らない。
// 状態の更新は必ず呼び出し側の onDone で行う（演出が走らなくても状態は必ず進む）。
//
// なぜ集約するか: 完了トグルはデイリー・リスト・週次の3箇所にあり、同じ処理を
// 各所に書くと必ず片方だけ直る（インデント/アウトデントで実際にそうなった）。
//
// 段は style.css の --t1〜--t4（①取り消し線 →②そのまま見せる →③ふわっと消える →④下が詰まる）。
// 「きびきび」= 120 / 60 / 160 / 140ms。速さを変えるときは CSS の4値だけを触る。
// 時間を JS 側に二重に持たないため、合計は毎回 CSS から読む。
//
// 終了検知に animationend は使わない: 1つの要素に複数のアニメーションが載るので、
// 先に終わる段（消える）で発火して後の段（詰まる）を切り落としてしまう。
// また描画されていないタブでは animation が保留のまま開始されない。時間で待つ方が確実。

const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function ms(name){
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return parseFloat(v) || 0;
}
const doneOutMs = () => ms('--t1') + ms('--t2') + ms('--t3') + ms('--t4');
const foldUpMs  = () => ms('--t4');

// 完了したカードの退場: 取り消し線 → 間 → ふわっと消える → 下が詰まる。
// el は .card-row（アウトライン）または tr（リストの表）。onDone で状態を更新する。
export function playDoneOut(el, onDone){
  if (!el || !el.isConnected || reduced()){ onDone(); return; }
  const isRow = el.tagName === 'TR';
  el.style.setProperty('--done-h', el.getBoundingClientRect().height + 'px');   // auto からは補間できない
  el.classList.add(isRow ? 'done-out-tr' : 'done-out');
  setTimeout(onDone, doneOutMs());
}

// 折り畳み: 対象の行たちが上へ吸い込まれて消える。rows は連続した子孫行。
export function playFoldUp(rows, onDone){
  const live = (rows || []).filter(r => r && r.isConnected);
  if (!live.length || reduced()){ onDone(); return; }
  for (const r of live){
    r.style.setProperty('--done-h', r.getBoundingClientRect().height + 'px');
    r.classList.add('fold-up');
  }
  setTimeout(onDone, foldUpMs());
}

// row の直後に続く「より深い」行（＝その行の子孫）を集める。
// renderChildren は子を同じ親にフラットに並べ paddingLeft でインデントするため、
// 入れ子の箱が無い。深さは paddingLeft で判定する。
export function descendantRows(row){
  const depthOf = (el) => parseFloat(el.style.paddingLeft) || 0;
  const base = depthOf(row);
  const out = [];
  for (let n = row.nextElementSibling; n; n = n.nextElementSibling){
    if (!n.classList || !n.classList.contains('card-row')) break;
    if (depthOf(n) <= base) break;
    out.push(n);
  }
  return out;
}
