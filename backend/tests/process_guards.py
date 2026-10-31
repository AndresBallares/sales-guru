"""Guards that keep a pytest run from hanging or colliding with another run.

Imported by tests/conftest.py before anything starts a subprocess.
"""

import signal


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
