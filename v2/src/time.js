// 「今日はいつか」「この時刻は何日か」の判定を日本時間（UTC+9）に一本化するモジュール。
//
// 背景: new Date().toISOString() は UTC 整形のため、JST 00:00〜08:59 の間は前日の日付を返す。
//       日付を決める処理は必ずここを通すこと（各所で new Date() を整形し直さない）。
// 依存なし＝どのモジュールからでも import できる（循環しない）。

export const TZ_OFFSET_MIN = 9 * 60;   // 日本標準時。夏時間が無いので固定値でよい。他TZで使うならここだけ変える

const pad = (n) => String(n).padStart(2, '0');
// 基準TZの壁時計ぶんずらした Date を作り、getUTC* で読む＝実行環境のTZに左右されない
const shifted = (t) => new Date(t.getTime() + TZ_OFFSET_MIN * 60000);
const ymd = (d) => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());

// 今日（JST）の 'YYYY-MM-DD'。now を渡すとその時刻基準（テスト用）
export function todayStr(now){
  const t = now ? new Date(now) : new Date();
  return isNaN(t) ? '' : ymd(shifted(t));
}

// 時刻値 → その時刻が JST で何日かの 'YYYY-MM-DD'。
// createdAt / doneAt などの UTC ISO を日付に落とすときに使う（.slice(0,10) は前日になる）。
// 'YYYY-MM-DD'（時刻を持たない期限・日カード等）はTZの概念が無いのでそのまま返す。壊れた値は ''。
export function dateOf(value){
  if (!value) return '';
  if (value instanceof Date) return isNaN(value) ? '' : ymd(shifted(value));
  let s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // TZ指定の無い日時（'2026-07-01T10:00:00'）はJSTの壁時計として読む＝実行環境のTZで結果が変わらない
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) && !/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s += '+09:00';
  const t = Date.parse(s);
  return Number.isFinite(t) ? ymd(shifted(new Date(t))) : '';
}
