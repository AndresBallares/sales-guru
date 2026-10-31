"""Guards that keep a pytest run from hanging or colliding with another run.

Imported by tests/conftest.py before anything starts a subprocess.
"""

import fcntl
import signal
from pathlib import Path
from typing import IO


def restore_default_sigint() -> None:
    """Make SIGINT deadly again if this process was started ignoring it.

    A non-interactive shell starts background jobs with SIGINT ignored, and
    child processes inherit that. Prisma stops its query engine by sending
    SIGINT and then waiting with no timeout, so an engine that ignores it
    hangs the whole run (2026-10-31: a background pytest sat at 0% CPU on
    its first test until killed). Python leaves an inherited SIG_IGN alone,
    so put its normal handler back; a handler is not inherited across exec,
    which lets the engine start with the default disposition. A handler
    someone installed on purpose is left as it is.
    """
    if signal.getsignal(signal.SIGINT) is signal.SIG_IGN:
        signal.signal(signal.SIGINT, signal.default_int_handler)


class DatabaseBusyError(RuntimeError):
    """Another pytest run already holds the shared test database."""


def acquire_database_lock(lock_path: Path) -> IO[bytes]:
    """Take the exclusive lock on the shared test.db, or fail at once.

    Two runs on one SQLite file reset it under each other and stall or fail in
    confusing ways (it has happened twice). The lock is an flock, which the
    operating system drops when the holder exits or dies, so a crashed run
    never leaves a stale lock behind. Keep the returned handle open for as
    long as the run lasts.

    Raises:
        DatabaseBusyError: If another run holds the lock.
    """
    handle = lock_path.open("ab")
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        handle.close()
        raise DatabaseBusyError(
            f"another pytest run is using the shared test database "
            f"(lock: {lock_path}). Wait for it to finish, or stop it, then try "
            f"again; two runs at once corrupt each other."
        ) from None
    return handle
