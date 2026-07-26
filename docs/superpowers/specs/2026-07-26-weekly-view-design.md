# 週次ビュー: プロジェクト × 週のマトリクス管理（設計）

2026-07-26 / 対象: v2（v0.95.0 予定）

## 背景・目的

- V1（`app.js`）は「縦=プロジェクト / 横=週」のグリッドが中心機能だった。V2はカード/参照モデルで作り直したため
  デイリー・リスト・プロジェクト・検索まで揃ったが、**週次の俯瞰がまだ無い**。
- V1との違い: V1は週セルそのものがデータの置き場（`projects[].entries["週キー"]`）だった。
  V2ではカードの正はデイリー/PJページであり、**週次ビューは既存カードを PJ×週 に振り分ける派生ビュー**にする。
- 目的: 週次報告を書くための俯瞰（その週に何をやる/やった/決めたか）と、プロジェクト横断の串刺し管理。

## 決定事項

| 論点 | 決定 |
|---|---|
| 方式 | **方式A: 派生ビュー**（集約のみ・データ二重化なし）。`store.js` は変更しない |
| セルの編集性 | **ハイブリッド**。既定はコンパクト行（チェック＋インライン編集）、`Alt+↓`/`⤢` で実体アウトライン（`renderChildren`）に展開 |
| セル内の構造 | 1セル内を 🏁マイルストーン / □やること / ✓やったこと / 📝メモ / ↩期限切れ の5ブロックに区切る（週列は増やさない） |
| PJ帰属の判定 | **`body.proj`（PJ割当）**。プロジェクトビューの📌割当カードと同じ判定 |
| 「やったこと」の週 | **`doneAt`（完了した週）**。未完了は所属週、完了は実施週 |
| 期限切れの繰越 | **完了するまで毎週繰り越す**（所属週 < 対象週 ≤ 今週 の各週に出る）。元の週のセルにも残す |
| マイルストーン | `#マイルストーン` タグ。週次ビューからもトグルで付け外し可（本文を書き換える＝持ち方は1本） |
| 週列の範囲 | 先週 〜 今週+4 の**6週**。`Alt+Shift+←/→` で週送り、`Alt+0` で今週へ |
| リンク列 | PJ列の右隣（sticky）。直下の「リンク」ノードの**子**を一覧 |
| 分割表示 | 対象外（幅を使うため）。週次を選ぶと分割は解除する |
| キー操作 | ナビモード（矢印で自由移動）＋ `Enter` で決定。移動計算は純関数化して単体テスト |

## モジュール構成（疎結合）

`query.js` と同じ流儀＝**純ロジックを DOM から切り離し、依存を最小にする**。

| ファイル | 役割 | 依存 |
|---|---|---|
| `v2/src/week.js`（新規） | 週キー計算・PJ×週の集約・カーソル移動。**DOMに触らない純ロジック** | `props.js` のみ |
| `v2/src/weekly.js`（新規） | 週次ビューの描画・イベント | `week.js` / `daily.js` / `clipboard.js` |
| `v2/src/store.js` | **変更なし**（`createCard` は既に `gridWk` を ref に載せられる） | — |
| `v2/src/clipboard.js` | `copyRichText(html, plain)` を追加（週報コピー用・既存の copy 経路には触れない） | — |
| `v2/src/app.js` | ビュー登録（`Alt+4`）／`openProjectAt` 追加／コマンド追加 | — |
| `v2/index.html` | ツールバーのボタンと `#view-weekly` を追加 | — |
| `v2/style.css` | `.wk-*` クラス（既存クラスと衝突しない接頭辞） | — |

既存の `daily.js` / `list.js` / `project.js` / `query.js` / `search.js` の**既存関数は変更しない**（追加のみ）。

## 1. 週キー（`week.js`）

週は**月曜始まり**。週キーは月曜の `YYYY-MM-DD`（V1の `YYYY-M-D` から変更＝文字列比較でソート可能）。

```js
weekStart(dateStr)            // '2026-07-29' → '2026-07-27'（月曜）
weekAdd(wk, n)                // 週キーを n 週ずらす
weekLabel(wk)                 // '7/27〜8/2'
weeksFor(today, offset)       // 表示する6週。既定は [今週-1 … 今週+4]、offset で週送り
```

- 実装は `Date` の UTC 演算を避け、`Date.parse(d+'T00:00:00')` + 日数加算（既存 `query.js` の `dayDiff` と同じ流儀）。
- `WEEK_COUNT = 6`、`WEEK_BACK = 1`（先週を1つ含む）をモジュール定数に。

