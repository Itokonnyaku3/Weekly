# アウトライン構造操作のスコープ保証（設計）

- 日付: 2026-09-06
- 対象: `v2/src/daily.js`（＋新規 `v2/src/outline-ops.js`）
- 状態: 承認済み

## 背景

Weekly v2 と Excel タスクリストのどちらを主に使うかを検討した結果、**タスクの正データは Weekly v2 に一本化する**方針を確定した。ただしその前提として、v2 で「書いている最中にカードが画面から消える」不具合を解消する必要がある。

利用実態の調査で分かったこと:

- v2 のデータ（`v2/tracker.json`, 2026-07-31 時点）には本体 1286 件（メモ 960 / タスク 208 / 画像 47 / 日 45 / プロジェクト 17 / 表 9）が入っており、6〜7 月に実運用されていた。
- 8 月以降は Excel（`★タスクリスト10.xlsm`）に運用が戻っている。
- 戻った理由は機能不足ではなく、**編集操作の信頼性**。「フォーカス（ズーム）中にアウトデントするとカードが見えなくなる」等の細かい破綻が、書き始めるのを妨げていた。

本仕様はこのうち **編集操作の信頼性** のみを扱う。到達性（無タグのメモ 740 件・画像 47 件が一覧にも検索にも出ない問題）は後続の別仕様とする。

## 検出済みの不具合

### クラスA: 可視範囲の外へ出て消える

| ID | 再現手順 | 箇所 |
|---|---|---|
| A1 | ズーム中、ルート直下のカードで `Shift+Tab` | `daily.js:1021` |
| A2 | 同上を画像／表ブロックで（ルート自身のガードも無い） | `daily.js:1276` |
| A3 | ズームのタイトル行で `Enter`。行の途中ならタイトル前半が範囲外へ移動する | `daily.js:985` |

いずれも、移動先の `parentRefId` がズームのルート（`_ctx.rootRef`）の外側になり、`renderChildren(rootRef)` の描画対象から外れる。

### クラスB: 意図しない境界を越える

| ID | 再現手順 | 箇所 |
|---|---|---|
| B1 | 全日表示で、ある日の先頭カードの行頭 `Backspace` → 前の日の最終カードに結合される | `daily.js:1044` |
| B2 | ズームのタイトル行で `Ctrl+Shift+Backspace` → 開いているページごと削除される | `daily.js:1037` |
| B3 | ズームのルート直下・先頭カードの行頭 `Backspace` → 本文がズームタイトルに吸い込まれる | `daily.js:1044` |

`visibleFlat()` はズーム時に `rootRef` 自身を先頭に含み（`daily.js:1534`）、全日表示では日をまたいで連結されるため、`flat[idx-1]` が境界外を指す。

### クラスC: 構造的原因

| ID | 内容 |
|---|---|
| C1 | インデント／アウトデントのロジックが `daily.js:1015` と `daily.js:1272` に重複。ガードが前者にしか無い（A2 の直接原因） |
| C2 | ズームのタイトルにカード用キーハンドラ `onKey` を丸ごと接続している（`daily.js:815`）。構造変更キーが全て有効（A3・B2 の直接原因） |

C1・C2 を残したまま個別修正すると、ビューを追加するたびに同種の不具合が再発する。

## 設計

### 方針

個別パッチではなく、**境界の判定を 1 箇所に集約して保証する**。

### 1. `v2/src/outline-ops.js`（新規）

構造操作を純関数として集約し、C1 の重複を解消する。テキストカードとブロック（画像／表）が同一の関数を呼ぶ。

```
indent(store, refId, scope)        → bool  適用したか
outdent(store, refId, scope)       → bool
splitCard(store, refId, pos, text, scope)  → { newRefId, focusRefId, focusPos } | null
mergeCard(store, refId, targetRefId, scope) → { focusRefId, focusPos } | null
moveSibling(store, refId, dir, scope)      → bool
deleteCard(store, refId, scope)            → bool
```

いずれも DOM に触れない。呼び出し側（`daily.js`）が `requestRender()` と `focusCard()` を行う。

### 2. スコープの定義

```
scope = { rootRef: string }   // ズーム／プロジェクトページ
scope = { rootRef: null }     // 全日表示（境界は day）
```

判定はこの 1 関数に集約する。**各操作が個別に境界を判断してはならない。**

```
wouldEscape(store, refId, newParentRefId, scope) → bool
```

- `scope.rootRef` が非 null: 移動後に `refId` が `rootRef` の**厳密な子孫**でなくなるなら `true`。
  `rootRef` 自身への移動も `true`（B3 を防ぐ）。
- `scope.rootRef` が null: `refId` の day 祖先と `newParentRefId` の day 祖先が異なるなら `true`。
  `newParentRefId` が day 直下から外れる場合も `true`。

