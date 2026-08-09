"""FastAPI application entrypoint."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.audience import router as audience_router
from app.api.auth import router as auth_router
from app.api.business import router as business_router
from app.api.campaign import router as campaign_router
from app.api.creative import router as creative_router
from app.api.meta import callback_router as meta_callback_router
from app.api.meta import router as meta_router
from app.api.metric import router as metric_router
from app.api.optimization import router as optimization_router
from app.api.product import router as product_router
from app.api.strategy import router as strategy_router
from app.core.config import get_settings
from app.core.db import db
from app.core.scheduler import start_scheduler, stop_scheduler

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Connect the database and start the scheduler on startup, reverse on shutdown.

    Args:
        _app: The FastAPI application instance (unused, required by the
            lifespan protocol).

    Yields:
        Control to the running application.
    """
    await db.connect()
    if settings.enable_scheduler:
        start_scheduler()
    yield
    if settings.enable_scheduler:
        stop_scheduler()
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
app.include_router(strategy_router)
app.include_router(creative_router)
app.include_router(meta_router)
app.include_router(meta_callback_router)
app.include_router(metric_router)
app.include_router(optimization_router)


@app.get("/health")
def read_health() -> dict[str, str]:
    """Report service liveness.

    Returns:
        A status payload confirming the service is up.
    """
    return {"status": "ok"}
