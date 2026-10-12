#!/usr/bin/env python3
"""Run only the backend tests related to the files git is committing.

Pre-commit hook helper. The full suite (with the 90% coverage gate) takes
~9 minutes, so CI is the full gate; at commit time we only run:
  * any staged test file under backend/tests, and
  * any test that mentions a staged backend/app module (by dotted path, or by
    ``from <package> import <module>``).
Shared inputs that can affect everything (conftest, prisma, pyproject, lock)
are left to CI rather than triggering the whole suite on every commit.
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"


def main() -> int:
    """Select and run the related tests; return pytest's exit code."""
    files = sys.argv[1:]
    tests: set[Path] = set()
    modules: list[tuple[str, str, str]] = []  # (dotted, package, name)
    for f in files:
        path = Path(f)
        rel = path.relative_to("backend") if path.parts[0] == "backend" else path
        if rel.parts[0] == "tests" and rel.name.startswith("test_"):
            if (BACKEND / rel).exists():
                tests.add(BACKEND / rel)
        elif rel.parts[0] == "app" and rel.suffix == ".py" and rel.name != "__init__.py":
            dotted = ".".join(rel.with_suffix("").parts)
            modules.append((dotted, dotted.rsplit(".", 1)[0], rel.stem))
    if modules:
        patterns = [
            re.compile(
                rf"\b{re.escape(d)}\b|from\s+{re.escape(p)}\s+import[^\n]*\b{re.escape(n)}\b"
            )
            for d, p, n in modules
        ]
        for test in (BACKEND / "tests").rglob("test_*.py"):
            text = test.read_text()
            if any(p.search(text) for p in patterns):
                tests.add(test)
    if not tests:
        print("No related backend tests for the staged files; CI runs the full suite.")
        return 0
    names = sorted(str(t.relative_to(BACKEND)) for t in tests)
    print(f"Running {len(names)} related backend test file(s).")
    cmd = ["uv", "run", "pytest", *names, "--no-cov", "-q", "-p", "no:cacheprovider"]
    return subprocess.call(cmd, cwd=BACKEND)


if __name__ == "__main__":
    sys.exit(main())
