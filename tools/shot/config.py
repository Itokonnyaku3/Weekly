"""設定の読み書き。

config.json はこのファイルと同じフォルダに置く。存在しなければ既定値で作成する。
未知のキーは保持し、欠けているキーだけ既定値で補う（将来キーが増えても壊れない）。
"""

from __future__ import annotations

import json
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONFIG_PATH = HERE / "config.json"

DEFAULTS: dict = {
    # 保存先。"" なら %USERPROFILE%\Pictures\Shots
    "root": "",
    # 撮影ホットキー。"Ctrl+Alt+S" / "PrintScreen" / "Ctrl+Shift+F12" など
    "hotkey": "Ctrl+Alt+S",
    # "virtual"(全モニタ結合) / "primary" / "active"(カーソルのあるモニタ)
    "capture_area": "virtual",
    # PNG 圧縮レベル 0-9。1 は速度優先（1枚あたり数MB）
    "png_compress_level": 1,
    # 撮影時に短いビープ音を鳴らす
    "beep": True,
    # 撮影した範囲を一瞬だけ白く光らせて、撮れたことを知らせる
    "flash": True,
    "flash_ms": 70,
    "flash_alpha": 160,  # 1-255。大きいほど強く光る
    # トレイクリック経由のときだけ入れる遅延（ツールチップの写り込み防止）
    "tray_click_delay_ms": 150,
    # ビューアのローカルサーバ
    "port": 8787,
    # ビューアを画面右端に出すときの幅(px)
    "dock_width": 520,
    # 撮影の瞬間だけビューアウィンドウを隠す
    "hide_viewer_on_capture": True,
    # 一覧でこの分数以上あいたら区切り線を入れる
    "group_gap_minutes": 30,
}


def load() -> dict:
    cfg = dict(DEFAULTS)
    if not CONFIG_PATH.exists():
        save(cfg)
        return cfg

    try:
        # utf-8-sig にしておく。メモ帳や PowerShell で編集すると先頭に BOM が付き、
        # ただの utf-8 として読むと解析に失敗して設定が丸ごと無視されてしまう。
        saved = json.loads(CONFIG_PATH.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        # 壊れていても起動は止めない。既定値で動かす。
        return cfg
    if not isinstance(saved, dict):
        return cfg

    cfg.update(saved)
    # 設定項目が増えたときは書き戻す。config.json を見れば
    # 何を変えられるかが分かる状態を保つため。
    if any(key not in saved for key in DEFAULTS):
        save(cfg)
    return cfg


def save(cfg: dict) -> None:
    tmp = CONFIG_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, CONFIG_PATH)


def root_dir(cfg: dict) -> Path:
    r = (cfg.get("root") or "").strip()
    if r:
        return Path(os.path.expandvars(r)).expanduser()
    return Path.home() / "Pictures" / "Shots"
