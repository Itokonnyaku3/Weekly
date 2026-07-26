// プロジェクト色: リスト（PJ見出しの色地）と週次ビュー（行の淡い背景）で同じ色を使うための共通土台。
// 依存なしの純ロジック＝どのビューからでも安全に import できる（list.js は互換のため再エクスポート）。

// id から安定した色を引く（並べ替え・リネームに依らず一定。保存もしない＝データを汚さない）
export const PROJ_PALETTE = ['#e0524d','#e08a00','#c9a227','#3a9d3a','#0a9b8a','#2a8fbd','#5b6ee0','#7a5cd0','#c0568f','#b5683a'];
export const PROJ_NONE_COLOR = '#9aa0a6';        // 未割当（PJなし）の色

export function projColor(id){
  if (!id) return PROJ_NONE_COLOR;
  let h = 0; const s = String(id);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PROJ_PALETTE[h % PROJ_PALETTE.length];
}

// '#rrggbb' → 'rgba(r,g,b,a)'。半透明で重ねる前提＝ライト/ダークどちらのテーマでも下地に馴染む。
// 解釈できない値は透明（＝色付けなし）にフォールバックし、描画を壊さない。
export function tintRgba(hex, alpha){
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return 'transparent';
  const n = parseInt(m[1], 16);
  const a = Math.min(Math.max(Number(alpha), 0), 1);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Number.isFinite(a) ? a : 0})`;
}
