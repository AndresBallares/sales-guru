"""Guards the same-site API setup in render.yaml (2026-10-21).

iOS Safari never keeps a cookie set by a different site, and the frontend and backend
are different onrender.com subdomains, so the frontend calls /api on its own address
and Render rewrites that to the backend. These checks read the blueprint as text (it
needs no YAML library) and fail if that wiring is lost.
"""

import re
from pathlib import Path

BLUEPRINT = Path(__file__).resolve().parents[2] / "render.yaml"


def _frontend_block() -> str:
    text = BLUEPRINT.read_text()
    start = text.index("name: sales-guru-frontend")
    return text[start:]


def test_frontend_calls_the_api_on_its_own_address() -> None:
    """VITE_API_URL is the relative /api, not the backend's absolute URL."""
    match = re.search(r"key: VITE_API_URL\s+value: (\S+)", _frontend_block())

    assert match is not None
    assert match.group(1) == "/api"


def test_api_rewrite_forwards_to_the_backend_before_the_catch_all() -> None:
    """/api/* is rewritten to the backend, and ahead of the index.html catch-all."""
    block = _frontend_block()
    api = re.search(r"- type: rewrite\s+source: /api/\*\s+destination: (\S+)", block)
    catch_all = block.index("source: /*")

    assert api is not None
    assert api.group(1) == "https://sales-guru-backend.onrender.com/*"
    assert api.start() < catch_all


def test_meta_callback_is_documented_behind_the_frontend_address() -> None:
    """The callback comes back through /api so the session cookie arrives with it."""
    text = BLUEPRINT.read_text()

    assert "https://sales-guru-frontend.onrender.com/api/meta/callback" in text
