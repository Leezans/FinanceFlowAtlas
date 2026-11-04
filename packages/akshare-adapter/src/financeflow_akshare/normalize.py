"""Normalize documented AKShare DataFrames without inventing missing metadata.

This is a provider evidence envelope, NOT the ashare-tree/1 contract. It cannot
mark display permission verified or assert a trading day from retrieval time.
"""
from datetime import datetime, timezone
import hashlib
import json
import math
import re
from numbers import Real
from collections.abc import Iterable, Mapping

ADAPTER_VERSION = "akshare-flow/1"
DOCUMENTATION = "https://akshare.akfamily.xyz/data/stock/stock_flow.html"
PROVIDER = "Eastmoney via AKShare"
FIELDS = {
    "main": "主力", "extra_large": "超大单", "large": "大单",
    "medium": "中单", "small": "小单",
}


def _time(value):
    if not isinstance(value, str):
        raise ValueError("retrieved_at must be an offset-aware ISO timestamp")
    try:
        t = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("invalid retrieval timestamp") from exc
    if t.tzinfo is None:
        raise ValueError("retrieval timezone is required")
    return t.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _number(value):
    # AKShare uses pandas NaN for coercion failures; retain as missing, not zero.
    if value is None or isinstance(value, str) and value.strip() in ("", "-", "--"):
        return None
    if isinstance(value, bool) or not isinstance(value, (str, Real)):
        raise ValueError("unsupported numeric value")
    try:
        result = float(value)
    except (ValueError, OverflowError) as exc:
        raise ValueError("unexpected numeric syntax") from exc
    if math.isnan(result):
        return None
    if not math.isfinite(result) or abs(result) > 2**53 - 1:
        raise ValueError("nonfinite or unsafe numeric value")
    return result


def _text(value, field):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"missing or invalid {field}")
    return value.strip()


def _required(row, key):
    if key not in row:
        raise ValueError(f"unexpected provider schema: missing {key}")
    return row[key]


def _return(row):
    keys = [k for k in ("今日涨跌幅", "今天涨跌幅") if k in row]
    if not keys:
        raise ValueError("unexpected provider schema: missing today return")
    values = [_number(row[k]) for k in keys]
    if len(values) == 2 and values[0] != values[1]:
        raise ValueError("conflicting documented return aliases")
    value = values[0]
    if value is not None and value < -100:
        raise ValueError("price return below -100 percent")
    return value


def normalize(rows: Iterable[Mapping], *, kind: str, retrieved_at: str,
              akshare_version: str, industry_name: str | None = None, source_total: int | None = None):
    """Accept today's sector rank or one industry's stock summary.

    Monetary values are CNY as documented, percentages remain percentage points.
    Sector name is only a provider-local identity, not a stable industry code.
    No mutual exclusivity, date, exchange, full-market coverage or rights inferred.
    """
    if kind not in ("industry_rank", "industry_stocks"):
        raise ValueError("only today's industry rank/stock summary are supported")
    if kind == "industry_stocks":
        industry_name = _text(industry_name, "industry_name")
    elif industry_name is not None:
        raise ValueError("industry_name only applies to stock summaries")
    version = _text(akshare_version, "akshare_version")
    if version != "1.20.27":
        raise ValueError("unreviewed AKShare version; reverify schema before enabling")
    if source_total is not None and (isinstance(source_total, bool) or not isinstance(source_total, int) or source_total < 0):
        raise ValueError("source_total must be a nonnegative integer from source metadata")
    fetched = _time(retrieved_at)
    output, identities = [], set()
    for row in rows:
        if not isinstance(row, Mapping):
            raise ValueError("each provider row must be a mapping")
        name = _text(_required(row, "名称"), "名称")
        code = None
        if kind == "industry_stocks":
            code = _required(row, "代码")
            if not isinstance(code, str) or not re.fullmatch(r"[0-9]{6}", code):
                raise ValueError("security code must be preserved six-digit text")
        identity = code if code is not None else name
        if identity in identities:
            raise ValueError("duplicate provider identity")
        identities.add(identity)
        amounts, percentages = {}, {}
        for key, label in FIELDS.items():
            amounts[key] = _number(_required(row, f"今日{label}净流入-净额"))
            percentages[key] = _number(_required(row, f"今日{label}净流入-净占比"))
        price = _number(_required(row, "最新价")) if code else None
        if price is not None and price < 0:
            raise ValueError("latest price cannot be negative")
        price_return = _return(row)
        missing = [f"order_bucket_net_cny.{k}" for k,v in amounts.items() if v is None]
        missing.extend(f"order_bucket_provider_share_pct.{k}" for k,v in percentages.items() if v is None)
        if price_return is None: missing.append("price_return_pct")
        if code is not None and price is None: missing.append("latest_price_cny")
        output.append({
            "provider_name": name, "provider_code": code,
            "instrument_id": None, "mic": None, "industry_name": industry_name,
            "main_order_flow_cny": amounts["main"],
            "order_bucket_net_cny": amounts,
            "order_bucket_provider_share_pct": percentages,
            "price_return_pct": price_return,
            "latest_price_cny": price,
            "observed_at": None, "trade_date": None,
            "missing_fields": missing,
        })
    if not output:
        raise ValueError("empty response is unavailable, not an empty market")
    if source_total is not None and len(output) > source_total:
        raise ValueError("returned rows exceed source total")
    # Canonical ordering for stable content identity. Retrieval time isn't evidence
    # of an observation change and is excluded from the content digest.
    output.sort(key=lambda r: (r["provider_code"] or "", r["provider_name"]))
    semantic = {"adapter_version": ADAPTER_VERSION, "akshare_version": version,
                "kind": kind, "industry_name": industry_name, "source_total": source_total, "rows": output}
    digest = hashlib.sha256(json.dumps(semantic, ensure_ascii=False, sort_keys=True,
                          separators=(",", ":"), allow_nan=False).encode()).hexdigest()
    return {**semantic, "version": digest, "retrieved_at": fetched,
            "source": PROVIDER, "documentation_url": DOCUMENTATION,
            "metric_kind": "provider_order_flow_proxy",
            "interpretation": "Provider order-classified net amount, not actual new money entering the market",
            "window": "provider_today_date_unavailable", "unit": "CNY",
            "reported_row_count": len(output), "expected_row_count": source_total,
            "coverage_status": "unknown" if source_total is None else "complete_source_response" if len(output) == source_total else "partial_source_response",
            "classification_level": "unknown_may_mix_levels",
            "industry_exclusivity": "unverified", "display_rights": "not_established",
            "production_ready": False,
            "limitations": ["No authoritative observation date or timestamp in returned DataFrame",
              "No exchange identity in returned stock DataFrame",
              "No listing dates, turnover or market capitalization in this response",
              "Industry membership and full-market completeness not established",
              "Client open-source license does not grant upstream data display rights"]}


def validate_memberships(summaries):
    """Detect overlap before any additive industry tree; do not resolve by fiat."""
    members = {}
    for snapshot in summaries:
        if snapshot.get("kind") != "industry_stocks":
            raise ValueError("membership input must be industry stock summaries")
        for row in snapshot["rows"]:
            code = row["provider_code"]
            if code in members:
                raise ValueError(f"overlapping or duplicate membership: {code}")
            members[code] = snapshot["industry_name"]
    return {"checked_codes": len(members), "scope": "provided summaries only",
            "global_exclusivity_verified": False}
