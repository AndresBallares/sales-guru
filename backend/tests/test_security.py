"""Tests for password hashing utilities."""

from app.core.security import hash_password, verify_password


def test_hash_password_produces_a_verifiable_hash() -> None:
    """A hashed password verifies successfully against the same plaintext."""
    hashed = hash_password("correct horse battery staple")

    assert hashed != "correct horse battery staple"
    assert verify_password("correct horse battery staple", hashed)


def test_verify_password_rejects_wrong_password() -> None:
    """Verification fails for a plaintext that doesn't match the hash."""
    hashed = hash_password("correct horse battery staple")

    assert not verify_password("wrong password", hashed)
