"""ビューアを「画面右端に貼り付いた枠なしウィンドウ」として開く。

Edge / Chrome の --app モードを使う。タブバーもアドレスバーも出ないので、
ブラウザというより常駐パネルに見える。
--window-position が無視されるブラウザ・状況があるため、開いたあとに
SetWindowPos で位置を確定させる（保険）。
"""

from __future__ import annotations

import ctypes
import os
import shutil
import subprocess
import time
import webbrowser
from ctypes import wintypes
from pathlib import Path

from winapi import (
    ENUMWINDOWSPROC,
    HWND_TOP,
    SM_CXVIRTUALSCREEN,
    SM_XVIRTUALSCREEN,
    SPI_GETWORKAREA,
    SW_RESTORE,
    SWP_NOACTIVATE,
    SWP_NOSIZE,
    SWP_NOZORDER,
    user32,
)

# ビューアの <title>。この文字列でウィンドウを見つける。
WINDOW_TITLE = "shot — スクリーンショット"

_hwnd: int | None = None  # 見つけたビューアウィンドウ
_last_scan = 0.0
RESCAN_INTERVAL = 2.0


def _browser() -> str | None:
    candidates = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    for name in ("msedge", "chrome"):
        found = shutil.which(name)
        if found:
            return found
    return None


def work_area() -> tuple[int, int, int, int]:
    """プライマリモニタの作業領域（タスクバーを除いた範囲）を返す。"""
    r = wintypes.RECT()
    if user32.SystemParametersInfoW(SPI_GETWORKAREA, 0, ctypes.byref(r), 0):
        return r.left, r.top, r.right - r.left, r.bottom - r.top
    return 0, 0, user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)


def find_window(title: str = WINDOW_TITLE) -> int | None:
    found = []

    def cb(hwnd, _lparam):
        n = user32.GetWindowTextLengthW(hwnd)
        if n:
            buf = ctypes.create_unicode_buffer(n + 1)
            user32.GetWindowTextW(hwnd, buf, n + 1)
            if title in buf.value and user32.IsWindowVisible(hwnd):
                found.append(hwnd)
                return False
        return True

    user32.EnumWindows(ENUMWINDOWSPROC(cb), 0)
    return found[0] if found else None


def hwnd() -> int | None:
    """ビューアウィンドウを返す。無ければ None。

    自分で開いたウィンドウとは限らない。二重起動した別プロセスが開いた場合や、
    常駐側だけ再起動した場合もあるので、覚えていなければ探しに行く。
    ただし撮影のたびに EnumWindows を回すのは無駄なので、
    見つからなかった結果は数秒キャッシュする。
    """
    global _hwnd, _last_scan
    if _hwnd and user32.IsWindow(_hwnd):
        return _hwnd

    _hwnd = None
    now = time.monotonic()
    if now - _last_scan < RESCAN_INTERVAL:
        return None
    _last_scan = now
    _hwnd = find_window()
    return _hwnd


def dock(h: int, width: int) -> None:
    ax, ay, aw, ah = work_area()
    w = min(width, aw)
    user32.SetWindowPos(
        h, HWND_TOP, ax + aw - w, ay, w, ah, SWP_NOZORDER | SWP_NOACTIVATE
    )


def open_dock(port: int, width: int = 520) -> None:
    """既に開いていれば前面に出し、無ければ右端に新しく開く。"""
    global _hwnd

    h = hwnd()
    if h:
        user32.ShowWindow(h, SW_RESTORE)
        user32.SetForegroundWindow(h)
        dock(h, width)
        return

    url = f"http://127.0.0.1:{port}/"
    exe = _browser()
    if not exe:
        webbrowser.open(url)
        return

    ax, ay, aw, ah = work_area()
    w = min(width, aw)
    subprocess.Popen(
        [
            exe,
            f"--app={url}",
            f"--window-position={ax + aw - w},{ay}",
            f"--window-size={w},{ah}",
        ],
        creationflags=subprocess.CREATE_NO_WINDOW,
    )

    # ウィンドウが現れるのを待って位置を確定させる（--window-position が
    # 無視されるケースがあるため、見つけ次第 SetWindowPos で押し込む）
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        h = find_window()
        if h:
            _hwnd = h
            dock(h, width)
            return
        time.sleep(0.15)


def hide_for_capture() -> tuple[int, int, int] | None:
    """撮影の瞬間だけビューアを画面外へどける。戻すための情報を返す。

    ShowWindow(SW_HIDE) は使えない。フェードアウトの演出が入るので、直後に撮ると
    半透明のビューアが写り込む。DWM のクロークも使えない。他プロセスのウィンドウには
    権限がなく E_ACCESSDENIED になる。
    位置を動かすだけなら演出も権限の問題もなく、サイズも変わらないので
    ページの再レイアウトも起きない。
    """
    h = hwnd()
    if not (h and user32.IsWindowVisible(h)):
        return None

    r = wintypes.RECT()
    if not user32.GetWindowRect(h, ctypes.byref(r)):
        return None

    vx = user32.GetSystemMetrics(SM_XVIRTUALSCREEN)
    vw = user32.GetSystemMetrics(SM_CXVIRTUALSCREEN)
    user32.SetWindowPos(
        h, HWND_TOP, vx + vw + 8, r.top, 0, 0,
        SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
    )
    return h, r.left, r.top


def unhide(saved: tuple[int, int, int] | None) -> None:
    if not saved:
        return
    h, x, y = saved
    user32.SetWindowPos(
        h, HWND_TOP, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE
    )
