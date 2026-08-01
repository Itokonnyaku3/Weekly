import sys
from pathlib import Path

# tools/shot/ を import できるようにする（各モジュールは同一フォルダ内で完結している）
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
