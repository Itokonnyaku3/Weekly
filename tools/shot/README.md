# shot — スクリーンショット即保存ツール

ショートカット一発で全画面を撮り、日付フォルダに連番で溜めていく常駐ツール。
**撮る作業は軽く、整理と加工はあとでまとめて** という分担にしている。

Snipping Tool のようにオーバーレイ・範囲選択・通知は一切出さない。
押した瞬間にやるのは画面のコピーだけで、PNG 化とディスク書き込みは裏のスレッドに逃がしている。
そのため連打しても取りこぼさない（実測：キャプチャ 36ms / 保存 147ms、10連打で欠番なし）。

## 使い方

```
pythonw tools\shot\shot.py
```

起動するとタスクトレイに常駐する。

| 操作 | 動作 |
|---|---|
| `Ctrl+Alt+S` | 全画面を撮って保存 |
| トレイアイコンを**左クリック** | 同上（ツールチップが写らないよう 150ms 待ってから撮る） |
| トレイアイコンを**右クリック** | メニュー（編集ビュー・保存フォルダ・一時停止・スタートアップ登録・終了） |

保存先は `%USERPROFILE%\Pictures\Shots\<日付>\NNN_HHMMSS.png`。
連番は日付ごとに 001 から振り直す。

### トレイアイコンが見当たらないとき

Windows 11 は新しいトレイアイコンを既定でオーバーフロー（`^`）の中に入れる。
左クリックで撮れるようにするには、一度だけ**常に表示される位置へ出しておく**：

- `^` を押して出てきたパネルから、shot のアイコンをタスクバーへドラッグする
- または 設定 → 個人用設定 → タスクバー → 「システムトレイアイコン」→ shot をオン

### スタートアップに登録する

トレイメニューの「スタートアップに登録」を押すか、直接：

```bash
powershell -ExecutionPolicy Bypass -File tools\shot\install_startup.ps1
```

解除は `-Remove` を付ける。`pythonw.exe` で起動するのでコンソール窓は出ない。

## 設定

`tools\shot\config.json`（初回起動時に既定値で作られる）。変更後は再起動する。

| キー | 既定 | 意味 |
|---|---|---|
| `root` | `""` | 保存先。空なら `%USERPROFILE%\Pictures\Shots` |
| `hotkey` | `"Ctrl+Alt+S"` | 撮影ホットキー。`"PrintScreen"`, `"Ctrl+Shift+F12"` なども可 |
| `capture_area` | `"virtual"` | `virtual`=全モニタ結合 / `primary` / `active`=カーソルのあるモニタ |
| `png_compress_level` | `1` | 0〜9。1 は速度優先（1枚 0.5〜3MB） |
| `beep` | `true` | 撮影時に短いビープ音を鳴らす |
| `tray_click_delay_ms` | `150` | トレイクリック経由のときだけ入れる遅延 |
| `port` | `8787` | ビューアのローカルサーバ |
| `dock_width` | `520` | ビューアを画面右端に出すときの幅 |
| `group_gap_minutes` | `30` | 一覧でこの分数以上あいたら区切り線を入れる |

`hotkey` が他のアプリと衝突して登録できないときは、通知を出したうえで `Ctrl+Alt+S` に切り替える。
`PrintScreen` は Windows の設定で Snipping Tool に割り当てられていることが多い。

## 構成

| ファイル | 役割 |
|---|---|
| `shot.py` | エントリポイント。多重起動チェック、トレイと保存スレッドの結線 |
| `winapi.py` | Win32 の ctypes バインディング |
| `capture.py` | BitBlt + GetDIBits で生ピクセルを取り出す |
| `saver.py` | PNG 化とディスク書き込みのワーカースレッド |
| `storage.py` | 保存先の解決・連番採番・`index.json` の読み書き |
| `tray.py` | 隠しウィンドウ + トレイアイコン + ホットキー |
| `startup.py` / `install_startup.ps1` | スタートアップ登録の ON/OFF |

pystray は使っていない。Windows で独自のメッセージループを回すため `RegisterHotKey` の
`WM_HOTKEY` を掴めず、両立しにくいため。隠しウィンドウ1つで
「ホットキー・トレイクリック・メニュー」をまとめて受けている。

## 開発

```bash
python -m pytest tools/shot/tests -q      # 単体テスト
python tools/shot/shot.py --selftest      # 撮影〜保存を1回試して所要時間を出す
```

エラーは `tools\shot\shot.log` に残る。キャプチャに 100ms 以上かかった場合も記録する。
