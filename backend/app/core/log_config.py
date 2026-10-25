"""Make the app's own log lines reach the process output.

Until this existed the app configured no logging at all. Python's root logger
defaults to WARNING and uvicorn only configures its own loggers, so every INFO
line the app wrote — notably the ``llm_usage`` and ``llm_repair`` lines that
report what each agent call cost (app/services/llm_usage.py) — was silently
dropped in production. They only ever appeared in tests, where pytest's caplog
sets the level itself. Found 2026-10-24 when the logs were searched after #100
shipped.

Only the ``app`` logger is raised: libraries stay at WARNING, so the platform's
log stream isn't flooded with an HTTP client line per Anthropic request or a
scheduler line per job run.
"""

import logging
import sys
from typing import TextIO

# Third-party loggers that write INFO per request or per job run.
LIBRARY_LOGGERS = ("httpx", "httpcore", "anthropic", "apscheduler", "prisma")

_FORMAT = "%(levelname)s:     %(name)s: %(message)s"


class _AppHandler(logging.StreamHandler):  # type: ignore[type-arg]
    """The one handler this module owns, so a repeat call can replace it."""

    _sales_guru = True


def configure_logging(level: str = "INFO", stream: TextIO | None = None) -> None:
    """Send the ``app`` loggers' output to ``stream`` at ``level``.

    Idempotent: calling it again replaces the app's handler instead of stacking
    a second one. Records still propagate to the root logger, so test tooling
    that listens there keeps working; the root has no handler in production, so
    nothing is printed twice.

    Args:
        level: A logging level name (case-insensitive), e.g. the ``LOG_LEVEL``
            setting. An unknown name falls back to INFO and says so.
        stream: Where to write. Defaults to stdout, which is what Render
            captures.
    """
    requested = level.strip().upper()
    known = logging.getLevelNamesMapping()
    resolved = requested if requested in known else "INFO"

    logger = logging.getLogger("app")
    for existing in [h for h in logger.handlers if getattr(h, "_sales_guru", False)]:
        logger.removeHandler(existing)
    handler = _AppHandler(stream if stream is not None else sys.stdout)
    handler.setFormatter(logging.Formatter(_FORMAT))
    logger.addHandler(handler)
    logger.setLevel(known[resolved])

    for name in LIBRARY_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)

    if resolved != requested:
        logger.warning("Unknown LOG_LEVEL %r; using INFO", level)
