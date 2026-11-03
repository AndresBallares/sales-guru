"""The owner's research access script (Phase 7b), run against the test database."""

import importlib.util
import json
from pathlib import Path
from types import ModuleType

import pytest
from app.main import app
from fastapi.testclient import TestClient

from tests.research_helpers import setup_business, sql

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "research_access.py"


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("research_access_script", _SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _business() -> str:
    # A short-lived app client: it disconnects the shared database client on exit,
    # so the script can connect its own, as it does from a shell.
    with TestClient(app) as app_client:
        return setup_business(app_client)


def _settings(business_id: str) -> tuple[list[str], int]:
    models, per_month = sql(
        "SELECT allowedResearchModels, researchRunsPerMonth FROM Business WHERE id = ?",
        business_id,
    )[0]
    return json.loads(models), per_month


def test_the_script_shows_then_changes_the_settings(
    capfd: pytest.CaptureFixture[str],
) -> None:
    business_id = _business()
    script = _load()
    assert script.main(["--business-id", business_id, "--show"]) == 0
    shown = capfd.readouterr().out
    assert "test.db" in shown
    assert "claude-opus-5-5" in shown
    assert (
        script.main(
            [
                "--business-id",
                business_id,
                "--models",
                "claude-opus-5-5, claude-fable-5-1",
                "--runs-per-month",
                "3",
            ]
        )
        == 0
    )
    assert _settings(business_id) == (["claude-opus-5-5", "claude-fable-5-1"], 3)
    assert "After:" in capfd.readouterr().out


def test_the_script_rejects_a_bad_value_and_an_unknown_business(
    capfd: pytest.CaptureFixture[str],
) -> None:
    business_id = _business()
    script = _load()
    assert script.main(["--business-id", business_id, "--models", "gpt-9"]) == 1
    assert "Unknown research model" in capfd.readouterr().out
    assert _settings(business_id) == (["claude-opus-5-5"], 1)
    assert script.main(["--business-id", "nope", "--show"]) == 1
    assert script.main(["--business-id", "nope", "--runs-per-month", "2"]) == 1


def test_show_cannot_be_combined_with_a_change() -> None:
    with pytest.raises(SystemExit):
        _load().main(["--business-id", "x", "--show", "--runs-per-month", "2"])
