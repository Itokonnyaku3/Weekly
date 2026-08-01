"""撮ったピクセル列を PNG にしてディスクへ書き出すワーカースレッド。

キャプチャした側は raw バイト列をキューに置くだけで戻れる。
PNG エンコードは数百 ms かかることがあるので、必ずこちら側で行う。
ワーカーは1本だけなので、連番の採番は排他制御なしで安全に順番どおりになる。
"""

from __future__ import annotations

import os
import queue
import threading
from datetime import datetime
from pathlib import Path

import capture
import storage

_STOP = object()


class Saver(threading.Thread):
    def __init__(self, root: Path, compress_level: int = 1, on_saved=None):
        super().__init__(name="shot-saver", daemon=True)
        self.root = root
        self.compress_level = max(0, min(9, int(compress_level)))
        self.on_saved = on_saved
        self._q: queue.Queue = queue.Queue()
        self.last_error: str | None = None

    def submit(self, raw: capture.RawShot, taken_at: datetime) -> None:
        self._q.put((raw, taken_at))

    def pending(self) -> int:
        return self._q.qsize()

    def run(self) -> None:
        while True:
            item = self._q.get()
            if item is _STOP:
                return
            raw, taken_at = item
            try:
                self._save(raw, taken_at)
            except Exception as e:  # 1枚失敗しても常駐は続ける
                self.last_error = f"{type(e).__name__}: {e}"

    def _save(self, raw: capture.RawShot, taken_at: datetime) -> Path:
        day = storage.day_dir(self.root, taken_at)
        name = storage.next_name(day, taken_at)
        path = day / name

        img = capture.to_image(raw)
        # .part に書いてから置換する。ビューアが書きかけの PNG を読むのを防ぐ。
        tmp = day / (name + ".part")
        img.save(tmp, format="PNG", compress_level=self.compress_level)
        os.replace(tmp, path)

        storage.add_entry(day, name, taken_at, raw.width, raw.height)
        if self.on_saved:
            self.on_saved(path)
        return path

    def stop(self) -> None:
        self._q.put(_STOP)