## 2. カードの所属週（`cardWeekOf`）

```js
cardWeekOf(body, ref, dayDate)   // → 週キー
```

優先順位:

1. `ref.gridWk` … 明示上書き（週次ビューでのドラッグ移動・セルからの追加で付く）
2. `body.due` の週 … 「期限があればその期限のある週」
3. `dayDate`（出所の `kind:'day'` 祖先の日付）の週 … 「なければ書き込まれた週」
4. `body.createdAt` の週 … 安全網（出所日が取れないカード）

## 3. 集約（`buildWeeklyGrid`）

```js
buildWeeklyGrid(store, { weeks, today, msTag='マイルストーン', hideEmpty=false })
→ {
  weeks: [{ wk, label, isCurrent }],
  rows: [{
    projId,                       // null = 未割当行
    proj,                         // project の body（未割当行は null）
    kids:  [{ ref, body }],       // PJ直下ノード（「リンク」ノードは除く）
    links: [{ ref, body }],       // 「リンク」ノードの子
    cells: { [wk]: { ms:[], todo:[], done:[], memo:[], over:[] } },
    total,                        // 表示範囲内の件数（hideEmpty 判定用・over は数えない）
  }],
}
entry = { ref, body, day, wk }    // day=出所日 / wk=所属週
```

### 収集対象

`body.proj` が設定され `kind !== 'project'` のカードのうち、次を**除外**（`project.js` の
`collectMirrorRoots` と同じ判定を全PJ1パスに一般化）:

- そのPJのノートページ内にあるカード（PJ列の直下ノードとして既に見えているため）
- 同じPJが割り当たった祖先を持つカード（＝最上位だけ拾い、子は展開時に見せる）

### 1パスの索引（性能）

描画ごとに全カードを走査するため、祖先walkはメモ化して O(N) に保つ:

- `topInfo(refId)` → `{ rootRefId, dayDate }`（ルートまで1回だけ辿りメモ）
- `ancProjs(refId)` → 祖先の `proj` 値の Set（`ancProjs(parent) ∪ {parentBody.proj}` で再帰＋メモ）
- PJページのルート ref は `refsForBody(projId).find(parentRefId===null)` を先に集めて Set 化

### ブロック分類

| ブロック | 条件 | 週の基準 | 並び順 |
|---|---|---|---|
| `ms` 🏁 | 本文に `#マイルストーン` | 所属週（完了していても `ms` に残す） | 期限/出所日 昇順 |
| `todo` □ | `kind==='task'` かつ未完了・非マイルストーン | 所属週 | 優先度降順 → 期限昇順（無しは後）→ 出所日昇順 |
| `done` ✓ | `kind==='task'` かつ完了・非マイルストーン | **`doneAt` の週**（無ければ所属週） | `doneAt` 昇順（やった順） |
| `memo` 📝 | `kind!=='task'`（memo/table/image） | 所属週 | 出所日昇順 |
| `over` ↩ | `kind==='task'` かつ未完了・非マイルストーン かつ 所属週 < 対象週 ≤ 今週 | 対象週すべてに複製表示 | 所属週昇順 → 優先度降順 |

- マイルストーンは**繰越の対象にしない**（日付そのものが意味を持つため勝手に翌週へ動かさない）。
- 未来週（今週より後）には `over` を出さない。

### 未割当行

行の最下段に固定。V1準拠で**PJ未割当の未完了タスクのみ**:

- `!body.proj && kind==='task' && !done`
- かつ `proj` を持つ祖先が無い（割当済みタスクのサブタスクを拾わない）
- かつ PJページ内でない

## 4. 表の構造（`weekly.js`）

```
┌──────────────┬──────────┬──────────┬──────────┬ …（横スクロール）
│ プロジェクト  │ リンク    │ 7/20〜   │ 7/27〜   │  ← thead sticky top
│  (sticky左)  │ (sticky)  │          │ 今週      │
├──────────────┼──────────┼──────────┼──────────┤
│ 📕PJ.HACCP ▲▼│- 運用開始 │🏁 …      │          │
│ ・全体状況     │- SP外部社 │□ やること │          │
│ ・その他       │- 20.HACCP│✓ やった   │          │
│ ・標準温度…    │          │📝 メモ    │          │
│               │          │↩ 期限切れ │          │
```

- 列幅は固定（PJ 200px / リンク 160px / 週 220px）。`.wk-scroll` が横スクロール。
- sticky: `thead th`（top）、`.wk-c-proj`（left:0）、`.wk-c-link`（left:200px）。交差セルは `z-index` を上げる。
- 今週列は `.wk-current` で背景を淡く強調。
- **PJ列**: タイトル＝PJページへのリンク、`▲▼` で `store.moveProject`（並び順はPJ一覧準拠＝`listProjects()` の順）。
  その下に直下ノードを箇条書き（「リンク」ノードは除外）。
