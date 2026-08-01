"""タスクトレイ常駐とホットキー受付。

pystray は使わない。pystray は Windows で独自のメッセージループを回すため、
RegisterHotKey が投げる WM_HOTKEY を掴めない。隠しウィンドウを1つ作り、
その WndProc で「ホットキー・トレイクリック・メニュー」をまとめて受けるほうが単純で軽い。
"""

from __future__ import annotations

import ctypes
from ctypes import wintypes
from pathlib import Path

from winapi import (
    HWND_TOP,
    IMAGE_ICON,
    LR_DEFAULTSIZE,
    LR_LOADFROMFILE,
    MF_GRAYED,
    MF_SEPARATOR,
    MF_STRING,
    MOD_ALT,
    MOD_CONTROL,
    MOD_NOREPEAT,
    MOD_SHIFT,
    MOD_WIN,
    NIF_ICON,
    NIF_INFO,
    NIF_MESSAGE,
    NIF_TIP,
    NIIF_INFO,
    NIIF_WARNING,
    NIM_ADD,
    NIM_DELETE,
    NIM_MODIFY,
    NOTIFYICONDATAW,
    TPM_RETURNCMD,
    TPM_RIGHTBUTTON,
    WM_APP,
    WM_COMMAND,
    WM_DESTROY,
    WM_HOTKEY,
    WM_LBUTTONUP,
    WM_NULL,
    WM_RBUTTONUP,
    WM_TRAY,
    WNDCLASSEXW,
    WNDPROC,
    kernel32,
    shell32,
    user32,
)

HERE = Path(__file__).resolve().parent
ICON_PATH = HERE / "icon.ico"

WINDOW_CLASS = "ShotTrayWindow"
HOTKEY_ID = 1

ID_CAPTURE = 1001
ID_VIEWER = 1002
ID_FOLDER = 1003
ID_COUNT = 1004
ID_PAUSE = 1005
ID_STARTUP = 1006
ID_QUIT = 1007

# ワーカースレッドから「メニュー表示を更新して」と伝えるための独自メッセージ
WM_REFRESH_TIP = WM_APP + 2


# --- アイコン -------------------------------------------------------------


