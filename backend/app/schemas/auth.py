"""Schemas for authentication endpoints."""

from pydantic import BaseModel, EmailStr, Field


class SignupRequest(BaseModel):
    """Payload for creating a new account."""

    email: EmailStr
    password: str = Field(min_length=8)


class LoginRequest(BaseModel):
    """Payload for logging into an existing account."""

    email: EmailStr
    password: str


class UserResponse(BaseModel):
    """Public-facing representation of a User."""

    id: str
    email: str
