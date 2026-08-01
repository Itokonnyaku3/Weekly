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
    MONITORINFO,
    SM_CXVIRTUALSCREEN,
    SM_CYVIRTUALSCREEN,
    SM_XVIRTUALSCREEN,
    SM_YVIRTUALSCREEN,
    SRCCOPY,
    gdi32,
    user32,
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


def screen_rect(area: str = "virtual") -> tuple[int, int, int, int]:
    """撮影範囲を (x, y, w, h) で返す。"""
    if area == "primary":
        w = user32.GetSystemMetrics(0)  # SM_CXSCREEN
        h = user32.GetSystemMetrics(1)  # SM_CYSCREEN
        return 0, 0, w, h

    if area == "active":
        pt = wintypes.POINT()
        user32.GetCursorPos(ctypes.byref(pt))
        hmon = user32.MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST)
        mi = MONITORINFO()
        mi.cbSize = ctypes.sizeof(MONITORINFO)
        if user32.GetMonitorInfoW(hmon, ctypes.byref(mi)):
            r = mi.rcMonitor
            return r.left, r.top, r.right - r.left, r.bottom - r.top
        # 取れなければ仮想画面にフォールバック

    x = user32.GetSystemMetrics(SM_XVIRTUALSCREEN)
    y = user32.GetSystemMetrics(SM_YVIRTUALSCREEN)
    w = user32.GetSystemMetrics(SM_CXVIRTUALSCREEN)
    h = user32.GetSystemMetrics(SM_CYVIRTUALSCREEN)
    return x, y, w, h


def grab(area: str = "virtual") -> RawShot:
    x, y, w, h = screen_rect(area)
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
