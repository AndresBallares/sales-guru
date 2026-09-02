"""Reversible encryption for secrets that must be usable again later.

Unlike User.hashedPassword/Session.tokenHash (one-way, app/core/security.py,
app/core/session.py), a Meta access token has to be sent back to Meta's
Marketing API for real calls, so it can't be a one-way hash — it needs
reversible encryption at rest instead. Uses Fernet (AES-128-CBC + HMAC,
from the `cryptography` package) with a key from
Settings.meta_token_encryption_key.
"""

from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings


class TokenEncryptionError(Exception):
    """Raised when META_TOKEN_ENCRYPTION_KEY is missing or a ciphertext is invalid."""


@lru_cache
def _fernet() -> Fernet:
    """Build the Fernet instance from the configured encryption key.

    Returns:
        A Fernet instance ready to encrypt/decrypt.

    Raises:
        TokenEncryptionError: If META_TOKEN_ENCRYPTION_KEY isn't configured.
    """
    key = get_settings().meta_token_encryption_key
    if not key:
        raise TokenEncryptionError(
            "META_TOKEN_ENCRYPTION_KEY must be configured to store or read "
            "a Meta access token"
        )
    return Fernet(key.encode())


def encrypt_token(raw: str) -> str:
    """Encrypt a plaintext token for storage.

    Args:
        raw: The plaintext token (e.g. a Meta access token).

    Returns:
        The ciphertext, safe to store in a String column.
    """
    return _fernet().encrypt(raw.encode()).decode()


def decrypt_token(ciphertext: str) -> str:
    """Decrypt a token previously encrypted with encrypt_token.

    Args:
        ciphertext: The stored ciphertext.

    Returns:
        The original plaintext token.

    Raises:
        TokenEncryptionError: If the ciphertext is invalid for the
            configured key (wrong/rotated key, or corrupted data).
    """
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken as exc:
        raise TokenEncryptionError(
            "Stored Meta access token could not be decrypted — wrong or "
            "rotated META_TOKEN_ENCRYPTION_KEY"
        ) from exc
