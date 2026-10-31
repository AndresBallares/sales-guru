"""Tests for tests/process_guards.py: the pytest process must not hang or collide.

Each case runs in a child interpreter, because the thing under test is how a
process starts (which signals it ignores), not something a test can change for
the pytest process it is running in.
"""

import subprocess
import sys
from pathlib import Path

import pytest

from tests.process_guards import DatabaseBusyError, acquire_database_lock

_BACKEND_ROOT = Path(__file__).resolve().parent.parent

# A shell starts background jobs with SIGINT ignored and children inherit that.
# Prisma stops its query engine by sending SIGINT and waiting with no timeout,
# so an engine that ignores it hangs the run forever. The property that matters
# is that a process started *after* the guard runs still dies on SIGINT.
_IGNORED_SIGINT = """
import signal, subprocess, sys
signal.signal(signal.SIGINT, signal.SIG_IGN)
from tests.process_guards import restore_default_sigint
restore_default_sigint()
child = subprocess.Popen(["sleep", "30"])
child.send_signal(signal.SIGINT)
try:
    child.wait(timeout=5)
except subprocess.TimeoutExpired:
    child.kill()
    sys.exit("a child started after the guard still ignores SIGINT")
"""

_CUSTOM_HANDLER = """
import signal, sys
def mine(signum, frame): pass
signal.signal(signal.SIGINT, mine)
from tests.process_guards import restore_default_sigint
restore_default_sigint()
sys.exit(0 if signal.getsignal(signal.SIGINT) is mine else "replaced a handler")
"""


def _run(script: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-c", script],
        cwd=_BACKEND_ROOT,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )


def test_children_die_on_sigint_after_the_guard_runs_with_it_ignored() -> None:
    result = _run(_IGNORED_SIGINT)
    assert result.returncode == 0, result.stderr


def test_the_guard_leaves_a_handler_someone_installed_alone() -> None:
    result = _run(_CUSTOM_HANDLER)
    assert result.returncode == 0, result.stderr


def test_a_second_holder_of_the_database_lock_is_refused_with_a_clear_message(
    tmp_path: Path,
) -> None:
    lock = tmp_path / "test.db.lock"
    first = acquire_database_lock(lock)

    with pytest.raises(DatabaseBusyError, match="another pytest run"):
        acquire_database_lock(lock)

    first.close()


def test_the_lock_is_free_again_once_its_holder_lets_go(tmp_path: Path) -> None:
    lock = tmp_path / "test.db.lock"
    acquire_database_lock(lock).close()

    acquire_database_lock(lock).close()


def test_a_second_pytest_run_stops_before_it_can_touch_the_database() -> None:
    # This run holds the real lock, so a child run must fail fast, not reset
    # test.db underneath us.
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "tests/test_db_cleanup.py", "--no-cov", "-q"],
        cwd=_BACKEND_ROOT,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )

    assert result.returncode != 0
    assert "another pytest run" in result.stdout + result.stderr
    assert "passed" not in result.stdout
