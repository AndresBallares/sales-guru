"""Schemas for authentication endpoints."""

from pydantic import EmailStr, Field, field_validator

from app.schemas.base import CamelCaseModel


def _lowercase_email(value: str) -> str:
    """Normalize an email to lowercase.

    Emails are stored lowercase (User.email is @unique, case-sensitive at
    the DB level) so "Foo@Bar.com" and "foo@bar.com" are the same account
    everywhere — signup, login, and the admin reset script all normalize
    through this same function.
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


class UserResponse(CamelCaseModel):
    """Public-facing representation of a User."""

    id: str
    email: str
