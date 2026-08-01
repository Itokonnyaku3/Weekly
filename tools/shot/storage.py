"""保存先の解決・連番の採番・メタデータ(index.json)の読み書き。

レイアウト:
    <root>/2026-08-01/001_143052.png
    <root>/2026-08-01/index.json
    <root>/2026-08-01/.thumbs/001_143052.jpg
    <root>/_trash/

ファイル名は NNN_HHMMSS.png。連番だけで時系列が保証され、時刻も目で読める。
連番は日付フォルダ内で完結し、日が変われば 001 に戻る。
"""

from __future__ import annotations

import json
import os
import re
import shutil
from datetime import datetime
from pathlib import Path

SHOT_RE = re.compile(r"^(\d{3,})_(\d{6})\.png$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TRASH_DIRNAME = "_trash"
THUMBS_DIRNAME = ".thumbs"
INDEX_NAME = "index.json"


def date_key(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d")


def day_dir(root: Path, dt: datetime, create: bool = True) -> Path:
    d = root / date_key(dt)
    if create:
        d.mkdir(parents=True, exist_ok=True)
    return d


def next_name(day: Path, dt: datetime) -> str:
    """その日フォルダでの次のファイル名を返す。既存の最大連番 + 1。"""
    n = 0
    if day.exists():
        for p in day.iterdir():
            m = SHOT_RE.match(p.name)
            if m:
                n = max(n, int(m.group(1)))
    return f"{n + 1:03d}_{dt.strftime('%H%M%S')}.png"


# --- index.json -----------------------------------------------------------


def _empty_index() -> dict:
    return {"version": 1, "shots": {}}


def load_index(day: Path) -> dict:
    p = day / INDEX_NAME
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return _empty_index()
    # 壊れた／古い形でも落とさず、使える形に正規化する
    if not isinstance(data, dict) or not isinstance(data.get("shots"), dict):
        return _empty_index()
    data.setdefault("version", 1)
    return data


def save_index(day: Path, data: dict) -> None:
    """一時ファイルへ書いてから置換する（書き込み中の電源断でも壊れない）。"""
    day.mkdir(parents=True, exist_ok=True)
    tmp = day / (INDEX_NAME + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, day / INDEX_NAME)


def add_entry(day: Path, name: str, dt: datetime, width: int, height: int) -> dict:
    data = load_index(day)
    entry = {
        "ts": dt.isoformat(timespec="seconds"),
        "w": width,
        "h": height,
        "note": "",
    }
    data["shots"][name] = entry
    save_index(day, data)
    return entry


def update_entry(day: Path, name: str, **fields) -> dict:
    """既存エントリを部分更新する。無ければ最小限の形で作る。"""
    data = load_index(day)
    entry = data["shots"].setdefault(name, {"ts": "", "w": 0, "h": 0, "note": ""})
    entry.update(fields)
    save_index(day, data)
    return entry


# --- 一覧 -----------------------------------------------------------------


def list_days(root: Path) -> list[tuple[str, int]]:
    """(日付, 枚数) を新しい順で返す。"""
    if not root.exists():
        return []
    out = []
    for d in root.iterdir():
        if d.is_dir() and DATE_RE.match(d.name):
            count = sum(1 for p in d.iterdir() if SHOT_RE.match(p.name))
            if count:
                out.append((d.name, count))
    out.sort(reverse=True)
    return out


def list_shots(day: Path) -> list[str]:
    """その日のファイル名を連番順で返す。"""
    if not day.exists():
        return []
    names = [p.name for p in day.iterdir() if SHOT_RE.match(p.name)]
    names.sort(key=lambda n: int(SHOT_RE.match(n).group(1)))
    return names


def count_on(root: Path, dt: datetime) -> int:
    return len(list_shots(root / date_key(dt)))


# --- 削除 -----------------------------------------------------------------


def move_to_trash(root: Path, date: str, name: str) -> Path:
    """<root>/_trash/<date>__<name> へ移動する。即時削除はしない。"""
    trash = root / TRASH_DIRNAME
    trash.mkdir(parents=True, exist_ok=True)
    src = root / date / name
    dst = trash / f"{date}__{name}"
    i = 1
    while dst.exists():
        dst = trash / f"{date}__{dst.stem}~{i}.png"
        i += 1
    shutil.move(str(src), str(dst))

    day = root / date
    data = load_index(day)
    data["shots"].pop(name, None)
    save_index(day, data)

    thumb = day / THUMBS_DIRNAME / (Path(name).stem + ".jpg")
    thumb.unlink(missing_ok=True)
    return dst
