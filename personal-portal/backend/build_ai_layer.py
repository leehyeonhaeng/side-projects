"""ai Lambda 레이어 빌드: Lambda(arm64, Python 3.12)용 휠을 받아 infra/envs/<env>/.build/ai-layer/python 에 설치한다.

사용: python build_ai_layer.py [dev]   (Windows·CI 공통)
"""

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
env = sys.argv[1] if len(sys.argv) > 1 else "dev"
target = ROOT.parent / "infra" / "envs" / env / ".build" / "ai-layer" / "python"

shutil.rmtree(target.parent, ignore_errors=True)
target.mkdir(parents=True)
subprocess.run(
    [
        sys.executable, "-m", "pip", "install", "-q",
        "-r", str(ROOT / "requirements-ai.txt"),
        "--target", str(target),
        "--platform", "manylinux2014_aarch64",
        "--implementation", "cp",
        "--python-version", "3.12",
        "--only-binary=:all:",
        "--upgrade",
    ],
    check=True,
)
# 레이어 크기 줄이기: 캐시·메타데이터 정리
for p in target.rglob("__pycache__"):
    shutil.rmtree(p, ignore_errors=True)
print(f"built {target}")
