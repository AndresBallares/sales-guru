"""One-time (re-runnable) tool for curating app/services/interests.py's data.

PRD.md build step 5 "Phase C", confirmed 2026-09-02. Two subcommands:

    discover   Search Meta's real ad-interest taxonomy for a set of
               jewelry-related seed terms and print the raw candidates,
               for a human to review and hand-pick into
               app/data/jewelry_interests.json. Never writes the data
               file itself — curation is a judgment call (relevance,
               not just keyword match), not something to automate.

    validate   Re-check every entry already in
               app/data/jewelry_interests.json against Meta's live API,
               refresh audience_size + resolved_at for ones still valid,
               and flag (not silently drop) any that come back invalid
               so a human can decide whether to remove them. Meta
               periodically deprecates detailed-targeting options, so
               this is meant to be re-run periodically (see
               app/services/interests.py's module docstring).

Needs a real Meta access token with ads permissions — pass one with
--access-token, or set META_ACCESS_TOKEN. Not tied to any one business's
MetaConnection (the search/validate endpoints aren't ad-account-scoped),
so this deliberately doesn't read from the app's own database.

Usage:
    uv run python scripts/resolve_interests.py discover --access-token TOKEN
    uv run python scripts/resolve_interests.py validate --access-token TOKEN
"""

import argparse
import asyncio
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.interests import DATA_PATH  # noqa: E402
from app.services.meta import (  # noqa: E402
    MetaConnectionError,
    search_ad_interests,
    validate_ad_interests,
)

# A starting set covering the jewelry vertical broadly enough to surface
# both category-level and brand-level interests — expand as needed for
# categories not yet represented in app/data/jewelry_interests.json.
SEED_TERMS = [
    "engagement rings",
    "diamonds",
    "gemstones",
    "watches",
    "bridal",
    "gifts",
    "luxury goods",
    "fine jewelry",
    "wedding rings",
    "necklaces",
    "earrings",
    "bracelets",
    "gold jewelry",
    "pearls",
    "custom jewelry",
    "anniversary gifts",
    "jewelry store",
    "designer jewelry",
    "silver jewelry",
    "jewelry design",
]


def _access_token(args: argparse.Namespace) -> str:
    token = args.access_token or os.environ.get("META_ACCESS_TOKEN")
    if not token:
        print("error: pass --access-token or set META_ACCESS_TOKEN", file=sys.stderr)
        raise SystemExit(1)
    return token


async def _discover(access_token: str) -> None:
    """Search every seed term and print deduplicated candidates."""
    seen: dict[str, dict[str, Any]] = {}
    for term in SEED_TERMS:
        try:
            results = await search_ad_interests(access_token=access_token, query=term)
        except MetaConnectionError as exc:
            print(f"error searching {term!r}: {exc}", file=sys.stderr)
            continue
        for result in results:
            seen[str(result["id"])] = result

    candidates = sorted(
        seen.values(), key=lambda r: -int(r.get("audience_size_upper_bound") or 0)
    )
    print(f"{len(candidates)} unique candidates across {len(SEED_TERMS)} terms:\n")
    for c in candidates:
        lower, upper = (
            c.get("audience_size_lower_bound"),
            c.get("audience_size_upper_bound"),
        )
        print(
            f"{c['id']}\t{c['name']}\t{c.get('disambiguation_category')}\t{lower}-{upper}"
        )
    print(
        "\nHand-pick the relevant ones into app/data/jewelry_interests.json "
        "as {key, meta_id, name, audience_size, resolved_at}."
    )


async def _validate(access_token: str) -> None:
    """Re-check every curated entry against the live API and refresh the file."""
    entries = json.loads(DATA_PATH.read_text())
    if not entries:
        print("no entries in app/data/jewelry_interests.json", file=sys.stderr)
        return

    meta_ids = [entry["meta_id"] for entry in entries]
    try:
        results = await validate_ad_interests(
            access_token=access_token, meta_ids=meta_ids
        )
    except MetaConnectionError as exc:
        print(f"error validating: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc

    by_id = {str(r["id"]): r for r in results}
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    refreshed = []
    dead = []
    for entry in entries:
        result = by_id.get(entry["meta_id"])
        if result is None or not result.get("valid"):
            dead.append(entry)
            continue
        entry["audience_size"] = result.get("audience_size", entry["audience_size"])
        entry["resolved_at"] = today
        refreshed.append(entry)

    if dead:
        print(f"{len(dead)} entries no longer valid, dropped:", file=sys.stderr)
        for entry in dead:
            print(
                f"  {entry['key']} ({entry['meta_id']}) — {entry['name']}",
                file=sys.stderr,
            )

    refreshed.sort(key=lambda e: str(e["key"]))
    DATA_PATH.write_text(json.dumps(refreshed, indent=2) + "\n")
    print(f"refreshed {len(refreshed)} entries, wrote {DATA_PATH}")


def main() -> None:
    """Parse args and dispatch to `discover` or `validate`."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["discover", "validate"])
    parser.add_argument("--access-token")
    args = parser.parse_args()

    access_token = _access_token(args)
    if args.command == "discover":
        asyncio.run(_discover(access_token))
    else:
        asyncio.run(_validate(access_token))


if __name__ == "__main__":
    main()
