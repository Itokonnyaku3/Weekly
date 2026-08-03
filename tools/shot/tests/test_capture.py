"""撮影範囲の決め方。Win32 を叩くので Windows 上でのみ意味がある。"""

import pytest

import capture


# --- 矩形の交差 -----------------------------------------------------------


@pytest.mark.parametrize(
    "a,b,expected",
    [
        # 一部が重なる
        ((0, 0, 100, 100), (50, 50, 100, 100), (50, 50, 50, 50)),
        # 完全に内側
        ((10, 10, 20, 20), (0, 0, 100, 100), (10, 10, 20, 20)),
        # まったく重ならない
        ((0, 0, 10, 10), (20, 20, 10, 10), None),
        # 辺で接するだけ（幅0）は無しとみなす
        ((0, 0, 10, 10), (10, 0, 10, 10), None),
        # 画面外へはみ出したウィンドウ
        ((-50, -30, 200, 150), (0, 0, 1920, 1080), (0, 0, 150, 120)),
    ],
)
def test_矩形の交差を求める(a, b, expected):
    assert capture.intersect(a, b) == expected


# --- モニタ ---------------------------------------------------------------


def test_モニタが1台以上見つかる():
    monitors = capture.list_monitors()
    assert monitors
    assert all(w > 0 and h > 0 for _, _, w, h in (m.rect for m in monitors))


def test_主モニタはちょうど1台():
    assert sum(1 for m in capture.list_monitors() if m.primary) == 1


def test_モニタの番号は1から連番():
    monitors = capture.list_monitors()
    assert [m.index for m in monitors] == list(range(1, len(monitors) + 1))


def test_モニタの並び順は毎回同じ():
    assert [m.rect for m in capture.list_monitors()] == [
        m.rect for m in capture.list_monitors()
    ]


# --- 撮影範囲の解決 -------------------------------------------------------


def test_全モニタ指定は仮想画面と一致する():
    assert capture.screen_rect("virtual") == capture.virtual_rect()


def test_主モニタ指定は原点から始まる():
    x, y, w, h = capture.screen_rect("primary")
    assert (x, y) == (0, 0)
    assert w > 0 and h > 0


def test_モニタ番号を指定できる():
    first = capture.list_monitors()[0]
    assert capture.screen_rect(f"monitor:{first.index}") == first.rect


@pytest.mark.parametrize(
    "area",
    ["monitor:99", "monitor:abc", "monitor:", "でたらめ", ""],
)
def test_解決できない指定は全モニタとして扱う(area):
    # 撮れないより全体を撮るほうがよい
    assert capture.screen_rect(area) == capture.virtual_rect()


def test_旧称のactiveも受け付ける():
    # 以前は「カーソルのあるモニタ」を active と呼んでいた。
    # 既存の config.json をそのまま動かすために残している。
    assert capture.screen_rect("active") == capture.screen_rect("cursor")


def test_カーソルのあるモニタは仮想画面の内側():
    rect = capture.screen_rect("cursor")
    assert capture.intersect(rect, capture.virtual_rect()) == rect


# --- ウィンドウ -----------------------------------------------------------


@pytest.mark.parametrize("hwnd", [0, None, 12345678])
def test_無効なウィンドウは撮影対象にしない(hwnd):
    assert capture.is_capturable_window(hwnd) is False


def test_ウィンドウ指定で取れなければ他の範囲に落ちる():
    # 撮れない相手を渡しても例外にせず、必ず何か撮れる範囲を返す
    rect = capture.screen_rect("window", window=0)
    assert capture.intersect(rect, capture.virtual_rect()) == rect


def test_タスクバーは撮影対象にしない():
    from winapi import user32

    taskbar = user32.FindWindowW("Shell_TrayWnd", None)
    if not taskbar:
        pytest.skip("タスクバーが見つかりません")
    assert capture.is_capturable_window(taskbar) is False
