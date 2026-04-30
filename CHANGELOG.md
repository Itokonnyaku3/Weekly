# 変更履歴 (CHANGELOG)

このプロジェクトのバージョンごとの変更点を記録します。バージョンは `app.js` の `APP_VERSION` 定数と一致します。

形式: `vX.Y.Z-MMDDHHMM`（X=メジャー, Y=機能追加, Z=修正/微調整）

---

## v1.0.3-04300047 (2026-04-30)
### 追加
- スパンバー（`.span-inline-bar`）に編集アイコン✏を追加（案②採用）。
  - バー右端の✏をクリック → `openPanel(pi, originWk, sn.id)` でそのスパンノードの詳細パネルが開く。
  - `originWk` は `sn.date || sn.startDate` から `wkey()` で算出。
  - バー本体は従来通り `event.stopPropagation()` のみで誤爆防止。
- `style.css` に `.span-bar-text` / `.span-bar-edit` / `.span-bar-edit:hover` を追加。

### 経緯
- ユーザー指摘: 「複数週にまたがるスパンノードはバー（装飾）とカード（実体）の二重存在で、バーをクリックしても編集できず不便」
- 検討した3案のうち、リスク最小の案②（編集アイコン追加）を採用。
- 将来的には案③（colspan で本物のセル化＝Phase 4 構想）へ進化予定。

---

## v1.0.2-04251135 (2026-04-25)
### 削除
- スパンバーのオーバーレイ描画（`renderSpanBars()` の `.span-overlay-layer`）を廃止。
  - 関数本体は早期 return の no-op 化（既存オーバーレイ層が残っていれば除去のみ実施）。
  - 旧コードはコメント `eslint-disable-next-line no-unreachable` の下に残置。

### 経緯
- インライン描画とオーバーレイの二重描画で「同名スパンが色違いの2本に見える」問題が発生。
- ユーザー判断: オーバーレイは廃止し、インライン描画に一本化。

---

## v1.0.1-04251059 (2026-04-25)
### 追加
- `computeSpanLanesForProject(pi)`: プロジェクト内のスパンを `node.text` 単位でレーン番号に割り当てる関数を追加。
- 同名スパンは常に同じレーン（W4/20の出張メモ と W4/27の出張メモ が縦位置揃う）。
- 欠けレーンには `visibility:hidden` のプレースホルダを置いて全列でバー位置を維持。
- バー色も `laneIdx` ベースで安定（同名スパンは常に同色）。

### 経緯
- ユーザー指摘: 「複数のスパンに分かれている大項目」のレーン位置がズレる。
- 提案した3案（A: 名前束ね / B: 週横断レーン割当 / C: rowspan化）のうち案A採用。

---

## v1.0.0-04241534 (2026-04-24)
### Phase 3 完了
- ダークモード配色刷新（#1c1e22 ウォームスレート）
- 週マタギ スパンバー `renderSpanBars()` 実装（オーバーレイ方式）
- ショートカット追加（Alt+0〜3, Alt+D）
- ノートビューを `olRender` に統一（月/年/全ノート）
- `_mv` バーチャルノード方式
- 全ビューで ↑/↓・Ctrl+↑/↓・Enter・Alt+T 統一
- プロジェクトノートも全ノートビューに表示

---

## Phase 2 (v0.9.7)
- `getAllNodes()` / `ensureNodeDates()` 統合データ層
- WorkFlowyツリービュー（🌳ボタン）

## Phase 1 (v0.9.6)
- File System Access API（IndexedDB でハンドル永続化）
- Node に `startDate` / `endDate` フィールド追加

## Phase 0 (v0.9.5)
- ファイル分割: HTML(491行) + style.css + app.js
- マスコット削除、旧 entries 除去

---

## メンテナンス・ルール
- バージョン更新時は必ず `app.js` の `APP_VERSION` も更新する。
- 大きな変更（>5000行のEdit）の後は必ず `wc -l` + `tail` + `node --check` で末尾欠損を検証する。
- バックアップは `BKP/` 配下に `<filename>.bak3_YYYYMMDD_HHMMSS_<reason>` 形式で残す（最低3世代）。
- コミットは `push.bat` をダブルクリックで実行。
