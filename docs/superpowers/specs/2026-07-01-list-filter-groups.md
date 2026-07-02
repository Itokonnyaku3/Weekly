# リストの検索条件拡張（条件グループ・OR）

- 日付: 2026-07-01
- 対象: Tracker v2（`v2/`）。`store.js`（doneAt自動記録）、`list.js`（フィルタロジック・UI・ビュー保存の形式変更）。
- 由来: ユーザー依頼「1か月以内の完了タスク OR 今後1週間が期限のタスクだけを期限の降順で表示、のような検索条件を組みたい」。

## 確定方針（ユーザー選択）

1. **条件グループをORで追加**方式。各グループ内の条件はAND、グループ間はOR。
2. グループで指定できる項目: **期限の相対範囲（今日から±N日）**／**完了状態＋完了日の相対範囲（新規: `doneAt` 記録開始）**／**プロジェクト・中項目・優先度**。
3. `doneAt` は `store.updateBody` に集約して自動記録（呼び出し側の修正不要）。
4. 並べ替えに **昇順/降順トグル**を追加（プロジェクト＝ツリー表示時は無効・従来の階層順を維持）。
5. 既定は1グループ・全項目「すべて」＝現状の「絞り込みなし」と同じ。「＋OR条件を追加」で増やす。今の「完了を隠す」チェックボックスは廃止し、グループ内「完了状態」に統合。
6. カスタムビュー保存は groups／sortDir も保存。旧形式（hideDone/dueFilter/projFilter）の保存済みビューは読み込み時に自動でグループ1つへ変換し、そのまま使える。

## `doneAt` 自動記録（store.js）

`updateBody(id, patch)` で `patch` に `done` が含まれるとき:
- 現在 `false`（or未設定）→ `patch.done===true`: `doneAt = 現在時刻(ISO)` を自動付与。
- `patch.done===false`: `doneAt = undefined`（消去）。
- 呼び出し側（`daily.js` の checkbox / Ctrl+Enterサイクル、`list.js` の checkbox）は無修正で自動的に効く。

**制限**: 過去に完了済み（このリリース以前に `done:true` にした）タスクは `doneAt` を持たないため、完了日での絞り込みには出てこない。今後の完了操作から有効。コピー＆ペーストでは `doneAt` を引き継がない（別カード扱い・新規作成時刻が `createdAt` になるのみ）。

## フィルタのデータ形式（`list.js`）

```js
// 1グループの形
{
  due:  { mode: 'any' | 'range' | 'none', from: number|null, to: number|null },  // from/to = 今日からの相対日数（両端含む）。range時のみ有効・null=無制限
  done: { mode: 'any' | 'notDone' | 'done', from: number|null, to: number|null }, // from/to は mode='done' のときのみ・doneAt基準の相対日数。両方nullなら完了日は問わない
  proj: 'all' | 'none' | <projId>,
  mid:  string,        // 部分一致（大小無視）。'' = 条件なし
  prio: 'all' | '0' | '1' | '2' | '3',
}
```

`state.groups` = 上記オブジェクトの配列（既定は1要素、全フィールドが「すべて/any/all/''」）。
`state.sort`（既存の5種）＋ `state.sortDir`: `'asc' | 'desc'`（既定 `'asc'`）。

### マッチング（`selectTasks` 拡張）

```
groupMatch(t, g, today) =
  dueMatch(t.due, g.due, today)
  && doneMatch(t, g.done, today)
  && projMatch(t.proj, g.proj)
  && (!g.mid || (t.mid||'').toLowerCase().includes(g.mid.toLowerCase()))
  && (g.prio === 'all' || String(t.prio||0) === g.prio)

selectTasks(tasks, opts, today, projOrder) =
  let cmp = sortCmp(sort, projOrder)
  if (sortDir === 'desc' && sort !== 'proj') cmp = (a,b) => -cmp0(a,b)   // 比較関数そのものを符号反転（tie-breakも含め一貫して逆順に）
  tasks.filter(t => groups.some(g => groupMatch(t, g, today))).sort(cmp)
```

- `dueMatch`: `mode==='any'` → 常に真。`'none'` → `!due`。`'range'` → `due` が無ければ偽、あれば `dayDiff(due,today)` が `[from,to]`（null側は無制限）に入るか。
- `doneMatch`: `mode==='any'` → 常に真。`'notDone'` → `!t.done`。`'done'` → `t.done` が偽なら偽。`from`/`to` が両方nullなら真。どちらか指定時は `t.doneAt` が無ければ偽、あれば `dayDiff(doneAt.slice(0,10), today)` が範囲内か。
- 例（ユーザー提示）: `groups = [{done:{mode:'done',from:-30,to:0}, due:{mode:'any'}, proj:'all', mid:'', prio:'all'}, {due:{mode:'range',from:0,to:7}, done:{mode:'any'}, proj:'all', mid:'', prio:'all'}]`、`sort:'due', sortDir:'desc'`。

### 並べ替え方向

`sortCmp` は不変（比較関数を返す）。`sort!=='proj'` かつ `sortDir==='desc'` のときだけ、comparator の符号を反転して適用（`proj`＝ツリー表示は常に既存の階層順のまま・トグルは無効化してUIにも反映）。

## UI（`list.js`）

- 既存の「期限/PJ/並べ替え/完了を隠す/列」バーを次に置き換え:
  - グループごとに1枚のカード型行（期限モード＋range時from/to数値入力／完了状態＋done時range from/to／PJ select／中項目テキスト／優先度select／削除×＝グループ1件のみの時は非表示）。
  - カード群の下に「＋ OR条件を追加」ボタン。
  - 別行に 並べ替えselect ＋ 昇順/降順トグル（▲/▼、`sort==='proj'` のとき disabled）／列選択（既存）／件数表示（既存）。
- 中項目テキスト入力には既存の `pwt2-mids` datalist を流用。

## カスタムビュー（`store.saveView`/`applyView`）

- 保存: `{ name, groups, sort, sortDir, columns }`。
- 読み込み時マイグレーション: `v.groups` が無ければ、旧フィールド（`hideDone`,`dueFilter`,`projFilter`）から1グループを構築（`hideDone` → `done.mode='notDone'`、`dueFilter` プリセット→ 対応する `due` 条件へマップ: `all→any`, `none→none(due)`, `has→range(null,null)`, `overdue→range(null,-1)`, `today→range(null,0)`, `next3→range(0,3)`）。既存の保存済みビューはそのまま動作。

## テスト

- 単体（`list.select` 拡張 or 新規）: due range／done range（doneAt基準）／2グループOR（ユーザー例の再現）／sortDir（proj時は無効）／旧ビュー形式のマイグレーション。
- 単体（`store` 拡張）: `updateBody` で done true→doneAt付与、false→doneAt消去、対象外フィールド更新では doneAt不変。
- ブラウザeval: UI操作（グループ追加/削除・期限range入力・完了range入力）→ 一覧の絞り込み結果・並べ替え方向 を確認。

## 非対象

- グループ内でのOR（グループ＝AND固定）。完了日以外の更新日時追跡。コピペでの `doneAt` 引き継ぎ。相対日数のプリセットボタン（今回は数値入力のみ、必要なら追って追加）。
