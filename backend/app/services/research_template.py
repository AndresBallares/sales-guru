"""Renders the Avatar Research prompt template for one business (Phase 7a).

The owner's direct-response strategist prompt lives in a versioned file
(``app/prompts/avatar_research_v3.md``; v1 and v2 are kept unchanged) with
``{{placeholder}}`` slots. This module loads it at run time and fills each slot
from the business's saved data:

- ``load_template_inputs`` reads the database into a ``TemplateInputs``;
- ``render_template`` is pure: it fills the file from those inputs.

Rules (docs/phase-7.md): every filled value goes through ``quarantine()``, an
empty value renders as the plain text "none provided", and no raw ``{{...}}``
survives (a value that contains braces is defused first, so owner text cannot
reintroduce a placeholder). The template's own wording is never altered.
Product.name is sent here only, never to the Strategist or Creative prompts.
"""

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import cast

from prisma import Prisma
from prisma.models import BrandProfile, Business, Product

from app.core.db import db as default_db
from app.schemas.brand_profile import PRICE_POSITIONING_LABELS
from app.schemas.business import INDUSTRY_LABELS
from app.services.prompt_safety import quarantine
from app.services.text_cut import cut_at_word
from app.services.url_validation import validate_destination_url

TEMPLATE_PATH = (
    Path(__file__).resolve().parent.parent / "prompts" / "avatar_research_v3.md"
)
TEMPLATE_VERSION = "avatar_research_v3"

NONE_PROVIDED = "none provided"
MAX_PRODUCTS = 3
MAX_EXTRA_COMPETITORS = 5
MAX_COMPETITORS = 10
_DESCRIPTION_CAP = 500
_BENEFITS_CAP = 400
_MECHANISM_CAP = 600
_WHO_CAP = 300

# Each placeholder in the template file and where its value comes from.
PLACEHOLDER_SOURCES: dict[str, str] = {
    "brand_name": "Business.name",
    "industry": "Business.industry",
    "website": "Business.website",
    "brand_description": "BrandProfile.description, else Business.description",
    "price_positioning": "BrandProfile.pricePositioning (label)",
    "standing_offer_or_none": "BrandProfile.offer",
    "proof_points_or_none": "BrandProfile.proofPoints",
    "products": "owner's choice, else 3 most recent campaigns' products, else latest",
    "key_messages": "BrandProfile.keyMessages",
    "ideal_customer": "BrandProfile.idealCustomer",
    "customer_problems": "BrandProfile.customerProblems",
    "mechanisms": "BrandProfile.mechanisms, else the selected products' mechanisms",
    "competitor_urls": "BrandProfile.competitors + run-start URLs, validated",
    "banned_phrases": "BrandRules.bannedPhrases",
    "existing_avatars_or_none": "active, non-deleted BuyerAvatars",
}

_PLACEHOLDER = re.compile(r"\{\{(\w+)\}\}")
# The template's header line. Its three short values share one quarantine block
# instead of three; every other value keeps its own wrapper.
_HEADER_LINE = "Brand: {{brand_name}} — {{industry}} — {{website}}"
_URL_CANDIDATE = re.compile(r"[^\s,;]+")


@dataclass(frozen=True)
class ProductInput:
    """One product as the template shows it (all fields optional)."""

    name: str | None = None
    url: str | None = None
    price: float | None = None
    description: str | None = None
    benefits: str | None = None
    mechanism: str | None = None


@dataclass(frozen=True)
class TemplateInputs:
    """Raw saved values for the template, before capping and quarantine."""

    brand_name: str
    industry: str | None = None
    website: str | None = None
    brand_description: str | None = None
    business_description: str | None = None
    price_positioning: str | None = None
    offer: str | None = None
    proof_points: list[str] = field(default_factory=list)
    products: list[ProductInput] = field(default_factory=list)
    key_messages: list[str] = field(default_factory=list)
    ideal_customer: str | None = None
    customer_problems: list[str] = field(default_factory=list)
    mechanisms: list[str] = field(default_factory=list)
    competitors_text: str | None = None
    extra_competitor_urls: list[str] = field(default_factory=list)
    banned_phrases: list[str] = field(default_factory=list)
    existing_avatars: list[tuple[str, str]] = field(default_factory=list)


