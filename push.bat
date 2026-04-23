@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo [1/4] ロックファイルを削除中...
del /f /q ".git\HEAD.lock" 2>nul
del /f /q ".git\index.lock" 2>nul
del /f /q ".git\refs\remotes\origin\main.lock" 2>nul
del /f /q ".git\COMMIT_EDITMSG.lock" 2>nul

echo [2/4] 変更をステージ中...
git add app.js style.css project-weekly-tracker.html sw.js

echo [3/4] コミット中...
for /f "tokens=*" %%i in ('git diff --cached --name-only') do set CHANGED=%%i
set TIMESTAMP=%date:~0,4%-%date:~5,2%-%date:~8,2% %time:~0,8%
git commit -m "chore: auto-commit %TIMESTAMP%"

echo [4/4] プッシュ中...
git push

echo.
echo 完了しました。このウィンドウを閉じてください。
pause
