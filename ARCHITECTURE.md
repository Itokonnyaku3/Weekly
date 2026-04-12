# WeeklyTracker アーキテクチャ仕様書

> 作成: 2026-04-12  
> 目的: 改修時のデグレ防止・設計判断の根拠として参照するドキュメント

---

## 1. データ全体像

### 1-1. ストレージ構造

```
localStorage["pwt_v5"] = JSON.stringify(S)

S = {
  projects: Project[],      // プロジェクト一覧
  dailyOutline: {           // 全ノードのストア
    "YYYY-M-D": Node[],     // 日付キー（月・日は1始まり、例: "2026-4-7"）
    "proj:0": Node[],       // プロジェクト固有ノート（pi=0）
    "proj:1": Node[],       // プロジェクト固有ノート（pi=1）
    ...
  },
  wOff: number,             // 週表示オフセット（0=今週, -1=先週, +1=来週）
  ...
}
```

---

## 2. ノード（Node）のデータ構造

ノードは `S.dailyOutline[dateKey]` の配列要素。1ノード = 1つの「行」。

```typescript
interface Node {
  // 必須
  id: string;           // ユニークID（olNewId()で生成）
  text: string;         // テキスト本文
  indent: number;       // インデント深度（0が最上位）

  // 表示制御
  bold: boolean;
  color: string;        // カラーコード or ''
  collapsed: boolean;   // アウトライン折りたたみ状態

  // タスク属性
  isTodo: boolean;      // ToDoノードかどうか
  checked: boolean;     // 完了フラグ
  priority: string;     // 'high' | 'mid' | 'low' | ''
  start: string;        // 開始日 (YYYY-MM-DD or '') ★現在グリッド表示には使用されていない
  due: string;          // 期限日 (YYYY-MM-DD or '') ★ミラー表示の条件に使用

  // 分類・紐づけ
  projTag: string;      // プロジェクト帰属キー（プロジェクト名の空白を'_'に変換）
  tags: string[];       // 汎用タグ配列
  type: string;         // 'todo' | 'log' | 'link' | ...

  // リンク
  url: string;
  parentId?: string;    // 親ノードのID（サブタスク用）

  // その他
  note: string;         // 長文メモ
  images: string[];     // GitHub画像URL配列
  isPrivate: boolean;
  gridCollapsed?: boolean; // グリッドセル内での親ノード折りたたみ

  // ★複数週span用フィールドは現在存在しない（未実装）
  // endDate?: string;   // 未来の拡張候補
}
```

### ⚠️ 重要な制約
- **1ノードは必ず1つの日付キーに属する**
- 日付キーは「そのノードが最初に作られた日（または週の月曜日）」
- 週をまたぐ概念はデータ上に存在しない

---

## 3. 週キー（wkey）の仕組み

### 3-1. 関数一覧（~4410行付近）

```javascript
wkey(d: Date): string
// 引数の日付が属する週の月曜日を "YYYY-M-D" 形式で返す
// 例: new Date("2026-04-09") → "2026-4-6" （月曜日）

wkeyToDate(k: string): Date
// wkey文字列をDateオブジェクトに変換（= その週の月曜日）

wkeyNext(k: string): string
// 次週のwkeyを返す（7日加算）

wkeyLabel(k: string): string
// 表示用ラベル "M/D〜M/D" を返す

getWeeks(): Date[]
// S.wOff を基点に WEEKS(=6)週分の月曜日Date配列を返す
```

### 3-2. wOff（週オフセット）

```
S.wOff = 0   → 今週基点で6週間表示（今週〜5週後）
S.wOff = -1  → 先週基点で6週間表示
S.wOff = 1   → 来週基点で6週間表示
```

### 3-3. 日付キーとwkeyの関係

```
dailyOutline の日付キー: "YYYY-M-D"（その日そのもの）
wkey: "YYYY-M-D"（その週の月曜日）

例: ノードが "2026-4-9"（木曜）に保存されている場合
  → wkey(new Date("2026-4-9")) = "2026-4-6"（月曜）
  → W "2026-4-6" のセルに表示される
```

---

## 4. グリッドの描画ロジック

### 4-1. HTML構造

```html
<table>
  <colgroup>
    <col id="gc-proj">           <!-- プロジェクト名列（固定幅） -->
    <col id="gc-wk-{wkey}">     <!-- 週列 × WEEKS(6) -->
  </colgroup>
  <thead>
    <th>プロジェクト</th>
    <th>W {wkeyLabel}</th>      <!-- 週ヘッダ × 6 -->
  </thead>
  <tbody id="gb">
    <!-- プロジェクト行 × プロジェクト数 -->
  </tbody>
</table>
```

**現在の構造上の制約**: `colspan` は「プロジェクト追加」行のみに使用。
タスクセルは1セル = 1週に固定。

### 4-2. render() の全体フロー

```
render()
  ↓
getWeeks()  → 表示対象6週間のDate[]
  ↓
プロジェクト(pi)ループ
  ↓ 各週(wk)ループ
  getGridItems(pi, wk)        → その週・そのプロジェクトのノード一覧
  getTreeOrderedItems(pi, wk) → 親子ツリー順に整列
  [今週のみ] getMirrorItems(pi, wk) → 過去週の継続中アイテムを追加
  renderEntry(node, ...)      → 各ノードのHTML生成
```

### 4-3. getGridItems(pi, wk) の判定ロジック（~7879行）

```javascript
// ノードが特定の週(wk)に属するかの判定
for (const date in S.dailyOutline) {
  const dateWk = wkey(new Date(date));  // 日付→週変換
  if (dateWk !== wk) continue;          // 週が不一致なら除外
  nodes.filter(n => n.projTag === projTag) // プロジェクトが一致するノードのみ
}
```

