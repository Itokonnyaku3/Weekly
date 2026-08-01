"""shot — ショートカット一発でスクリーンショットを撮り、連番で溜めていく常駐ツール。

    pythonw shot.py           通常起動（トレイ常駐、コンソール窓なし）
    python  shot.py --selftest  撮影〜保存を1回だけ試し、所要時間を出す

撮る側はとにかく軽くする。押した瞬間にやるのは BitBlt だけで、
PNG 化とディスク書き込みはワーカースレッドへ逃がす。
"""

from __future__ import annotations

import ctypes
import logging
import os
import subprocess
import sys
import threading
import time
import winsound
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import capture  # noqa: E402
import config  # noqa: E402
import startup  # noqa: E402
import storage  # noqa: E402
import winapi  # noqa: E402
from saver import Saver  # noqa: E402
from tray import Tray  # noqa: E402

MUTEX_NAME = "Global\\ShotScreenshotDaemon"
ERROR_ALREADY_EXISTS = 183

log = logging.getLogger("shot")
_mutex_handle = None  # プロセスが終わるまで握っておく


def already_running() -> bool:
    global _mutex_handle
    _mutex_handle = winapi.kernel32.CreateMutexW(None, False, MUTEX_NAME)
    return ctypes.get_last_error() == ERROR_ALREADY_EXISTS


def setup_logging() -> None:
    logging.basicConfig(
        filename=str(HERE / "shot.log"),
        filemode="a",
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        encoding="utf-8",
    )


def open_in_explorer(path: Path) -> None:
    try:
        os.startfile(str(path))
    except OSError:
        subprocess.Popen(["explorer", str(path)])


class App:
    def __init__(self) -> None:
        self.cfg = config.load()
        self.root = config.root_dir(self.cfg)
        self.root.mkdir(parents=True, exist_ok=True)
        self.paused = False

        self.saver = Saver(
            self.root,
            compress_level=self.cfg["png_compress_level"],
            on_saved=self._on_saved,
        )
        self.tray = Tray(
            hotkey=self.cfg["hotkey"],
            on_capture=self.capture,
            on_viewer=self.open_viewer,
            on_folder=lambda: open_in_explorer(self.root),
            on_toggle_pause=self.toggle_pause,
            on_toggle_startup=self.toggle_startup,
            on_quit=self.quit,
            status=self.status,
        )

    # -- トレイに見せる状態 --

    def status(self) -> dict:
        return {
            "count": storage.count_on(self.root, datetime.now()),
            "paused": self.paused,
            "startup": startup.is_enabled(),
        }

    def _on_saved(self, path: Path) -> None:
        self.tray.refresh_tip()

    # -- 撮影 --

    def capture(self, source: str = "hotkey") -> None:
        if self.paused:
            return
        if source == "hotkey":
            # 最短経路。メッセージスレッドで撮ってすぐ返す。
            self._grab()
        else:
            # トレイのツールチップやメニューが画面に残っているので、消えるのを待つ。
            delay = max(0, int(self.cfg["tray_click_delay_ms"])) / 1000
            threading.Timer(delay, self._grab).start()

    def _grab(self) -> None:
        t0 = time.perf_counter()
        taken_at = datetime.now()
        try:
            raw = capture.grab(self.cfg["capture_area"])
        except capture.CaptureError as e:
            log.error("capture failed: %s", e)
            self.tray.notify("撮影に失敗しました", str(e), warn=True)
            return
        self.saver.submit(raw, taken_at)

        elapsed_ms = (time.perf_counter() - t0) * 1000
        if elapsed_ms > self.cfg.get("log_slow_capture_ms", 100):
            log.warning("capture took %.0fms (%dx%d)", elapsed_ms, raw.width, raw.height)

        if self.cfg["beep"]:
            winsound.MessageBeep(winsound.MB_OK)

    # -- メニュー --

    def toggle_pause(self) -> None:
        self.paused = not self.paused

    def toggle_startup(self) -> None:
        on = startup.toggle()
        self.tray.notify(
            "スタートアップ",
            "登録しました。次回サインイン時から自動で起動します。" if on else "解除しました。",
        )

    def open_viewer(self) -> None:
        # Phase 2 でローカルサーバとビューアに置き換える
        self.tray.notify("編集ビュー", "次のフェーズで実装します。いまは保存フォルダを開きます。")
        open_in_explorer(self.root)

    def quit(self) -> None:
        self.saver.stop()

    # -- 起動 --

    def run(self) -> None:
        self.saver.start()
        self.tray.start()
        self.tray.refresh_tip()
        log.info("started (hotkey=%s, root=%s)", self.tray.hotkey_spec, self.root)
        self.tray.run()


def selftest() -> int:
    """撮影〜保存を1回だけ行い、所要時間を表示する。"""
    winapi.enable_dpi_awareness()
    cfg = config.load()
    root = config.root_dir(cfg)
    root.mkdir(parents=True, exist_ok=True)

    t0 = time.perf_counter()
    raw = capture.grab(cfg["capture_area"])
    t_grab = (time.perf_counter() - t0) * 1000

    saver = Saver(root, compress_level=cfg["png_compress_level"])
    t1 = time.perf_counter()
    path = saver._save(raw, datetime.now())
    t_save = (time.perf_counter() - t1) * 1000

    size_mb = path.stat().st_size / 1024 / 1024
    print(f"範囲      : {raw.width} x {raw.height} ({cfg['capture_area']})")
    print(f"キャプチャ: {t_grab:6.1f} ms   <- ホットキーを押したスレッドが止まる時間")
    print(f"PNG保存   : {t_save:6.1f} ms   <- ワーカースレッド側（体感に影響しない）")
    print(f"出力      : {path}  ({size_mb:.1f} MB)")
    return 0


def main() -> int:
    if "--selftest" in sys.argv:
        return selftest()

    winapi.enable_dpi_awareness()
    setup_logging()

    if already_running():
        # スタートアップの二重登録やショートカットの再実行でも事故らないようにする
        log.info("already running; exiting")
        return 0

    try:
        App().run()
    except Exception:
        log.exception("fatal")
        raise
    return 0


if __name__ == "__main__":
    sys.exit(main())