各操作は `wouldEscape` が `true` を返したら **no-op（false / null を返す）**。エラーも警告も出さず、単に何も起きない。

さらに `refId === scope.rootRef` の場合、`indent` / `outdent` / `moveSibling` / `deleteCard` / `splitCard` は常に no-op とする。

これで A1・A2・B1・B3 が塞がり、A3・B2 も ops 層で二重に塞がれる。

### 3. ズームタイトル専用ハンドラ（C2 の解消）

`renderOutlinePage`（`daily.js:815`）が `onKey` を直接接続している箇所を、`onTitleKey` に差し替える。

`onTitleKey` は構造変更キーを `preventDefault()` して破棄し、それ以外を `onKey` に委譲する。

**タイトルで有効（ホワイトリスト）**

- 通常の文字入力（`input` リスナで本文へ保存）
- `Alt+↑` — ズームを出る
- `Ctrl+/` — 日付挿入
- `@` — メンション挿入
- `#` — タグ挿入
- `↑` `↓` — タイトルと子カードの間を移動
- `←` `→` — メンションチップの前後移動
- `Esc` — メニューを閉じる

**タイトルで無効化（今回外すもの）**

`Enter`（全修飾を含む）／`Tab`・`Shift+Tab`／`Backspace`（行頭結合）／`Ctrl+Shift+Backspace`（削除）／`Alt+Shift+↑↓`（並べ替え）／`Ctrl+↑↓`（カスケード開閉）／`Delete`（選択削除）／`Ctrl+Enter`（メモ⇄タスク切替）

`Ctrl+Enter` については、プロジェクトページのタイトルは `kind: 'project'` の本体であり、タスク化されると破綻するため無効が正しい。

利用者が無意識に使っていた操作が後から判明する可能性があるため、**ホワイトリストは 1 箇所の配列で定義し、追加が 1 行で済む形にする**。

### 4. 防御の二層構造

| 層 | 役割 |
|---|---|
| `outline-ops.js` の `wouldEscape` | 権威。ここを通らない構造変更は存在しない |
| `onTitleKey` のホワイトリスト | UI の明確さ。タイトルで無意味な操作を見せない |

層 2 が将来漏れても層 1 が守る。

### 5. 回帰テスト

`v2/tests/outline.ops.test.mjs` を追加。既存のテスト群と同じ `node --test` 方式、DOM 非依存。

検証コマンド:

```
node --test "tests/*.test.mjs"
```

ベースライン: 2026-09-06 時点で 43 tests / 43 pass。

最低限のケース:

- A1 ズームのルート直下で `outdent` → no-op、親が変わらない
- A2 ブロックでも同じ結果になる（テキストと同一関数を呼ぶ）
- A3 `refId === rootRef` の `splitCard` → null
- B1 day をまたぐ `mergeCard` → null
- B2 `refId === rootRef` の `deleteCard` → no-op
- B3 `mergeCard` の対象が `rootRef` → null
- 正常系: ズーム内の 2 階層目以降での `indent` / `outdent` は従来どおり動く（デグレ検出）

## 実装の段取り

デグレ回避のため、挙動を変える変更と構造を変える変更を混ぜない。各段でテストを green にしてから commit / push する。

1. `outline-ops.js` を新規作成。**現行の挙動そのまま**の純関数として実装し、テストで現行挙動を固定する（この時点では誰も呼ばない）
2. `daily.js` の 2 箇所（テキスト `1015` / ブロック `1272`）を `outline-ops` 呼び出しに差し替え。既存 43 テスト green を確認（C1 解消・挙動不変）
3. `wouldEscape` とスコープ判定を追加し、A1・A2・B1・B3 の回帰テストを追加（挙動が変わる段）
4. `onTitleKey` を追加して `daily.js:815` を差し替え（C2 解消・A3・B2 の UI 層）
5. 実機で手動確認（ズーム／プロジェクトページ／分割ペインの 3 文脈 × 上記キー）

## スコープ外

以下は実在するが、今回の症状の原因ではないため本仕様に含めない。バックログへ回す。

- `beforeunload` / `pagehide` での保存フラッシュが無い（`persist.js:22` の 400ms デバウンス中にタブを閉じると直前の入力が失われる）
- 保存失敗が `console.error` のみで画面に出ない（`persist.js:19`）
- 到達性の問題: メモの 77%・画像の 100% が無タグ。リストは `kind === 'task'` のみ（`list.js:297`）、検索は memo と task のみ（`search.js:11`）で、画像 47 件は日ツリーを辿る以外に到達手段が無い

到達性は本件の完了後に別仕様として扱う。「タグごとの俯瞰ビュー（Obsidian Canvas 相当）」の検討は、到達性が解決した後とする。拾えるデータが無い状態で俯瞰 UI を作っても空になるため。
