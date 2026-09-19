"""The single source of truth for which terms version users must accept.

Bump TERMS_VERSION whenever the Terms of Service, Privacy Policy, or Data
Deletion Policy materially change — every user whose stored
User.termsVersion no longer matches this value is treated as needing to
re-accept (needs_terms_acceptance below), regardless of whether
User.termsAcceptedAt is set.
"""

from prisma.models import User

TERMS_VERSION = "2026-09"


def needs_terms_acceptance(user: User) -> bool:
    """Whether this user must accept (or re-accept) the current terms.

    True for a brand-new account that somehow bypassed the signup gate,
    for any pre-existing account created before this feature existed
    (termsAcceptedAt/termsVersion both null), and for an account that
    accepted an older TERMS_VERSION than the current one.

    Args:
        user: The user to check.

    Returns:
        True if the user must accept before continuing to use the app.
    """
    return user.termsAcceptedAt is None or user.termsVersion != TERMS_VERSION
