from typing import Literal
from pydantic import BaseModel, Field, ConfigDict
class Position(BaseModel):
    model_config = ConfigDict(extra='forbid')
    record_id: str
    reporter_iso3: str = Field(pattern=r'^[A-Z]{3}$')
    counterpart_iso3: str = Field(pattern=r'^[A-Z]{3}$')
    value_usd: float = Field(ge=0, allow_inf_nan=False)
    period: str = Field(pattern=r'^\d{4}-S[12]$')
    source_id: str
class Metadata(BaseModel):
    version: str
    as_of: str
    period: str
    concept: Literal['position'] = 'position'
    asset_class: Literal['equity'] = 'equity'
    coverage_note: str
    unit_verified: bool
    raw_sha256: str
    excluded_records: dict[str,int]
    excluded_examples: dict[str,list[dict]] = {}
    adapter_version: str
class Source(BaseModel):
    id: str
    name: str
    url: str
    published_at: str | None
    retrieved_at: str
    status: str
    frequency: str
    license_note: str
class Country(BaseModel):
    iso3: str
    iso2: str
    numeric: str
    name: str
    coverage: Literal['reporter','counterpart_only','no_observations']
class Snapshot(BaseModel):
    metadata: Metadata
    sources: list[Source]
    countries: list[Country]
    positions: list[Position]
