"""Brand rules endpoints: a business's banned phrases and required disclosures.

At most one row per business (BrandRules.businessId is unique). GET reads empty
lists before any exist, PUT creates or replaces the rules, DELETE clears them.
"""

import json

from fastapi import APIRouter, Depends, Response, status
from prisma.models import BrandRules, Business

from app.core.authz import get_owned_business
from app.core.db import db
from app.schemas.brand_rules import BrandRulesRequest, BrandRulesResponse

router = APIRouter(prefix="/businesses/{business_id}/brand-rules", tags=["brand-rules"])


def _to_response(business_id: str, rules: BrandRules | None) -> BrandRulesResponse:
    """The rules' public shape, with empty lists when none are stored."""
    return BrandRulesResponse(
        business_id=business_id,
        banned_phrases=json.loads(rules.bannedPhrases) if rules else [],
        required_disclosures=json.loads(rules.requiredDisclosures) if rules else [],
    )


@router.get("", response_model=BrandRulesResponse)
async def get_brand_rules(
    business: Business = Depends(get_owned_business),
) -> BrandRulesResponse:
    """Fetch a business's brand rules.

    Args:
        business: The business, resolved and ownership-checked.

    Returns:
        The rules, with empty lists if none were ever set.
    """
    rules = await db.brandrules.find_unique(where={"businessId": business.id})
    return _to_response(business.id, rules)


@router.put("", response_model=BrandRulesResponse)
async def put_brand_rules(
    payload: BrandRulesRequest,
    business: Business = Depends(get_owned_business),
) -> BrandRulesResponse:
    """Create or replace a business's brand rules.

    Args:
        payload: The rules in full; a list left out becomes empty.
        business: The business, resolved and ownership-checked.

    Returns:
        The stored rules.
    """
    banned = json.dumps(payload.banned_phrases)
    disclosures = json.dumps(payload.required_disclosures)
    rules = await db.brandrules.upsert(
        where={"businessId": business.id},
        data={
            "create": {
                "businessId": business.id,
                "bannedPhrases": banned,
                "requiredDisclosures": disclosures,
            },
            "update": {"bannedPhrases": banned, "requiredDisclosures": disclosures},
        },
    )
    return _to_response(business.id, rules)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def delete_brand_rules(
    business: Business = Depends(get_owned_business),
) -> Response:
    """Clear a business's brand rules (a no-op if there are none).

    Args:
        business: The business, resolved and ownership-checked.

    Returns:
        An empty 204.
    """
    await db.brandrules.delete_many(where={"businessId": business.id})
    return Response(status_code=status.HTTP_204_NO_CONTENT)
