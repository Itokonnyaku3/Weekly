// タグプロパティ: タグ抽出（#タグ）と、タグに紐づくカスタムプロパティのスキーマ・値操作。
// スキーマは今は組み込み定数（B案）。ユーザー定義UI（A案）は docs/BACKLOG.md 参照。
// search.js / list.js の双方から使う共通土台（循環importを避けるため独立モジュール・依存なし）。

export const TAG_RE = /#([^\s#⟦⟧]+)/g;
// 本文中の #タグ 名の集合
export function cardTags(content){
  const set = new Set(); let m; TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(content || ''))) set.add(m[1]);
  return set;
}

// タグごとのプロパティ定義。type: 'date' | 'select'（selectは options 必須）
export const TAG_SCHEMAS = {
  '請求処理': {
    props: [
      { key:'quote',  label:'見積日',     type:'date' },
      { key:'order',  label:'発注',       type:'date' },
      { key:'bill',   label:'請求処理',   type:'date' },
      { key:'pay',    label:'支払日',     type:'date' },
      { key:'status', label:'ステータス', type:'select',
        options:['未着手','見積依頼中','発注済','請求処理中','支払済','完了'] },
    ],
  },
};

// 条件グループ群（[{tags:[...]}]）で指定されたタグのうちスキーマを持つものを、出現順・重複なしで返す
export function schemaTagsInGroups(groups){
  const out = [];
  for (const g of (groups || [])){
    for (const t of (g && g.tags) || []){
      if (TAG_SCHEMAS[t] && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

// 動的列キー 'p:タグ:プロパティキー'。プロパティキーはコード定義で ':' を含まない前提。
export function propColKey(tag, key){ return 'p:' + tag + ':' + key; }
export function parsePropColKey(colKey){
  if (typeof colKey !== 'string' || !colKey.startsWith('p:')) return null;
  const rest = colKey.slice(2);
  const i = rest.lastIndexOf(':');                 // タグ名に ':' が入っても key 側は含まないので末尾区切り
  if (i <= 0 || i >= rest.length - 1) return null;
  return { tag: rest.slice(0, i), key: rest.slice(i + 1) };
}
export function propDef(tag, key){
  const s = TAG_SCHEMAS[tag];
  return (s && s.props.find(p => p.key === key)) || null;
}

// body.props への値セット/クリア用パッチを作る（updateBody に渡す）。
// 空値（''/null/undefined）はキー削除。全て空になったら props ごと undefined（JSON化で消える）。
export function propsPatch(body, key, value){
  const props = { ...((body && body.props) || {}) };
  if (value === '' || value == null) delete props[key];
  else props[key] = value;
  return { props: Object.keys(props).length ? props : undefined };
}
