# shot をスタートアップに登録／解除する。
#   登録: powershell -ExecutionPolicy Bypass -File install_startup.ps1
#   解除: powershell -ExecutionPolicy Bypass -File install_startup.ps1 -Remove
#
# pythonw.exe で起動するのでコンソール窓は出ない。

param([switch]$Remove)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$lnk = Join-Path $startup 'shot.lnk'

if ($Remove) {
    if (Test-Path $lnk) {
        Remove-Item $lnk -Force
        Write-Output "解除しました: $lnk"
    } else {
        Write-Output '登録されていません'
    }
    exit 0
}

# コンソール窓を出さない pythonw.exe を探す
$pyw = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
if (-not $pyw) {
    $py = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
    if (-not $py) { throw 'Python が見つかりません' }
    $candidate = Join-Path (Split-Path -Parent $py) 'pythonw.exe'
    if (Test-Path $candidate) { $pyw = $candidate } else { $pyw = $py }
}

if (-not (Test-Path $startup)) { New-Item -ItemType Directory -Path $startup -Force | Out-Null }

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($lnk)
$sc.TargetPath = $pyw
$sc.Arguments = '"' + (Join-Path $here 'shot.py') + '"'
$sc.WorkingDirectory = $here
$sc.IconLocation = Join-Path $here 'icon.ico'
$sc.Description = 'shot - スクリーンショット常駐'
$sc.Save()

Write-Output "登録しました: $lnk"
Write-Output "  -> $pyw $($sc.Arguments)"
