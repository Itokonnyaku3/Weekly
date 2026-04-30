# 引継ぎメモ (HANDOVER)

このファイルは AI（Claude）が別チャットや別セッションで作業を継続するための引継ぎ情報です。
作業を再開するときは、まずこのファイルと `CHANGELOG.md`・`PROJECT_KNOWLEDGE.md`・`ARCHITECTURE.md` を読んでください。

最終更新: 2026-04-30 / 担当バージョン: v1.0.3-04300047

---

## 1. プロジェクト概要

- **何**: 週次プロジェクト管理ツール（メモツール）
- **思想**: Workflowy のような操作感 + Excel のような俯瞰でのプロジェクト管理を同時実現
- **構成**: 単一ページ Web アプリ（Vanilla JS）
  - `project-weekly-tracker.html` — UI 骨格・モーダル群
  - `app.js` — ロジック全部（〜8500行）
  - `style.css` — スタイル全部（〜3800行）
  - `data.json` — ユーザーデータ（File System Access API + GitHub 同期 + localStorage）
  - `sw.js` — PWA Service Worker
  - `manifest.json` — PWA 設定

- **GitHub**: `Itokonnyaku3/Weekly`
- **公開URL**: https://itokonnyaku3.github.io/Weekly/project-weekly-tracker.html
- **コミット**: `push.bat` をダブルクリック（CRLF形式で作成済み）

---

## 2. 直近の作業状況（v1.0.3）

### 完了したこと
| バージョン | 内容 |
|---|---|
| v1.0.1 | 案A: スパン同名レーン整列（`computeSpanLanesForProject`） |
| v1.0.2 | オーバーレイ描画（`renderSpanBars`）を廃止しインライン一本化 |
| v1.0.3 | スパンバーに編集アイコン✏を追加（案②） |

詳細は `CHANGELOG.md` 参照。

### 残課題（次セッションで検討するもの）
- **Phase 4: 真の Gantt 化（案③）**: スパンを `colspan` を使った本物のテーブルセルに昇格させる。これによりバー＝ノード本体となり編集UXがネイティブ化する。但し描画ロジックの大改修が必要。
- **AIパネルの再統合**: Phase 3 の途中で取り残されている。
- **デバッグログの完全除去**: `window.onerror` などが残っている可能性あり。

---

## 3. 現在のグリッド・スパン仕様（v1.0.3 時点）

### スパンノードとは
- `node.startDate` と `node.endDate` を持つノード = "スパン"
- 開始週〜終了週の各セルの上部に `.span-inline-bar` として表示される

### レーン割当（`computeSpanLanesForProject`）
- プロジェクト pi 内の全スパンを集める
- `startDate` 昇順 → `text` 昇順で安定ソート
- `node.text.trim()` をキーとして、初出順にレーン番号を付与（同名は同レーン）
- 戻り値: `{ laneMap: Map<key, laneIdx>, maxLane }`

### 描画の流れ（`_renderImpl` 内）
1. プロジェクトの直前で `spanLanes = computeSpanLanesForProject(pi)` を呼ぶ。
2. 各週セルで:
   - その週をカバーするスパンノード（`weekSpans`）を集める。
   - レーン番号 → スパン の Map (`lanedSpans`) を作る。
   - レーン 0 〜 maxLane を順に走査して、該当スパンが無ければ `visibility:hidden` のプレースホルダを置く（縦位置維持）。
   - 該当スパンがあれば `.span-inline-bar` を出力。バー右端に `.span-bar-edit`（✏）を付ける。
3. 全バーを出した後、子タスク（`parentId === sn.id`）をレーン順にまとめて出力。
4. スパンに属さない通常タスクを出力。
5. 今週なら「継続中（前週より）」のミラーアイテムを出力。

### 編集アイコン✏の挙動（v1.0.3）
- バー右端に `.span-bar-edit` を配置（flex で右寄せ）。
- クリック時:
  - `event.stopPropagation()` で wcell のクリックを抑止。
  - `openPanel(pi, originWk, sn.id)` で詳細パネルを開く。
  - `originWk` は `sn.date || sn.startDate` を `wkey()` した値。なければフォールバックで現在週 `k`。

---

## 4. 重要なコーディングルール

### CLAUDE.md ルール（絶対遵守）
1. **3世代バックアップ**: コード更新前に `BKP/` へバックアップ（命名: `<file>.bak3_YYYYMMDD_HHMMSS_<reason>`）。
2. **既存機能の担保確認**: 変更後は既存機能が壊れていないか必ず確認。
3. **懸念があれば確認**: 不明点・リスクは必ずユーザーに確認してから実行。

### 大ファイル編集の注意（重要）
- **app.js は約8500行・390KB の巨大ファイル**。Edit ツールで編集すると **末尾が欠落することがある**。
- 編集後は必ず:
  ```
  wc -l app.js          # 行数確認
  tail -3 app.js        # 末尾完結確認
  node --check app.js   # 構文確認
  ```
- 末尾が欠けていたら、バックアップから `head + tail` でマージ復元する手順は既に確立済み（`/tmp/head.js` + `/tmp/tail.js` → `cat > /tmp/merged.js`）。

### バージョン管理
- `app.js` 冒頭の `const APP_VERSION = 'vX.Y.Z-MMDDHHMM';` を更新。
- ヘッダー右上にバージョン表示が出る。
- コミット前に `push.bat` でリポジトリへ反映。

### HTML/JS 整合性チェック
- HTML 修正後: `<script src="app.js"></script>` と `</body>` の存在を grep で確認。
- コード削除前: 範囲内の全 function/let/const を grep で事前確認（無関係な関数を巻き込まないため）。

---

## 5. 関連ドキュメントの位置付け

| ファイル | 用途 |
|---|---|
| `CLAUDE.md` | プロジェクトの基本方針（短い）|
| `PROJECT_KNOWLEDGE.md` | デザインこだわり・過去の修正経緯・将来構想（ノード統合等）|
| `ARCHITECTURE.md` | アーキテクチャ図・主要関数の解説 |
| `CHANGELOG.md` | バージョンごとの変更履歴 |
| `HANDOVER.md` | このファイル。引継ぎ用スナップショット |
| `仕様書_テスト項目_WeeklyTracker.docx` | 仕様書 |

---

## 6. 開発フロー（チェックリスト）

新しい変更を入れるときの推奨手順:

- [ ] 変更内容をユーザーと合意
- [ ] `BKP/` にバックアップ（`<file>.bak3_YYYYMMDD_HHMMSS_<reason>`）
- [ ] 編集
- [ ] **検証**: `wc -l` / `tail -3` / `node --check` で末尾欠損チェック
- [ ] バージョン番号を更新
- [ ] `CHANGELOG.md` に追記
- [ ] ブラウザで動作確認（Ctrl+Shift+R で強制リロード）
- [ ] `push.bat` でコミット
- [ ] このファイル `HANDOVER.md` の「直近の作業状況」を更新

---

## 7. 連絡事項

- ユーザー: 米山さん（ベイシア デジタル推進部 マネージャー）
- メール: yoneyama@beisia.co.jp
- AIへの期待: 軽快な操作感の維持、スパゲッティコード回避、デグレ防止
