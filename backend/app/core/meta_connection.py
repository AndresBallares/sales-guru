"""Shared, decrypting fetch for MetaConnection.

MetaConnection.accessToken is stored encrypted (app/core/crypto.py) — every
read site must route through get_meta_connection rather than calling
db.metaconnection.find_unique directly, or it gets ciphertext instead of a
usable Meta access token.
"""

from prisma.models import MetaConnection

from app.core.crypto import decrypt_token
from app.core.db import db


async def get_meta_connection(business_id: str) -> MetaConnection | None:
    """Fetch a business's MetaConnection, decrypting accessToken first.

    Args:
        business_id: The business to look up.

    Returns:
        The connection with accessToken already decrypted to plaintext,
        or None if the business hasn't started connecting yet.
    """
    connection = await db.metaconnection.find_unique(where={"businessId": business_id})
    if connection is not None:
        connection.accessToken = decrypt_token(connection.accessToken)
    return connection