def ensure_icon(path: Path = ICON_PATH) -> Path:
    """トレイ用の .ico が無ければ作る（外部の画像ファイルに依存しないため）。"""
    if path.exists():
        return path
    from PIL import Image, ImageDraw

    def frame(size: int) -> Image.Image:
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        pad = max(1, size // 16)
        # 角丸の本体（濃い青）。明暗どちらのタスクバーでも沈まない色にする。
        d.rounded_rectangle(
            [pad, pad + size // 8, size - pad, size - pad],
            radius=max(2, size // 6),
            fill=(37, 99, 235, 255),
        )
        # ファインダーの出っ張り
        d.rectangle(
            [size // 3, pad, size // 3 + size // 4, pad + size // 6],
            fill=(37, 99, 235, 255),
        )
        # レンズ
        c = size / 2
        r = size * 0.21
        d.ellipse([c - r, c + size * 0.03 - r, c + r, c + size * 0.03 + r],
                  fill=(255, 255, 255, 255))
        return img

    frames = [frame(s) for s in (16, 24, 32, 48, 64)]
    frames[-1].save(path, format="ICO", sizes=[(f.width, f.height) for f in frames])
    return path


# --- ホットキー文字列の解析 -----------------------------------------------

_VK_NAMES = {
    "PRINTSCREEN": 0x2C, "PRTSC": 0x2C, "SNAPSHOT": 0x2C,
    "INSERT": 0x2D, "DELETE": 0x2E, "HOME": 0x24, "END": 0x23,
    "PAGEUP": 0x21, "PAGEDOWN": 0x22, "SPACE": 0x20, "TAB": 0x09,
    "ESC": 0x1B, "ESCAPE": 0x1B, "PAUSE": 0x13, "SCROLLLOCK": 0x91,
}
for _i in range(1, 25):
    _VK_NAMES[f"F{_i}"] = 0x6F + _i

_MODS = {
    "CTRL": MOD_CONTROL, "CONTROL": MOD_CONTROL,
    "ALT": MOD_ALT, "SHIFT": MOD_SHIFT, "WIN": MOD_WIN,
}


def parse_hotkey(spec: str) -> tuple[int, int]:
    """"Ctrl+Alt+S" -> (modifiers, virtual-key)。解析できなければ ValueError。"""
    mods = 0
    vk = None
    for part in (p.strip().upper() for p in spec.split("+") if p.strip()):
        if part in _MODS:
            mods |= _MODS[part]
        elif part in _VK_NAMES:
            vk = _VK_NAMES[part]
        elif len(part) == 1 and (part.isalpha() or part.isdigit()):
            vk = ord(part)
        else:
            raise ValueError(f"認識できないキー: {part}")
    if vk is None:
        raise ValueError(f"キーが指定されていません: {spec}")
    return mods | MOD_NOREPEAT, vk


# --- 常駐本体 -------------------------------------------------------------


class Tray:
    """隠しウィンドウ + トレイアイコン + ホットキー。

    呼び出し側は on_* コールバックと、メニュー表示に使う status() を渡す。
    """

    def __init__(self, *, hotkey: str, on_capture, on_viewer, on_folder,
                 on_toggle_pause, on_toggle_startup, on_quit, status):
        self.hotkey_spec = hotkey
        self.on_capture = on_capture
        self.on_viewer = on_viewer
        self.on_folder = on_folder
        self.on_toggle_pause = on_toggle_pause
        self.on_toggle_startup = on_toggle_startup
        self.on_quit = on_quit
        self.status = status  # () -> dict(count=int, paused=bool, startup=bool)

        self.hwnd = None
        self._nid = None
        self._wndproc = WNDPROC(self._on_message)  # GC されないよう保持する
        self._hotkey_ok = False

    # -- 起動 --

    def start(self) -> None:
        hinst = kernel32.GetModuleHandleW(None)

        wc = WNDCLASSEXW()
        wc.cbSize = ctypes.sizeof(WNDCLASSEXW)
        wc.lpfnWndProc = self._wndproc
        wc.hInstance = hinst
        wc.lpszClassName = WINDOW_CLASS
        if not user32.RegisterClassExW(ctypes.byref(wc)):
            raise OSError("ウィンドウクラスを登録できません")

        # 表示しないが、message-only ではなく通常ウィンドウにする。
        # message-only だと SetForegroundWindow が効かず、メニューが正しく閉じない。
        self.hwnd = user32.CreateWindowExW(
            0, WINDOW_CLASS, "shot", 0, 0, 0, 0, 0, None, None, hinst, None
        )
        if not self.hwnd:
            raise OSError("ウィンドウを作成できません")

        self._add_icon()
        self._register_hotkey()

    def _add_icon(self) -> None:
        hicon = user32.LoadImageW(
            None, str(ensure_icon()), IMAGE_ICON, 0, 0,
            LR_LOADFROMFILE | LR_DEFAULTSIZE,
        )
        nid = NOTIFYICONDATAW()
        nid.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
        nid.hWnd = self.hwnd
        nid.uID = 1
        nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP
        nid.uCallbackMessage = WM_TRAY
        nid.hIcon = hicon
        nid.szTip = f"shot — {self.hotkey_spec} / クリックで撮影"
        shell32.Shell_NotifyIconW(NIM_ADD, ctypes.byref(nid))
        self._nid = nid

    def _register_hotkey(self) -> None:
        try:
            mods, vk = parse_hotkey(self.hotkey_spec)
        except ValueError as e:
            self.notify("ホットキー設定エラー", f"{e}\nCtrl+Alt+S を使います。", warn=True)
            self.hotkey_spec = "Ctrl+Alt+S"
            mods, vk = parse_hotkey(self.hotkey_spec)

        if user32.RegisterHotKey(self.hwnd, HOTKEY_ID, mods, vk):
            self._hotkey_ok = True
            return

        # PrintScreen が Snipping Tool に取られている等。既定キーで再挑戦する。
        if self.hotkey_spec.upper().replace(" ", "") != "CTRL+ALT+S":
            mods, vk = parse_hotkey("Ctrl+Alt+S")
            if user32.RegisterHotKey(self.hwnd, HOTKEY_ID, mods, vk):
                self.notify(
                    "ホットキーを変更しました",
                    f"{self.hotkey_spec} は他のアプリが使用中です。Ctrl+Alt+S に切り替えました。",
                    warn=True,
                )
                self.hotkey_spec = "Ctrl+Alt+S"
                self._hotkey_ok = True
                return

        self.notify(
            "ホットキーを登録できません",
            "トレイアイコンのクリックでは撮影できます。",
            warn=True,
        )

    # -- 通知 --

    def notify(self, title: str, message: str, warn: bool = False) -> None:
        if not self._nid:
            return
        self._nid.uFlags = NIF_INFO
        self._nid.szInfoTitle = title[:63]
        self._nid.szInfo = message[:255]
        self._nid.dwInfoFlags = NIIF_WARNING if warn else NIIF_INFO
        shell32.Shell_NotifyIconW(NIM_MODIFY, ctypes.byref(self._nid))
        self._nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP

    def set_tip(self, text: str) -> None:
        if not self._nid:
            return
        self._nid.uFlags = NIF_TIP
        self._nid.szTip = text[:127]
        shell32.Shell_NotifyIconW(NIM_MODIFY, ctypes.byref(self._nid))
        self._nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP

    def refresh_tip(self) -> None:
        """別スレッドからでも安全にツールチップ更新を依頼する。"""
        if self.hwnd:
            user32.PostMessageW(self.hwnd, WM_REFRESH_TIP, 0, 0)

    # -- メッセージ処理 --

    def _on_message(self, hwnd, msg, wparam, lparam):
        if msg == WM_HOTKEY and wparam == HOTKEY_ID:
            self.on_capture("hotkey")
            return 0
        if msg == WM_TRAY:
            event = lparam & 0xFFFF
            if event == WM_LBUTTONUP:
                self.on_capture("tray")
            elif event == WM_RBUTTONUP:
                self._show_menu()
            return 0
        if msg == WM_REFRESH_TIP:
            st = self.status()
            state = "（一時停止中）" if st["paused"] else ""
            self.set_tip(f"shot — 今日 {st['count']} 枚{state}")
            return 0
        if msg == WM_COMMAND:
            self._invoke(wparam & 0xFFFF)
            return 0
        if msg == WM_DESTROY:
            user32.PostQuitMessage(0)
            return 0
        return user32.DefWindowProcW(hwnd, msg, wparam, lparam)

    def _show_menu(self) -> None:
        st = self.status()
        menu = user32.CreatePopupMenu()
        user32.AppendMenuW(menu, MF_STRING, ID_CAPTURE,
                           f"スクリーンショットを撮る\t{self.hotkey_spec}")
        user32.AppendMenuW(menu, MF_STRING, ID_VIEWER, "編集ビューを開く")
        user32.AppendMenuW(menu, MF_STRING, ID_FOLDER, "保存フォルダを開く")
        user32.AppendMenuW(menu, MF_SEPARATOR, 0, None)
        user32.AppendMenuW(menu, MF_STRING | MF_GRAYED, ID_COUNT,
                           f"今日の枚数：{st['count']} 枚")
        user32.AppendMenuW(menu, MF_STRING, ID_PAUSE,
                           "キャプチャを再開" if st["paused"] else "キャプチャを一時停止")
        user32.AppendMenuW(menu, MF_STRING, ID_STARTUP,
                           ("✓ " if st["startup"] else "") + "スタートアップに登録")
        user32.AppendMenuW(menu, MF_SEPARATOR, 0, None)
        user32.AppendMenuW(menu, MF_STRING, ID_QUIT, "終了")

        pt = wintypes.POINT()
        user32.GetCursorPos(ctypes.byref(pt))
        # これを呼ばないと、メニュー外をクリックしても閉じない（Win32 の古い仕様）
        user32.SetForegroundWindow(self.hwnd)
        cmd = user32.TrackPopupMenu(
            menu, TPM_RIGHTBUTTON | TPM_RETURNCMD, pt.x, pt.y, 0, self.hwnd, None
        )
        user32.PostMessageW(self.hwnd, WM_NULL, 0, 0)
        user32.DestroyMenu(menu)
        if cmd:
            self._invoke(cmd)

    def _invoke(self, cmd: int) -> None:
        if cmd == ID_CAPTURE:
            self.on_capture("menu")
        elif cmd == ID_VIEWER:
            self.on_viewer()
        elif cmd == ID_FOLDER:
            self.on_folder()
        elif cmd == ID_PAUSE:
            self.on_toggle_pause()
            self.refresh_tip()
        elif cmd == ID_STARTUP:
            self.on_toggle_startup()
        elif cmd == ID_QUIT:
            self.stop()

    # -- ループと終了 --

    def run(self) -> None:
        msg = wintypes.MSG()
        while True:
            r = user32.GetMessageW(ctypes.byref(msg), None, 0, 0)
            if r == 0 or r == -1:
                break
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))

    def stop(self) -> None:
        self.on_quit()
        if self._hotkey_ok:
            user32.UnregisterHotKey(self.hwnd, HOTKEY_ID)
        if self._nid:
            shell32.Shell_NotifyIconW(NIM_DELETE, ctypes.byref(self._nid))
            self._nid = None
        if self.hwnd:
            user32.DestroyWindow(self.hwnd)
            self.hwnd = None
