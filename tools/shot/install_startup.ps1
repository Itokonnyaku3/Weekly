# Register / unregister "shot" in the Windows Startup folder.
#   register:   powershell -ExecutionPolicy Bypass -File install_startup.ps1
#   unregister: powershell -ExecutionPolicy Bypass -File install_startup.ps1 -Remove
#
# Launched with pythonw.exe so no console window appears.
#
# NOTE: This file is intentionally ASCII only. Windows PowerShell 5.1 reads a
# .ps1 without a BOM as ANSI (cp932 here), which corrupts non-ASCII text and
# breaks parsing. Keeping it ASCII removes the dependency on the BOM surviving
# edits and version control.

param([switch]$Remove)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$lnk = Join-Path $startup 'shot.lnk'

if ($Remove) {
    if (Test-Path $lnk) {
        Remove-Item $lnk -Force
        Write-Output "Removed: $lnk"
    } else {
        Write-Output 'Not registered.'
    }
    exit 0
}

# Prefer pythonw.exe: it has no console window.
$pyw = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
if (-not $pyw) {
    $py = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
    if (-not $py) { throw 'Python not found.' }
    $candidate = Join-Path (Split-Path -Parent $py) 'pythonw.exe'
    if (Test-Path $candidate) { $pyw = $candidate } else { $pyw = $py }
}

if (-not (Test-Path $startup)) {
    New-Item -ItemType Directory -Path $startup -Force | Out-Null
}

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($lnk)
$sc.TargetPath = $pyw
$sc.Arguments = '"' + (Join-Path $here 'shot.py') + '"'
$sc.WorkingDirectory = $here
$sc.IconLocation = Join-Path $here 'icon.ico'
$sc.Description = 'shot - screenshot daemon'
$sc.Save()

Write-Output "Registered: $lnk"
Write-Output "  -> $pyw $($sc.Arguments)"
