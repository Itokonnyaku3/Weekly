"""撮ったことが分かるように、撮影範囲を一瞬だけ白く光らせる。

半透明の枠なしウィンドウを起動時に1枚だけ作っておき、撮影のたびに
位置を合わせて出す→消すだけにする。毎回作り直すと出るまでに間が空く。

必ず BitBlt が終わってから出す。先に出すと、そのフラッシュ自体が写り込む。
"""

from __future__ import annotations

import ctypes
import threading
import time

from winapi import (
    HWND_TOPMOST,
    LWA_ALPHA,
    SWP_NOACTIVATE,
    SWP_SHOWWINDOW,
    SW_HIDE,
    WNDCLASSEXW,
    WNDPROC,
    WS_EX_LAYERED,
    WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW,
    WS_EX_TOPMOST,
    WS_EX_TRANSPARENT,
    WS_POPUP,
    gdi32,
    kernel32,
    user32,
)

WINDOW_CLASS = "ShotFlashWindow"
WHITE = 0x00FFFFFF


class Flash:
    def __init__(self, alpha: int = 160, duration_ms: int = 70):
        self.alpha = max(1, min(255, int(alpha)))
        self.duration = max(10, int(duration_ms)) / 1000
        self.hwnd = None
        self._wndproc = WNDPROC(self._on_message)  # GC されないよう保持する
        self._timer: threading.Timer | None = None

    def _on_message(self, hwnd, msg, wparam, lparam):
        return user32.DefWindowProcW(hwnd, msg, wparam, lparam)

    def start(self) -> None:
        hinst = kernel32.GetModuleHandleW(None)
        wc = WNDCLASSEXW()
        wc.cbSize = ctypes.sizeof(WNDCLASSEXW)
        wc.lpfnWndProc = self._wndproc
        wc.hInstance = hinst
        wc.lpszClassName = WINDOW_CLASS
        # 背景ブラシを白にしておけば、描画の処理を書かなくても白い面になる
        wc.hbrBackground = gdi32.CreateSolidBrush(WHITE)
        if not user32.RegisterClassExW(ctypes.byref(wc)):
            raise OSError("フラッシュ用のウィンドウクラスを登録できません")

        self.hwnd = user32.CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW
            | WS_EX_NOACTIVATE | WS_EX_TOPMOST,
            WINDOW_CLASS, "", WS_POPUP, 0, 0, 0, 0, None, None, hinst, None,
        )
        if not self.hwnd:
            raise OSError("フラッシュ用のウィンドウを作成できません")
        user32.SetLayeredWindowAttributes(self.hwnd, 0, self.alpha, LWA_ALPHA)

    def hide(self) -> None:
        """すぐ消す。次の撮影の直前に呼び、フラッシュ自体が写らないようにする。"""
        if self._timer:
            self._timer.cancel()
            self._timer = None
        if self.hwnd:
            user32.ShowWindow(self.hwnd, SW_HIDE)

    def show(self, rect: tuple[int, int, int, int]) -> None:
        """撮影した範囲だけを光らせる。どこを撮ったかも同時に伝わる。"""
        if not self.hwnd:
            return
        x, y, w, h = rect
        user32.SetWindowPos(
            self.hwnd, HWND_TOPMOST, x, y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW
        )
        if self._timer:
            self._timer.cancel()
        self._timer = threading.Timer(self.duration, self.hide)
        self._timer.daemon = True
        self._timer.start()

    def stop(self) -> None:
        self.hide()
        if self.hwnd:
            user32.DestroyWindow(self.hwnd)
            self.hwnd = None