@dataclass(frozen=True)
class RenderedTemplate:
    """The filled prompt with the identity of the template file it came from."""

    text: str
    version: str
    content_hash: str


def _clean(value: str | None) -> str:
    """Trimmed text, with braces defused so it cannot form a placeholder."""
    text = (value or "").strip()
    return text.replace("{{", "{ {").replace("}}", "} }")


def _cap(value: str | None, limit: int) -> str:
    return cut_at_word(_clean(value), limit)


def _wrap(label: str, text: str) -> str:
    return quarantine(label, text) if text else NONE_PROVIDED


def _bullets(items: list[str]) -> str:
    return "\n".join(f"- {c}" for c in (_clean(i) for i in items) if c)


def _format_price(price: float) -> str:
    return f"{price:g}"


def _product_block(product: ProductInput) -> str:
    lines: list[str] = []
    if product.name and product.name.strip():
        lines.append(f"Name: {_clean(product.name)}")
    if product.url and product.url.strip():
        lines.append(f"URL: {_clean(product.url)}")
    if product.price is not None:
        lines.append(f"Price: {_format_price(product.price)}")
    for label, value, cap in (
        ("Description", product.description, _DESCRIPTION_CAP),
        ("Benefits", product.benefits, _BENEFITS_CAP),
        ("Mechanism", product.mechanism, _MECHANISM_CAP),
    ):
        if value and value.strip():
            lines.append(f"{label}: {_cap(value, cap)}")
    return "\n".join(lines)


def competitor_urls(
    competitors_text: str | None, extra: list[str] | None = None
) -> list[str]:
    """The valid, de-duplicated competitor URLs from free text plus run-start extras.

    Non-URLs (names, notes, localhost, bare IPs, other schemes) are dropped;
    each kept URL is normalised with ``validate_destination_url``.

    Args:
        competitors_text: BrandProfile.competitors, free text.
        extra: URLs the owner added when starting a run.

    Returns:
        The URLs in order of first appearance, at most MAX_COMPETITORS.
    """
    candidates = _URL_CANDIDATE.findall(competitors_text or "") + list(extra or [])
    urls: list[str] = []
    for candidate in candidates:
        token = candidate.strip().rstrip(".)")
        if not token or ("." not in token and "://" not in token):
            continue
        try:
            url = validate_destination_url(token)
        except ValueError:
            continue
        if url not in urls:
            urls.append(url)
    return urls[:MAX_COMPETITORS]


def _mechanisms(inputs: TemplateInputs) -> list[str]:
    owner = [m for m in inputs.mechanisms if m.strip()]
    if owner:
        return owner
    seen: set[str] = set()
    fallback: list[str] = []
    for product in inputs.products[:MAX_PRODUCTS]:
        mechanism = (product.mechanism or "").strip()
        if mechanism and mechanism.casefold() not in seen:
            seen.add(mechanism.casefold())
            fallback.append(mechanism)
    return fallback


_INDUSTRY_LABELS = cast("dict[str, str]", INDUSTRY_LABELS)


def _industry_label(industry: str | None) -> str:
    """The readable name of a stored industry; a legacy freeform value is kept as is."""
    value = _clean(industry)
    return _INDUSTRY_LABELS.get(value, value)


@dataclass(frozen=True)
class ReadinessItem:
    """One input the run depends on, and whether the owner has filled it in."""

    field: str
    label: str
    empty: bool


