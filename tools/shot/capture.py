"""画面キャプチャ。

ホットキーを押したスレッドを長く止めないことが最優先。
ここでは BitBlt + GetDIBits で生のピクセル列を取り出すところまでを行い、
PNG エンコードとディスク書き込みは呼び出し側のワーカースレッドに任せる。
4K の仮想画面全体でも 10〜20ms 程度で返る。
"""

from __future__ import annotations

import ctypes
from ctypes import wintypes
from dataclasses import dataclass

from winapi import (
    BITMAPINFO,
    BI_RGB,
    DIB_RGB_COLORS,
    MONITOR_DEFAULTTONEAREST,
    MONITORENUMPROC,
    MONITORINFO,
    SM_CXVIRTUALSCREEN,
    SM_CYVIRTUALSCREEN,
    SM_XVIRTUALSCREEN,
    SM_YVIRTUALSCREEN,
    SRCCOPY,
    gdi32,
    user32,
    visible_window_rect,
    window_class,
)


@dataclass(frozen=True)
class RawShot:
    """生のスクリーンショット。data はトップダウンの BGRX 32bit。"""

    width: int
    height: int
    data: bytes
    # 撮った範囲の画面上の位置。撮影後にその範囲だけ光らせるのに使う。
    x: int = 0
    y: int = 0

    @property
    def rect(self) -> tuple[int, int, int, int]:
        return self.x, self.y, self.width, self.height


class CaptureError(RuntimeError):
    pass


@dataclass(frozen=True)
class Monitor:
    index: int  # 1 始まり
    rect: tuple[int, int, int, int]  # x, y, w, h
    primary: bool

    @property
    def label(self) -> str:
        _, _, w, h = self.rect
        return f"モニタ{self.index}（{w}×{h}{'・主' if self.primary else ''}）"


# 撮影範囲として撮ってはいけないウィンドウのクラス名。
# タスクバーやデスクトップを「前面のウィンドウ」として撮っても意味がない。
SHELL_CLASSES = frozenset(
    {
        "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Progman", "WorkerW",
        "Windows.UI.Core.CoreWindow", "ShotTrayWindow", "ShotFlashWindow",
    }
)


def virtual_rect() -> tuple[int, int, int, int]:
    return (
        user32.GetSystemMetrics(SM_XVIRTUALSCREEN),
        user32.GetSystemMetrics(SM_YVIRTUALSCREEN),
        user32.GetSystemMetrics(SM_CXVIRTUALSCREEN),
        user32.GetSystemMetrics(SM_CYVIRTUALSCREEN),
    )


def list_monitors() -> list[Monitor]:
    """つながっているモニタを、左上に近い順で返す。"""
    found: list[tuple[int, int, int, int, bool]] = []

    def cb(hmon, _hdc, _rect, _lparam):
        mi = MONITORINFO()
        mi.cbSize = ctypes.sizeof(MONITORINFO)
        if user32.GetMonitorInfoW(hmon, ctypes.byref(mi)):
            r = mi.rcMonitor
            found.append(
                (r.left, r.top, r.right - r.left, r.bottom - r.top, bool(mi.dwFlags & 1))
            )
        return True

    user32.EnumDisplayMonitors(None, None, MONITORENUMPROC(cb), 0)
    found.sort(key=lambda m: (m[0], m[1]))  # 並び順が実行ごとに変わらないようにする
    return [
        Monitor(index=i + 1, rect=(x, y, w, h), primary=p)
        for i, (x, y, w, h, p) in enumerate(found)
    ]


def monitor_at_cursor() -> tuple[int, int, int, int] | None:
    pt = wintypes.POINT()
    user32.GetCursorPos(ctypes.byref(pt))
    hmon = user32.MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST)
    mi = MONITORINFO()
    mi.cbSize = ctypes.sizeof(MONITORINFO)
    if not user32.GetMonitorInfoW(hmon, ctypes.byref(mi)):
        return None
    r = mi.rcMonitor
    return r.left, r.top, r.right - r.left, r.bottom - r.top


def is_capturable_window(hwnd: int) -> bool:
    """そのウィンドウを「撮る対象」として扱ってよいか。"""
    if not hwnd or not user32.IsWindow(hwnd) or user32.IsIconic(hwnd):
        return False
    if not user32.IsWindowVisible(hwnd):
        return False
    return window_class(hwnd) not in SHELL_CLASSES


