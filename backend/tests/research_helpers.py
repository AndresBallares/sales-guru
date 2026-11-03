"""Shared helpers for the research runner and start-endpoint tests (Phase 7b)."""

import copy
import sqlite3
import time
from collections.abc import Awaitable, Callable
from functools import partial
from typing import Any

import httpx2
from app.core.db import db
from app.services.research_client import Observation, Phase, Turn
from app.services.research_fakes import (
    BRAND_PAGE,
    COMPETITOR_PAGE,
    VOICE_URLS,
    canned_avatars,
    canned_findings,
    fake_usage,
    fetch_observation,
    search_observation,
    submit_turn,
)
from fastapi.testclient import TestClient

from tests.db_cleanup import database_path_for_tests

ScriptItem = Turn | BaseException | Callable[["Call"], Awaitable[Turn] | Turn]


class Call:
    """One request the runner made to the (scripted) client."""

    def __init__(self, **kwargs: Any) -> None:  # noqa: ANN401
        self.model: str = kwargs["model"]
        self.system: list[dict[str, Any]] = kwargs["system"]
        self.messages: list[dict[str, Any]] = copy.deepcopy(kwargs["messages"])
        self.tools: list[dict[str, Any]] = copy.deepcopy(kwargs["tools"])
        self.max_tokens: int = kwargs["max_tokens"]
        self.phase: Phase = kwargs["phase"]
        self.step: int = kwargs["step"]

    def tool(self, name: str) -> dict[str, Any] | None:
        return next((t for t in self.tools if t["name"] == name), None)

    def user_texts(self) -> list[str]:
        """Every plain text block of every user message (not tool results)."""
        texts: list[str] = []
        for message in self.messages:
            if message["role"] != "user":
                continue
            content = message["content"]
            blocks = (
                content
                if isinstance(content, list)
                else [{"type": "text", "text": content}]
            )
            texts += [b["text"] for b in blocks if b.get("type") == "text"]
        return texts


class Scripted:
    """A ``ResearchClient`` that plays a fixed script and records every request."""

    def __init__(
        self,
        script: list[ScriptItem],
        on_turn: Callable[[int], None] | None = None,
    ) -> None:
        self.script = list(script)
        self.calls: list[Call] = []
        self.on_turn = on_turn

    async def turn(self, **kwargs: Any) -> Turn:  # noqa: ANN401
        self.calls.append(Call(**kwargs))
        n = len(self.calls)
        if self.on_turn is not None:
            self.on_turn(n)
        if n > len(self.script):
            raise AssertionError(f"unexpected request #{n} in phase {kwargs['phase']}")
        item = self.script[n - 1]
        if isinstance(item, BaseException):
            raise item
        if isinstance(item, Turn):
            return item
        result = item(self.calls[-1])
        if isinstance(result, Turn):
            return result
        return await result


def brand_turn(*, searches: int = 0, fetches: int = 2) -> Turn:
    return Turn(
        observations=[
            fetch_observation(BRAND_PAGE),
            fetch_observation(COMPETITOR_PAGE),
        ],
        usage=fake_usage(searches=searches, fetches=fetches, cache_read=2_000),
    )


def voice_turn(urls: list[str] | None = None, *, searches: int = 4) -> Turn:
    return Turn(
        observations=[
            search_observation(u) for u in (urls if urls is not None else VOICE_URLS)
        ],
        usage=fake_usage(searches=searches, cache_read=8_000),
    )


def findings_turn(payload: dict[str, Any] | None = None, **turn_kwargs: Any) -> Turn:  # noqa: ANN401
    turn = submit_turn("submit_findings", payload or canned_findings().model_dump())
    for key, value in turn_kwargs.items():
        setattr(turn, key, value)
    return turn


def avatars_turn(payload: dict[str, Any] | None = None, **turn_kwargs: Any) -> Turn:  # noqa: ANN401
    turn = submit_turn("submit_avatars", payload or canned_avatars().model_dump())
    for key, value in turn_kwargs.items():
        setattr(turn, key, value)
    return turn


def healthy_script() -> list[ScriptItem]:
    return [brand_turn(), voice_turn(), findings_turn(), avatars_turn()]


def transient_error_turn(code: str = "too_many_requests") -> Turn:
    return Turn(
        observations=[Observation("search", error_code=code)],
        usage=fake_usage(),
    )


# --- database and API plumbing ------------------------------------------------


def pcall(client: TestClient, fn: Callable[..., Awaitable[Any]], **kwargs: Any) -> Any:  # noqa: ANN401
    """Run a coroutine function on the app's event loop (where ``db`` is connected)."""
    portal = client.portal
    assert portal is not None
    return portal.call(partial(fn, **kwargs))


def sql(query: str, *params: object) -> list[tuple[Any, ...]]:
    connection = sqlite3.connect(database_path_for_tests())
    try:
        rows = connection.execute(query, params).fetchall()
        connection.commit()
        return rows
    finally:
        connection.close()


def dump_database() -> str:
    connection = sqlite3.connect(database_path_for_tests())
    try:
        return "\n".join(connection.iterdump())
    finally:
        connection.close()


def setup_business(client: TestClient, email: str = "owner@example.com") -> str:
    client.post(
        "/auth/signup",
        json={"email": email, "password": "supersecret123", "termsAccepted": True},
    )
    business_id: str = client.post(
        "/businesses", json={"name": "Acme", "industry": "FASHION_JEWELRY"}
    ).json()["id"]
    return business_id


def start(client: TestClient, business_id: str, **body: object) -> httpx2.Response:
    payload = {
        "depth": "light",
        "model": "claude-opus-5-5",
        "competitorUrls": [COMPETITOR_PAGE],
        **body,
    }
    return client.post(f"/businesses/{business_id}/research-runs", json=payload)


def wait_done(
    client: TestClient, business_id: str, run_id: str, seconds: float = 20.0
) -> dict[str, Any]:
    deadline = time.monotonic() + seconds
    while True:
        run: dict[str, Any] = client.get(
            f"/businesses/{business_id}/research-runs/{run_id}"
        ).json()
        if run["status"] not in ("QUEUED", "RUNNING"):
            return run
        if time.monotonic() > deadline:
            raise AssertionError(f"run still {run['status']} after {seconds}s")
        time.sleep(0.02)


def run_to_end(client: TestClient, business_id: str, **body: object) -> dict[str, Any]:
    response = start(client, business_id, **body)
    assert response.status_code == 202, response.text
    return wait_done(client, business_id, response.json()["id"])


__all__ = ["db"]