def readiness(inputs: TemplateInputs) -> list[ReadinessItem]:
    """Which template inputs are empty, so the screen can say what to fill in first.

    Args:
        inputs: The saved values for one business (and the chosen products).

    Returns:
        Key messages, customer problems, competitors, product names and product
        descriptions, each flagged empty or not. A product check is empty when
        there are no products or any chosen product lacks that field.
    """
    products = inputs.products[:MAX_PRODUCTS]
    return [
        ReadinessItem("key_messages", "Key messages", not inputs.key_messages),
        ReadinessItem(
            "customer_problems", "Customer problems", not inputs.customer_problems
        ),
        ReadinessItem(
            "competitors",
            "Competitors",
            not competitor_urls(inputs.competitors_text, inputs.extra_competitor_urls),
        ),
        ReadinessItem(
            "product_names",
            "Product names",
            not products or any(not _clean(p.name) for p in products),
        ),
        ReadinessItem(
            "product_descriptions",
            "Product descriptions",
            not products or any(not _clean(p.description) for p in products),
        ),
    ]


def _values(inputs: TemplateInputs) -> dict[str, str]:
    description = _clean(inputs.brand_description) or _clean(
        inputs.business_description
    )
    label = PRICE_POSITIONING_LABELS.get(inputs.price_positioning or "")  # type: ignore[call-overload]
    price = label or _clean(inputs.price_positioning)
    blocks = [_product_block(p) for p in inputs.products[:MAX_PRODUCTS]]
    products = "\n\n".join(_wrap("Product", b) for b in blocks if b) or NONE_PROVIDED
    avatars = [
        f"{_clean(name)}: {_cap(who, _WHO_CAP)}"
        for name, who in inputs.existing_avatars
        if _clean(name)
    ]
    return {
        "brand_name": _wrap("Brand name", _clean(inputs.brand_name)),
        "industry": _wrap("Industry", _industry_label(inputs.industry)),
        "website": _wrap("Website", _clean(inputs.website)),
        "brand_description": _wrap("About the brand", description),
        "price_positioning": _wrap("Price positioning", price),
        "standing_offer_or_none": _wrap("Standing offer", _clean(inputs.offer)),
        "proof_points_or_none": _wrap("Proof points", _bullets(inputs.proof_points)),
        "products": products,
        "key_messages": _wrap("Key brand messages", _bullets(inputs.key_messages)),
        "ideal_customer": _wrap("Ideal customer", _clean(inputs.ideal_customer)),
        "customer_problems": _wrap(
            "Problems the owner believes customers have",
            _bullets(inputs.customer_problems),
        ),
        "mechanisms": _wrap("Owner's mechanisms", _bullets(_mechanisms(inputs))),
        "competitor_urls": _wrap(
            "Competitor links",
            _bullets(
                competitor_urls(inputs.competitors_text, inputs.extra_competitor_urls)
            ),
        ),
        "banned_phrases": _wrap("Banned phrases", _bullets(inputs.banned_phrases)),
        "existing_avatars_or_none": _wrap("Existing avatars", _bullets(avatars)),
    }


def render_template(inputs: TemplateInputs) -> RenderedTemplate:
    """Fill the template file from the inputs.

    Args:
        inputs: The saved values for one business.

    Returns:
        The filled text with the template's version and a SHA-256 of its bytes.

    Raises:
        KeyError: If the file holds a placeholder with no mapping (a template
            edit that the renderer does not know about yet).
    """
    raw = TEMPLATE_PATH.read_bytes()
    values = _values(inputs)
    template = raw.decode("utf-8")
    if _HEADER_LINE in template:
        header = " — ".join(
            part
            for part in (
                _clean(inputs.brand_name),
                _industry_label(inputs.industry),
                _clean(inputs.website),
            )
            if part
        )
        template = template.replace(
            _HEADER_LINE, "Brand: " + _wrap("Brand, industry and website", header)
        )

    def fill(match: re.Match[str]) -> str:
        return values[match.group(1)]

    text = _PLACEHOLDER.sub(fill, template)
    return RenderedTemplate(
        text=text,
        version=TEMPLATE_VERSION,
        content_hash=hashlib.sha256(raw).hexdigest(),
    )


def _list(stored: str | None) -> list[str]:
    return [str(i) for i in json.loads(stored)] if stored else []