**= 「1ノードが入るセルは dateキー が属する週のセルだけ」**

---

## 5. エントリ追加時のノード生成フロー

### 5-1. グリッドからクイック追加（quickAdd）

```
ユーザーがグリッドセルに入力
  ↓
quickAdd(pi, wk, text)
  ↓ 保存先の決定
  今週(wk === 今週) → targetDate = 今日 (todayDateStr())
  今週以外          → targetDate = その週の月曜日 (wkeyToDate(wk))
  ↓
S.dailyOutline[targetDate].push({ ...新ノード, projTag })
  ↓
saveState() → render()
```

### 5-2. パネルから追加・編集（savePanel）

```
savePanel(pi, ei, wk)
  ↓ 入力値をノードに反映
  新規: olGetNodes(targetDate).push(newNode)
  編集: findNodeById(ei) → Object.assign(node, 更新値)
  ↓
saveState() → render()
```

### 5-3. デイリーノート側からの追加

```
ノートで projTag 付きノードを作成/編集
  ↓
saveState()
  ↓
render() ← 同一の S.dailyOutline を参照するため自動同期
```

---

## 6. ミラーアイテム機構（複数週表示の現在形）

今週のセルにのみ適用される「継続中アイテムの再表示」機能。

### 6-1. 表示条件（getMirrorItems, ~7936行）

過去週のノードのうち以下をミラー表示：
- `isTodo === true` かつ `checked === false`（未完了ToDoノード）
- `isTodo !== true` かつ `due` が空でない（期限付き非Todoノード）

### 6-2. 表示上の扱い

- 元データは過去週の dailyOutline に残ったまま
- 今週セルに `data-origin-wk` 付きで重複描画
- 「↩ 継続中」区切り線の下に表示
- ドラッグで今週に移動可能（元データのdateキーが更新される）

---

## 7. 「複数週スパン表示」の実装設計案

### 7-1. 現状の問題

```
現在: Node は 1日付 に紐づく → 1週のセルにしか表示されない
要望: 開始週〜終了週にまたがるバー表示
```

### 7-2. 実装アプローチ比較

| アプローチ | 概要 | メリット | デメリット |
|-----------|------|---------|-----------|
| **A. colspan方式** | `<td colspan="N">` で複数週セルを結合 | 本物のスパン | table構造の全面見直しが必要。既存の行レイアウト（各プロジェクトが可変高）と相性が悪い |
| **B. オーバーレイ方式** | テーブルの上に `position:absolute` のバーをCSSで描画 | table構造変更なし | グリッドスクロール追従が難しい。列幅変更時に再計算が必要 |
| **C. 複数セルに同一ノードを表示** | getGridItems() を拡張し、startDate〜endDateの範囲に含まれる週全てにノードを表示 | 実装量が最小 | 複数セルに同じノードが表示され、編集UIが冗長になる |

### 7-3. 推奨アプローチ: B（オーバーレイ）+ C（範囲表示）のハイブリッド

**データ側の変更（最小限）**:
```javascript
// Node に endDate フィールドを追加
interface Node {
  // ... 既存フィールド ...
  endDate?: string;  // スパン終了日 (YYYY-MM-DD)。未設定=単一週
}
```

**表示ロジックの変更**:
```
getGridItems(pi, wk) の条件を変更:
  従来: dateWk === wk
  変更後: dateWk === wk  OR
          (node.endDate が存在 かつ wk が dateWk〜endDateWk の範囲内)
```

**描画の変更**:
- スパンノードを通常セルに表示する際、最初の週は通常描画
- 続く週では「継続バー」として視覚的に区別（点線枠 or 薄い背景）
- 最終週に「終端」マーカー

**UI/操作の変更**:
- savePanel に「終了週」フィールドを追加
- 最初の週のセルのみ編集可能（続く週は「継続中」表示のみ）

### 7-4. 既存コードへの影響範囲

| 変更箇所 | 変更内容 | リスク |
|---------|---------|--------|
| `Node` 型 | `endDate` フィールド追加 | 低（後方互換あり） |
| `getGridItems()` | 範囲チェック追加 | 中（ミラー機構との干渉に注意） |
| `renderEntry()` | スパンノードの見た目分岐 | 中 |
| `savePanel` UI | 終了週入力フィールド追加 | 低 |
| `getMirrorItems()` | スパンノードを除外する条件追加 | 中（二重表示防止） |
| データ移行 | 既存ノードは `endDate` 未設定 → 動作変わらず | 低 |

---

## 8. 今後の設計上の注意点

1. **日付キー形式の一貫性**  
   `dailyOutline` のキーは `"YYYY-M-D"`（月・日は1始まり、ゼロ埋めなし）。
   `new Date()` の `toISOString()` 等で生成すると形式が異なりバグになる。
   必ず `todayDateStr()` や `wkeyToDate()` を経由すること。

2. **wkey と dailyOutline キーは別物**  
   `wkey` = 「週の月曜日を示す文字列」  
   `dailyOutline` のキー = 「ノードが保存された日（月曜とは限らない）」  
   getGridItems() 内で毎回 `wkey(new Date(date))` で変換している。

3. **projTag の生成ルール**  
   `S.projects[pi].name.replace(/\s+/g, '_')`  
   プロジェクト名を変更すると既存ノードの projTag が壊れる。名前変更時は一括バッチが必要。

4. **ミラーアイテムは今週専用**  
   `getMirrorItems()` は今週セルにのみ追加される。  
   スパン機能を実装する際、ミラーとの二重表示が発生しないよう注意。

5. **repeat機能は削除済み**  
   旧バージョンの `recurringEntries` は現在 `[]` に移行済み。  
   繰り返しタスクの再実装が必要な場合は一から設計すること。
