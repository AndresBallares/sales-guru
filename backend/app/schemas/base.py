"""Shared Pydantic base for API schemas."""

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelCaseModel(BaseModel):
    """Base for request/response schemas: camelCase JSON, snake_case Python.

    Matches both Prisma's own field naming (schema.prisma uses camelCase)
    and standard JS/TS convention, so the frontend never has to translate
    casing. populate_by_name=True means request bodies accept either casing;
    responses always serialize using the alias (camelCase) — FastAPI's
    response_model_by_alias defaults to True.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
