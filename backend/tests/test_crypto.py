"""Tests for MetaConnection.accessToken encryption at rest."""

from collections.abc import Iterator

import pytest
from app.core import crypto
from app.core.config import get_settings
from cryptography.fernet import Fernet


@pytest.fixture(autouse=True)
def _clear_fernet_cache() -> Iterator[None]:
    """Fresh Fernet instance per test, since crypto._fernet is lru_cache'd."""
    crypto._fernet.cache_clear()
    yield
    crypto._fernet.cache_clear()


def test_encrypt_then_decrypt_round_trips_to_the_original_value() -> None:
    """A token survives an encrypt/decrypt round trip unchanged."""
    ciphertext = crypto.encrypt_token("a-real-meta-access-token")

    assert crypto.decrypt_token(ciphertext) == "a-real-meta-access-token"


def test_encrypted_value_does_not_contain_the_plaintext() -> None:
    """The stored ciphertext never leaks the raw token."""
    ciphertext = crypto.encrypt_token("a-real-meta-access-token")

    assert "a-real-meta-access-token" not in ciphertext


def test_decrypt_raises_a_clear_error_for_invalid_ciphertext() -> None:
    """Corrupted or non-Fernet data fails with TokenEncryptionError, not a raw crash."""
    with pytest.raises(crypto.TokenEncryptionError, match="could not be decrypted"):
        crypto.decrypt_token("not-a-real-fernet-token")


def test_decrypt_raises_a_clear_error_for_a_token_from_a_different_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A ciphertext encrypted under a rotated/different key fails to decrypt."""
    ciphertext = crypto.encrypt_token("a-real-meta-access-token")

    monkeypatch.setenv("META_TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
    get_settings.cache_clear()
    crypto._fernet.cache_clear()
    try:
        with pytest.raises(crypto.TokenEncryptionError, match="could not be decrypted"):
            crypto.decrypt_token(ciphertext)
    finally:
        get_settings.cache_clear()


def test_encrypt_raises_a_clear_error_when_the_key_is_not_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Missing META_TOKEN_ENCRYPTION_KEY fails clearly, not with a confusing crash."""
    monkeypatch.setenv("META_TOKEN_ENCRYPTION_KEY", "")
    get_settings.cache_clear()
    try:
        with pytest.raises(crypto.TokenEncryptionError, match="must be configured"):
            crypto.encrypt_token("a-real-meta-access-token")
    finally:
        get_settings.cache_clear()