async def _select_products(
    business_id: str, product_ids: list[str] | None, client: Prisma
) -> list[Product]:
    if product_ids:
        if len(product_ids) > MAX_PRODUCTS:
            raise ValueError(f"Choose at most {MAX_PRODUCTS} products")
        found = await client.product.find_many(
            where={"businessId": business_id, "id": {"in": product_ids}}
        )
        by_id = {p.id: p for p in found}
        missing = [i for i in product_ids if i not in by_id]
        if missing:
            raise ValueError(f"Product not found: {missing[0]}")
        return [by_id[i] for i in product_ids]
    campaigns = await client.campaign.find_many(
        where={"businessId": business_id}, order={"createdAt": "desc"}, take=50
    )
    ordered: list[str] = []
    for campaign in campaigns:
        if campaign.productId and campaign.productId not in ordered:
            ordered.append(campaign.productId)
        if len(ordered) == MAX_PRODUCTS:
            break
    if ordered:
        found = await client.product.find_many(where={"id": {"in": ordered}})
        by_id = {p.id: p for p in found}
        return [by_id[i] for i in ordered if i in by_id]
    latest = await client.product.find_first(
        where={"businessId": business_id}, order={"createdAt": "desc"}
    )
    return [latest] if latest else []


def _product_input(product: Product) -> ProductInput:
    return ProductInput(
        name=product.name,
        url=product.url,
        price=product.price,
        description=product.description,
        benefits=product.benefits,
        mechanism=product.mechanism,
    )


def _inputs_from(
    business: Business,
    profile: BrandProfile | None,
    products: list[Product],
    banned: list[str],
    avatars: list[tuple[str, str]],
    extra_urls: list[str],
) -> TemplateInputs:
    return TemplateInputs(
        brand_name=business.name,
        industry=business.industry,
        website=business.website,
        brand_description=profile.description if profile else None,
        business_description=business.description,
        price_positioning=profile.pricePositioning if profile else None,
        offer=profile.offer if profile else None,
        proof_points=_list(profile.proofPoints) if profile else [],
        products=[_product_input(p) for p in products],
        key_messages=_list(profile.keyMessages) if profile else [],
        ideal_customer=profile.idealCustomer if profile else None,
        customer_problems=_list(profile.customerProblems) if profile else [],
        mechanisms=_list(profile.mechanisms) if profile else [],
        competitors_text=profile.competitors if profile else None,
        extra_competitor_urls=extra_urls,
        banned_phrases=banned,
        existing_avatars=avatars,
    )


async def load_template_inputs(
    business_id: str,
    product_ids: list[str] | None = None,
    extra_competitor_urls: list[str] | None = None,
    *,
    client: Prisma | None = None,
) -> TemplateInputs:
    """Read a business's saved data into the template's inputs.

    Args:
        business_id: The business (already ownership-checked by the caller).
        product_ids: The owner's choice of products (at most 3), or None for the
            default: the 3 most recent campaigns' products, else the latest.
        extra_competitor_urls: Competitor URLs added when the run starts.
        client: A connected Prisma client; the app's shared one by default.

    Returns:
        The inputs, ready for ``render_template``.

    Raises:
        ValueError: If more than 3 products are chosen, or one is not found in
            this business.
    """
    prisma = client or default_db
    business = await prisma.business.find_unique(where={"id": business_id})
    if business is None:
        raise ValueError("Business not found")
    profile = await prisma.brandprofile.find_unique(where={"businessId": business_id})
    rules = await prisma.brandrules.find_unique(where={"businessId": business_id})
    products = await _select_products(business_id, product_ids, prisma)
    avatars = await prisma.buyeravatar.find_many(
        where={"businessId": business_id, "deletedAt": None, "isActive": True},
        order=[{"sortOrder": "asc"}, {"createdAt": "asc"}],
    )
    return _inputs_from(
        business,
        profile,
        products,
        _list(rules.bannedPhrases) if rules else [],
        [(a.name, a.who) for a in avatars],
        list(extra_competitor_urls or []),
    )
