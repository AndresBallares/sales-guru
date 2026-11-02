# ruff: noqa: E402, E501, S608, S311
"""Check the production creatives against the banned phrases. Reports only.

Uses the app's own matchers (app.services.ad_quality), so a hit here is a hit
the generator and the pre-publish guard would also see. Changes nothing.

Usage:
    .venv/bin/python scripts/venzi_rollout/check_creatives.py
"""

import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent.parent))

from app.services.ad_quality import (
    BANNED_PHRASES,
    banned_phrases_in,
    business_phrases_in,
)  # noqa: E402

# md5 of headline|bodyText|description as read from production (SELECT only);
# proves the saved snapshot is the production text.
PROD_MD5 = {
    "cmvoatbht002ay2n1qtm8a06v": "6abf6062998313d2a36479a96f223a04",
    "cmvoatbkl002cy2n1b1794b1x": "da73d848ad3765af842c74425b84c3f6",
    "cmvoatbm1002ey2n199sum6h5": "4c2764b522ea850b28b01ae040159a16",
    "cmvoatbni002gy2n1x7tlvrij": "6ce93012ed5a54711276f0796f7c76d7",
    "cmvu3g4sq000v7s86pkwfpiar": "94179596b396d80113a9c4c006ff7b1e",
    "cmvu3g4w1000x7s86mzhlmgmh": "2a8c490d12f468362bf262b67510333f",
    "cmvu3g4xp000z7s86cmvkoz49": "4ea46eefd23be844acd1524843a706c9",
    "cmvu3g4ze00117s860jm8p3ut": "d996b5e3e86388112fc7c04d342b6b39",
}


def main() -> None:
    """Print each hit with its creative, field and text."""
    creatives = json.loads((HERE / "snapshot" / "creatives.json").read_text())
    banned = json.loads((HERE / "out" / "new_banned.json").read_text())
    bad = 0
    for c in creatives:
        text = "|".join([c["headline"], c["bodyText"], c["description"] or "<null>"])
        if hashlib.md5(text.encode()).hexdigest() != PROD_MD5[c["id"]]:  # noqa: S324
            sys.exit(f"{c['id']}: saved text differs from production")
        for field in ("headline", "bodyText", "description"):
            for phrase in business_phrases_in(c[field], banned):
                bad += 1
                print(
                    f"HIT business phrase {phrase!r} | {c['id']} ({c['campaign']}, {c['status']}) | {field}: {c[field]!r}"
                )
            for phrase in banned_phrases_in(c[field]):
                bad += 1
                print(
                    f"HIT built-in phrase {phrase!r} | {c['id']} ({c['campaign']}, {c['status']}) | {field}: {c[field]!r}"
                )
    print(
        f"checked {len(creatives)} creatives x 3 fields against {len(banned)} business "
        f"phrases + {len(BANNED_PHRASES)} built-in phrases; {bad} hit(s); snapshot text verified against production md5"
    )


if __name__ == "__main__":
    main()