- **リンク列**: 直下の「リンク」ノードの子。`body.url` があれば別タブ、無ければそのノードへジャンプ。

## 5. セルの表示（ハイブリッド）

### コンパクト行（既定）

週次専用の軽量レンダラ。1件1行で以下を持つ:

- チェックボックス（task のみ）／ドット（memo）
- テキスト（`div` は既定 `contenteditable=false`。`Enter` で編集モードへ）
- 子件数バッジ（`n`）・優先度・期限の小バッジ
- 🏁 トグル・`↗`（元の場所へジャンプ）

### 展開（`Alt+↓` / `⤢`）

そのセルだけ `daily.js` の `renderChildren(store, null, el, 0, requestRender, { refs, mirrorRoot:true })`
に差し替え、子・折りたたみ・⋯メニュー・D&Dをそのまま使う。

- **同時に展開できるのは1セルだけ**（＝ズーム相当）。`Escape` で畳んでナビモードへ。
- 展開時は `setNavContainer(mount, requestRender)` を呼ぶ（v0.93.0 の教訓＝別ビューのコンテナを掴む不具合の再発防止）。

### 重要な制約: 同一 ref の DOM 重複を作らない

繰越（`over`）は同じ `ref` が「元の週」と「繰越先の週」に出るため、`data-ref` が2つになると
`focusCard`（`querySelector` で先頭1つを取る）が誤爆する。したがって:

- **`over` の行は常に参照行**として描く。`data-ref` を付けず `data-over-ref` を使う。
- 参照行でできるのは**完了チェック**と**元の週へ `↗`** のみ（編集・展開は不可）。

## 6. キーボード操作

### ナビモード（既定）

セル内の各アイテムを `tabIndex=-1` のフォーカス可能行にする（既存の `.proj-land-row` / `.day-head` と同じ流儀）。

| キー | 挙動 |
|---|---|
| `↑` `↓` | 列内を縦に連続移動。セル最下段で `↓` → 同じ週の**次のPJのセル先頭**、最上段で `↑` → 前のPJのセル**末尾** |
| `←` `→` | 行内を横に移動。列並びは `PJ列 → リンク列 → 週1 … 週6`。移動先では縦位置を保つ（無ければ末尾） |
| 右端で `→` / 左端で `←` | **週送り**して、新しく現れた週列の同じ行へ（左右対称） |
| `Tab` / `Shift+Tab` | セル単位で送る（行末で次のPJの先頭セルへ） |
| `Home` / `End` | 行の先頭列 / 末尾列 |
| `Enter` | 決定。タスク/メモ→編集開始／PJタイトル→PJページ／直下ノード→そのノードにズームして開く／リンク→URL／空セル→新規追加 |
| `Space` / `Ctrl+Enter` | 完了トグル |
| `Alt+M` | 🏁 マイルストーンのトグル |
| `Ctrl+Shift+←` `→` | そのカードの週を移動（前倒し / ⏩翌週へ延期） |
| `Alt+Shift+←` `→` / `Alt+0` | 週送り / 今週へ |
| `Alt+↓` | セルを展開 |
| `Alt+4` | 週次ビューを開く（グローバル） |

### 編集モード

`Enter` で `contentEditable=true` にしてキャレットを置く。`daily.js` と同じ流儀:

- `Enter` … 確定して**同じブロックに次の行を作り編集を継続**（＝新規追加はこれで完結）
- `Escape` … ナビモードへ復帰
- 入力は `input` イベントで `updateBody(id, {content})`（既存と同じ）

### カーソルとフォーカス復帰

- `_cursor = { row, colIdx, idx }` をモジュール内に保持。**矢印キーでは再描画せず DOM フォーカスだけ移動**（軽快さの維持）。
- データ変更時のみ `requestRender()` → 描画後に `applyCursor()` で復帰。行/列が消えていた場合は近傍にクランプ。
- 移動計算は純関数:

```js
// shape = { rows:[rowId…], cols:[colId…], counts: Map('rowId|colId' → スロット数) }
// 空セルもスロット1（セル自体にフォーカス）＝どの (row,col) も必ず 1 以上
moveCursor(shape, cursor, key) → { cursor, page }   // page: -1 | 0 | +1（週送り要求）
```

