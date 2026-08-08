"""Schemas for authentication endpoints."""

from pydantic import EmailStr, Field

from app.schemas.base import CamelCaseModel


class SignupRequest(CamelCaseModel):
    """Payload for creating a new account."""

    email: EmailStr
    password: str = Field(min_length=8)


class LoginRequest(CamelCaseModel):
    """Payload for logging into an existing account."""

    email: EmailStr
    password: str


class UserResponse(CamelCaseModel):
    """Public-facing representation of a User."""

    id: str
    email: str
