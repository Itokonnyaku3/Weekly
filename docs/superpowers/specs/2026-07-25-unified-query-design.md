# 共通クエリ化: リスト（表）と検索（アウトライン）の絞り込み統合（設計）

2026-07-25 / 対象: v2（v0.94.0 予定）

## 背景・目的

- リストの条件にキーワード検索が無い。追加したいが、単純に足すと検索ビューとの機能重複がさらに増える。
- 実際に重複しているのは **リスト ⇔ 検索**（デイリーは絞り込み機能を持たず、検索の結果表示がデイリーと同じ
  アウトラインなので「デイリーと重複」に見えていた）。
- 方針: **照合ロジックを1本化し、リストと検索は「表示の仕方」だけを担当する**（採用: 共通クエリ化）。

## 決定事項

| 論点 | 決定 |
|---|---|
| 統合の範囲 | 照合ロジックの共通化。ビューは2つのまま（表＝リスト／アウトライン＝検索） |
| 条件モデル | リストのOR条件グループ形式を上位互換として採用し、各グループに `keyword` を追加 |
| 検索ビューのUI | 現状維持（単一AND・中項目欄なし）。内部的に1グループとして扱う |
| 表⇄アウトライン切替 | 単一グループのときのみ可。複数グループ（OR）は無効＋理由をツールチップ表示 |
| 中項目条件の扱い | 表→アウトラインでは `mid` を落とす（検索バーに欄が無いため）。落ちたらトースト通知 |

## 設計

### 1. 条件モデル（共通）

```
group = { keyword, tags[], proj, mid, due, done, prio }   // グループ内はAND
query = { groups: [group, …] }                            // グループ間はOR（単一 group も可）
```

### 2. `v2/src/query.js`（新規・実装済み）

照合の純ロジックを集約。依存は `props.js`（`cardTags`）のみ＝循環なし。

- `defaultGroup()` / `toGroups(query)`（単一group・`{groups:[…]}` の両方を正規化）
- 個別判定: `keywordMatch` / `tagsMatch` / `projMatch` / `midMatch` / `prioMatch` /
  `dueGroupMatch` / `doneGroupMatch`
- `matchGroup(body, g, today)` … AND。未指定項目は各判定側で「条件なし」として吸収し、
  正規化オブジェクトを毎回作らない（描画ごとに全カード分呼ばれるため）
- `matchQuery(body, query, today, {kinds})` … グループ間OR＋対象kind絞り（表=`['task']` /
  アウトライン=`['memo','task']`）
- 受け渡し: `groupToFlatQuery(g)` → `{query, dropped}`、`flatQueryToGroup(q)`
- `projMatch` は filter 未指定を 'all' 扱いに補正（旧 list 版は undefined で誤判定しうる形だった）

### 3. `list.js`（表）

- `defaultGroup` は query.js のものを使う（`keyword:''` が加わる）。`viewToGroups` の
  `{...defaultGroup(), ...g}` により**旧保存ビューも自動で `keyword:''` 補完**＝後方互換。
- `groupMatch` を `matchGroup` へ委譲。`dueGroupMatch` / `projMatch` は既存テスト互換のため再エクスポート。
- 条件グループカードに**キーワード入力**を追加（`change` で反映＝IME問題を回避、`fkey='g{i}:kw'`）。
- 「🔍 アウトラインで表示」ボタンを条件バーに追加（単一グループ時のみ有効）。

### 4. `search.js`（アウトライン）

- `list.js` からの import（`dueGroupMatch`/`projMatch`）を廃止し query.js を使う
  ＝ search→list の依存が消え、依存方向が一方向に整理される。
- `matchCard(body, query, today)` は kind 判定（memo/task）＋ `matchQuery` へ委譲。**シグネチャ・
  挙動は不変**（既存テスト維持）。
- 「▤ 表で表示」ボタンを追加。

### 5. `app.js`（配線）

- `openAsOutline(groups)`: 単一グループ→`groupToFlatQuery`→`searchState.query` に載せ替え、
  `_savedId=null`、`selectView('search')`。`dropped` に mid があればトースト通知。
- `openAsTable(query)`: `flatQueryToGroup`→`listState.groups=[group]`、`_viewId=null`、`selectView('list')`。
- `renderList(…, onOpenAsOutline)` / `renderSearchView(…, onOpenAsTable)` として callback を追加で渡す。

### 6. スコープ外

- 検索バーへのOR条件UI追加（検索は単一ANDのまま）
- 保存ビュー／保存検索の2ドロップダウン統合（将来 query 形が揃ったので寄せやすくなる）
- デイリービュー本体への絞り込み追加

## テスト・検証

- 新規 `tests/query.test.mjs`: keyword/tags/proj/mid/prio/due/done の各判定、AND合成、
  グループ間OR、`kinds` 絞り、`toGroups` 正規化、`groupToFlatQuery`（mid drop）/`flatQueryToGroup` 往復。
- 新規 `tests/list.keyword.test.mjs`: `selectTasks` のキーワード条件、旧形式ビューの `keyword` 補完。
- 既存31ファイルは互換再エクスポートにより全PASS維持。
- 実機: リストのキーワード絞り込み、検索の従来動作（IME含む）、表⇄アウトライン往復、
  OR時のボタン無効化、mid ドロップ時のトースト、保存ビュー/保存検索の読込。
