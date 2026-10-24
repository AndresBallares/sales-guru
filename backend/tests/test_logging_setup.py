"""The app's own loggers reach the process output at INFO.

Found after #100 shipped: the app configured no logging, so the root logger sat
at WARNING and every ``llm_usage`` / ``llm_repair`` INFO line was dropped in
production (it only appeared in tests, whose caplog sets the level itself).
"""

import io
import logging
import os
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.core.config import Settings
from app.core.log_config import LIBRARY_LOGGERS, configure_logging
from app.services.llm_usage import create_logged

_MANAGED = ["app", *LIBRARY_LOGGERS]


@pytest.fixture(autouse=True)
def _restore_logging() -> Iterator[None]:
    """Undo whatever a test configured so no test leaks into another."""
    saved = {
        name: (logging.getLogger(name).level, list(logging.getLogger(name).handlers))
        for name in _MANAGED
    }
    yield
    for name, (level, handlers) in saved.items():
        logger = logging.getLogger(name)
        logger.setLevel(level)
        logger.handlers[:] = handlers


def _response() -> Any:
    usage = SimpleNamespace(
        input_tokens=10,
        output_tokens=5,
        cache_creation_input_tokens=0,
        cache_read_input_tokens=0,
        output_tokens_details=SimpleNamespace(thinking_tokens=0),
    )
    return SimpleNamespace(content=[], usage=usage, stop_reason="tool_use")


async def _one_call() -> None:
    client: Any = SimpleNamespace(
        messages=SimpleNamespace(create=AsyncMock(return_value=_response()))
    )
    await create_logged(
        client,
        agent="optimizer",
        call_type="optimizer_eval",
        campaign_id="camp_1",
        model="claude-haiku-5-5",
    )


@pytest.mark.asyncio
async def test_an_llm_usage_line_is_written_at_info_once_configured() -> None:
    out = io.StringIO()
    configure_logging("INFO", stream=out)

    await _one_call()

    line = out.getvalue()
    assert "llm_usage" in line
    assert "call_type=optimizer_eval" in line
    assert "model=claude-haiku-5-5" in line


@pytest.mark.asyncio
async def test_without_configuration_the_same_line_is_dropped() -> None:
    """The bug itself: root at WARNING, no handler, nothing is written."""
    out = io.StringIO()
    logging.getLogger("app").setLevel(logging.NOTSET)
    handler = logging.StreamHandler(out)
    logging.getLogger().addHandler(handler)
    try:
        await _one_call()
    finally:
        logging.getLogger().removeHandler(handler)

    assert "llm_usage" not in out.getvalue()


def test_the_app_logger_level_follows_the_argument() -> None:
    configure_logging("WARNING", stream=io.StringIO())

    assert logging.getLogger("app").level == logging.WARNING


@pytest.mark.asyncio
async def test_a_higher_level_silences_the_info_line() -> None:
    out = io.StringIO()
    configure_logging("WARNING", stream=out)

    await _one_call()

    assert "llm_usage" not in out.getvalue()


def test_the_level_is_case_insensitive() -> None:
    configure_logging("debug", stream=io.StringIO())

    assert logging.getLogger("app").level == logging.DEBUG


def test_an_unknown_level_falls_back_to_info_and_says_so() -> None:
    out = io.StringIO()

    configure_logging("LOUD", stream=out)

    assert logging.getLogger("app").level == logging.INFO
    assert "LOUD" in out.getvalue()


def test_library_loggers_stay_at_warning() -> None:
    for name in LIBRARY_LOGGERS:
        logging.getLogger(name).setLevel(logging.NOTSET)

    configure_logging("DEBUG", stream=io.StringIO())

    assert {"httpx", "httpcore", "anthropic", "apscheduler"} <= set(LIBRARY_LOGGERS)
    for name in LIBRARY_LOGGERS:
        assert logging.getLogger(name).level == logging.WARNING


def test_calling_it_twice_adds_one_handler_not_two() -> None:
    first, second = io.StringIO(), io.StringIO()

    configure_logging("INFO", stream=first)
    configure_logging("INFO", stream=second)

    ours = [
        h for h in logging.getLogger("app").handlers if getattr(h, "_sales_guru", False)
    ]
    assert len(ours) == 1


@pytest.mark.asyncio
async def test_a_line_is_written_once_even_with_a_root_handler_present() -> None:
    """Records propagate to the root (so pytest's caplog keeps working); the
    app handler must not make a second copy of each line on its own."""
    out = io.StringIO()
    configure_logging("INFO", stream=out)

    await _one_call()

    assert out.getvalue().count("llm_usage agent=") == 1


def test_the_level_comes_from_the_log_level_setting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("LOG_LEVEL", raising=False)
    assert Settings(_env_file=None).log_level == "INFO"

    monkeypatch.setenv("LOG_LEVEL", "debug")
    assert Settings(_env_file=None).log_level == "debug"


def test_importing_the_app_configures_logging() -> None:
    """app.main is what Render runs, so it is where the call has to be.

    Run in a fresh interpreter: the test process has already imported the app
    and its logging is shared with every other test.
    """
    script = (
        "import logging, app.main;"
        "lg = logging.getLogger('app');"
        "print(logging.getLevelName(lg.level),"
        " any(getattr(h, '_sales_guru', False) for h in lg.handlers))"
    )
    env = {k: v for k, v in os.environ.items() if k != "LOG_LEVEL"}

    result = subprocess.run(  # noqa: S603
        [sys.executable, "-c", script],
        cwd=Path(__file__).resolve().parent.parent,
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )

    assert result.stdout.split()[-2:] == ["INFO", "True"]
