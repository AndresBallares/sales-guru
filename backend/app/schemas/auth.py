"""Schemas for authentication endpoints."""

from pydantic import EmailStr, Field, field_validator

from app.schemas.base import CamelCaseModel

_TERMS_NOT_ACCEPTED = (
    "You must accept the Terms of Service, Privacy Policy, and Data "
    "Deletion Policy to create an account"
)


def _lowercase_email(value: str) -> str:
    """Normalize an email to lowercase.

    Emails are stored lowercase (User.email is @unique, case-sensitive at
    the DB level) so "Foo@Bar.com" and "foo@bar.com" are the same account
    everywhere — signup, login, forgot-password, and the admin reset
    script all normalize through this same function.
    """
    return value.lower()


class SignupRequest(CamelCaseModel):
    """Payload for creating a new account."""

    email: EmailStr
    password: str = Field(min_length=8)
    # Must be explicitly true, not just present — a bare `bool` field with
    # no default already 422s a request that omits it entirely; the
    # validator below additionally rejects an explicit `false`, since a
    # missing-vs-unchecked box should fail the same way.
    terms_accepted: bool

    _normalize_email = field_validator("email")(_lowercase_email)

    @field_validator("terms_accepted")
    @classmethod
    def _must_accept_terms(cls, value: bool) -> bool:
        if not value:
            raise ValueError(_TERMS_NOT_ACCEPTED)
        return value


class LoginRequest(CamelCaseModel):
    """Payload for logging into an existing account."""

    email: EmailStr
    password: str

    _normalize_email = field_validator("email")(_lowercase_email)


class ForgotPasswordRequest(CamelCaseModel):
    """Payload to request a password reset link."""

    email: EmailStr

    _normalize_email = field_validator("email")(_lowercase_email)


class ResetPasswordRequest(CamelCaseModel):
    """Payload to actually reset a password, given a valid reset token."""

    token: str
    new_password: str = Field(min_length=8)


class MessageResponse(CamelCaseModel):
    """A generic human-readable confirmation message."""

    message: str


class UserResponse(CamelCaseModel):
    """Public-facing representation of a User."""

    id: str
    email: str
    # Computed (app/core/terms.needs_terms_acceptance), never a raw copy of
    # termsAcceptedAt/termsVersion — the frontend only ever needs to know
    # whether to show the one-time full-page acceptance gate, not the
    # underlying facts.
    needs_terms_acceptance: bool
