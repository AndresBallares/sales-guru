"""Schemas for authentication endpoints."""

from pydantic import EmailStr, Field, field_validator

from app.schemas.base import CamelCaseModel


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

    _normalize_email = field_validator("email")(_lowercase_email)


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
