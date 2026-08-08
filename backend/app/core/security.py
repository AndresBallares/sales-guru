"""Password hashing utilities (Argon2id)."""

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    """Hash a plaintext password.

    Args:
        password: The plaintext password to hash.

    Returns:
        The Argon2id hash string, safe to store.
    """
    return _hasher.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    """Verify a plaintext password against a stored hash.

    Args:
        password: The plaintext password to check.
        hashed: The stored Argon2id hash.

    Returns:
        True if the password matches the hash, False otherwise.
    """
    try:
        return _hasher.verify(hashed, password)
    except VerifyMismatchError:
        return False
