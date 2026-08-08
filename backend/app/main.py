"""FastAPI application entrypoint."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.audience import router as audience_router
from app.api.auth import router as auth_router
from app.api.business import router as business_router
from app.api.campaign import router as campaign_router
from app.api.product import router as product_router
from app.core.config import get_settings
from app.core.db import db

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Connect the database on startup and disconnect on shutdown.

    Args:
        _app: The FastAPI application instance (unused, required by the
            lifespan protocol).

    Yields:
        Control to the running application.
    """
    await db.connect()
    yield
    await db.disconnect()


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router)
app.include_router(business_router)
app.include_router(product_router)
app.include_router(audience_router)
app.include_router(campaign_router)


@app.get("/health")
def read_health() -> dict[str, str]:
    """Report service liveness.

    Returns:
        A status payload confirming the service is up.
    """
    return {"status": "ok"}