def foreground_window_rect(hwnd: int | None = None) -> tuple[int, int, int, int] | None:
    """前面のウィンドウの矩形。撮れる相手でなければ None。

    画面外にはみ出している分は切り落とす。仮想画面の外を BitBlt しても
    中身は取れず、黒い帯になるだけなので。
    """
    hwnd = hwnd or user32.GetForegroundWindow()
    if not is_capturable_window(hwnd):
        return None
    rect = visible_window_rect(hwnd)
    if not rect:
        return None
    return intersect(rect, virtual_rect())


def intersect(a, b) -> tuple[int, int, int, int] | None:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    left, top = max(ax, bx), max(ay, by)
    right, bottom = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    if right - left < 1 or bottom - top < 1:
        return None
    return left, top, right - left, bottom - top


def screen_rect(area: str = "virtual", window: int | None = None) -> tuple[int, int, int, int]:
    """設定された撮影範囲を (x, y, w, h) で返す。

    area:
      "virtual"    全モニタをつないだ範囲（既定）
      "primary"    主モニタ
      "cursor"     カーソルがあるモニタ（旧称 "active" も受ける）
      "window"     前面のウィンドウ
      "monitor:N"  N番目のモニタ（1 始まり）
    解決できない指定は "virtual" として扱う。撮れないより全体を撮るほうがよい。
    """
    if area == "primary":
        return 0, 0, user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)

    if area in ("cursor", "active"):
        return monitor_at_cursor() or virtual_rect()

    if area == "window":
        return foreground_window_rect(window) or monitor_at_cursor() or virtual_rect()

    if area.startswith("monitor:"):
        try:
            n = int(area.split(":", 1)[1])
        except ValueError:
            return virtual_rect()
        for m in list_monitors():
            if m.index == n:
                return m.rect
        return virtual_rect()

    return virtual_rect()


def grab(area: str = "virtual", window: int | None = None) -> RawShot:
    x, y, w, h = screen_rect(area, window)
    if w <= 0 or h <= 0:
        raise CaptureError(f"撮影範囲が不正です: {w}x{h}")

    hdc_screen = user32.GetDC(None)
    if not hdc_screen:
        raise CaptureError("画面 DC を取得できません")

    hdc_mem = None
    hbmp = None
    old = None
    try:
        hdc_mem = gdi32.CreateCompatibleDC(hdc_screen)
        hbmp = gdi32.CreateCompatibleBitmap(hdc_screen, w, h)
        if not hdc_mem or not hbmp:
            raise CaptureError("メモリ DC / ビットマップを作成できません")
        old = gdi32.SelectObject(hdc_mem, hbmp)

        # CAPTUREBLT は付けない。付けると画面が一瞬再描画されてちらつき、実測でも遅い。
        # DWM 合成環境では付けなくてもオーバーレイ類は取れている。
        if not gdi32.BitBlt(hdc_mem, 0, 0, w, h, hdc_screen, x, y, SRCCOPY):
            raise CaptureError("BitBlt に失敗しました")

        bmi = BITMAPINFO()
        bmi.bmiHeader.biSize = ctypes.sizeof(bmi.bmiHeader)
        bmi.bmiHeader.biWidth = w
        bmi.bmiHeader.biHeight = -h  # 負にするとトップダウン（上下反転しない）
        bmi.bmiHeader.biPlanes = 1
        bmi.bmiHeader.biBitCount = 32
        bmi.bmiHeader.biCompression = BI_RGB

        buf = ctypes.create_string_buffer(w * h * 4)
        got = gdi32.GetDIBits(
            hdc_mem, hbmp, 0, h, buf, ctypes.byref(bmi), DIB_RGB_COLORS
        )
        if got == 0:
            raise CaptureError("GetDIBits に失敗しました")

        return RawShot(width=w, height=h, data=buf.raw, x=x, y=y)
    finally:
        if hdc_mem and old:
            gdi32.SelectObject(hdc_mem, old)
        if hbmp:
            gdi32.DeleteObject(hbmp)
        if hdc_mem:
            gdi32.DeleteDC(hdc_mem)
        user32.ReleaseDC(None, hdc_screen)


def to_image(shot: RawShot):
    """RawShot を Pillow の Image に変換する（ワーカースレッド側で呼ぶ）。"""
    from PIL import Image

    return Image.frombuffer(
        "RGB", (shot.width, shot.height), shot.data, "raw", "BGRX", 0, 1
    )