`cols` は `['proj','link', …週キー]`。週送り時は `colIdx` を端に固定したまま `weeks` を作り直すので、
**新しく現れた週列にフォーカスが乗る**（左端は `colIdx=2`＝最初の週列、右端は `cols.length-1`）。

## 7. 操作（マウス）

| 操作 | 挙動 |
|---|---|
| セルの `＋` | ブロック種別に応じて作成: やること→`task` / やったこと→`task`+`done` / メモ→`memo`。**今日の day カード直下**に作り `proj` を割当。そのセルが今週以外なら `gridWk` を設定 |
| 別セルへドラッグ | 同PJの別週＝週の付け替え（`due` があれば移動先週の同曜日へ `due` を更新、無ければ `gridWk`）／別PJ行＝`proj` を変更 |
| 行の `⏩` | 上と同じロジックで +1週（延期） |
| `📋 週報コピー` | 表示中の週のうち**今週（範囲外なら先頭週）**の全PJを HTML＋テキストでコピー |
| `空PJを隠す` | 表示範囲に `total===0` のPJ行を隠す |

### 週報コピーの出力

`clipboard.js` に `copyRichText(html, plain)` を追加（`navigator.clipboard.write` + `ClipboardItem`、
失敗時は `document.execCommand('copy')` にフォールバック）。出力は PJ ごとの見出し＋ブロック別の箇条書き:

```
■ PJ.HACCP
  【マイルストーン】🏁 運用開始
  【やったこと】・SP外部社と打合せ
  【やること】・標準温度の確認
  【メモ】・議事録: …
  【期限切れ】・見積依頼（7/13週）
```

## 8. 状態

`weeklyState = { wkOff: 0, hideEmpty: false, expanded: null }`（`expanded` は `'projId|wk'` か `null`）。

- `wkOff` / `hideEmpty` は `localStorage`（`pwt2_wkOff` / `pwt2_wkHideEmpty`）。
- **undo履歴・GitHub同期には乗せない**（UI設定＝v0.92.0 のクイックビュー割当と同じ方針）。
- `expanded` はセッション内のみ。

## 9. 既存機能との相互作用

- **完了非表示（`Alt+H`）**: 「やったこと」ブロックには**適用しない**（完了専用ブロックなので常に空になってしまう）。
  他のブロック（やること/メモ/期限切れ）には適用する。
- **分割表示**: 週次ビューを選ぶと `splitOn=false` にする（幅を使うため）。
- **ナビ履歴（`Alt+←/→`）**: `navSnapshot` に `wkOff` を含め、週送りも戻れるようにする。
- **`store.js` は変更しない**。`gridWk` は `createCard` が既に ref へ載せられるので、`updateRef(ref,{gridWk})` で足りる。

## 10. テスト（`week.js` の純ロジック）

| ファイル | 内容 |
|---|---|
| `tests/week.key.test.mjs` | `weekStart`（月曜始まり・年越し・月末）/ `weekAdd` / `weekLabel` / `weeksFor` |
| `tests/week.cardweek.test.mjs` | `cardWeekOf` の優先順位（`gridWk` > `due` > 出所日 > `createdAt`） |
| `tests/week.grid.test.mjs` | 収集の除外（PJページ内・同PJ祖先・別PJ）／5ブロックの分類／`done` が `doneAt` 週に入る／未割当行 |
| `tests/week.over.test.mjs` | 繰越が所属週+1〜今週の各週に出る／完了すると消える／マイルストーンは繰越しない／未来週には出ない |
| `tests/week.cursor.test.mjs` | `moveCursor` の縦連続移動・行またぎ・横移動・端での週送り要求・クランプ |

## 実装順（各段で単体テスト＋実機確認＋commit/push）

1. `week.js` 純ロジック＋テスト5本
2. `weekly.js` 骨格: 表・PJ列・リンク列・コンパクトセル（読み取り）＋`index.html`/`app.js`/`style.css` 登録（`Alt+4`）
3. キー操作（ナビモード・カーソル・`Enter` 決定・編集モード）
4. 編集系（チェック／インライン編集／`＋`追加／🏁トグル）
5. 繰越（参照行）・マイルストーン帯・未割当行
6. セル展開（`renderChildren`＋`setNavContainer`）
7. 週送り／D&D／⏩延期／空PJ隠し／PJ▲▼並べ替え／ナビ履歴
8. 週報コピー（`copyRichText`）

## 非スコープ（将来）

- セル内の任意並べ替え（方式C: `body.wkOrder` を持つ）
- 表示週数の可変（4/6/8/12）
- マイルストーンのガントバー表示（V1のスパンバー相当）
- 週次ビューの印刷レイアウト
