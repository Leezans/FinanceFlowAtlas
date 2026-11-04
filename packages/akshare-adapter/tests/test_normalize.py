"""Synthetic provider-shaped fixtures only; no downloaded observations."""
import copy
import math
import unittest
from financeflow_akshare.normalize import normalize, validate_memberships, FIELDS

TIME = "2024-02-01T10:00:00Z"
def row(stock=False):
    value = {"名称": "示例证券" if stock else "示例行业", "今日涨跌幅": -2.5}
    if stock:
        value.update({"代码": "000001", "最新价": 10.5})
    for k, label in FIELDS.items():
        value[f"今日{label}净流入-净额"] = -12345.5 if k == "main" else 100
        value[f"今日{label}净流入-净占比"] = -1.25
    return value

def call(rows=None, **kwargs):
    options = dict(kind="industry_rank", retrieved_at=TIME, akshare_version="1.20.27")
    options.update(kwargs)
    return normalize([row()] if rows is None else rows, **options)

class NormalizeTests(unittest.TestCase):
    def test_preserves_units_sign_unknown_metadata(self):
        data = call()
        self.assertEqual(data["rows"][0]["main_order_flow_cny"], -12345.5)
        self.assertEqual(data["rows"][0]["order_bucket_provider_share_pct"]["main"], -1.25)
        self.assertIsNone(data["rows"][0]["observed_at"])
        self.assertIsNone(data["rows"][0]["trade_date"])
        self.assertFalse(data["production_ready"])
        self.assertEqual(data["display_rights"], "not_established")

    def test_alias_and_stock_code(self):
        value = row(True)
        value["今天涨跌幅"] = value.pop("今日涨跌幅")
        data = call([value], kind="industry_stocks", industry_name="示例行业")
        self.assertEqual(data["rows"][0]["provider_code"], "000001")
        self.assertIsNone(data["rows"][0]["mic"])
        self.assertIsNone(data["rows"][0]["instrument_id"])

    def test_conflicting_aliases(self):
        value = row(); value["今天涨跌幅"] = 3
        with self.assertRaises(ValueError): call([value])

    def test_missing_is_not_zero(self):
        for missing in (None, float("nan"), "-", "--", ""):
            value=row();value["今日主力净流入-净额"]=missing
            self.assertIsNone(call([value])["rows"][0]["main_order_flow_cny"])
        value=row();value["今日主力净流入-净额"]=0
        self.assertEqual(call([value])["rows"][0]["main_order_flow_cny"], 0)

    def test_reject_infinite_unsafe_and_malformed(self):
        for bad in (float("inf"),float("-inf"),1e30,"broken",True):
            value=row();value["今日主力净流入-净额"]=bad
            with self.assertRaises(ValueError):call([value])

    def test_empty_and_schema_fail_closed(self):
        with self.assertRaises(ValueError):call([])
        value=row();del value["今日主力净流入-净额"]
        with self.assertRaises(ValueError):call([value])

    def test_duplicate_and_nontext_codes(self):
        with self.assertRaises(ValueError):call([row(),row()])
        for code in (1,"1","SZ000001","０００００１","٠٠٠٠٠١"):
            value=row(True);value["代码"]=code
            with self.assertRaises(ValueError):call([value],kind="industry_stocks",industry_name="示例")

    def test_time_version_scope_gate(self):
        for options in ({"retrieved_at":"2024-02-01T10:00:00"},{"akshare_version":"new"},{"kind":"5day"},{"industry_name":"unexpected"}):
            with self.assertRaises(ValueError):call(**options)

    def test_content_hash_ignores_retrieval_not_values(self):
        first=call(); self.assertEqual(first["version"],call(retrieved_at="2024-02-02T10:00:00Z")["version"])
        value=row();value["今日主力净流入-净额"]=10
        self.assertNotEqual(first["version"],call([value])["version"])

    def test_overlap_is_not_silently_deduplicated(self):
        one=call([row(True)],kind="industry_stocks",industry_name="行业一")
        two=call([row(True)],kind="industry_stocks",industry_name="行业二")
        with self.assertRaises(ValueError):validate_memberships([one,two])
        result=validate_memberships([one])
        self.assertFalse(result["global_exclusivity_verified"])
        self.assertEqual(result["checked_codes"],1)

    def test_truncated_response_is_explicitly_partial(self):
        data=call(source_total=523)
        self.assertEqual(data["coverage_status"],"partial_source_response")
        self.assertEqual(data["expected_row_count"],523)
        self.assertEqual(call(source_total=1)["coverage_status"],"complete_source_response")
        self.assertEqual(call()["coverage_status"],"unknown")
        self.assertEqual(data["classification_level"],"unknown_may_mix_levels")
        for invalid in (-1,0,True,1.5):
            with self.assertRaises(ValueError):call(source_total=invalid)

    def test_latest_price_nonnegative_and_missing_fields_complete(self):
        value=row(True);value["最新价"]=-1
        with self.assertRaises(ValueError):call([value],kind="industry_stocks",industry_name="示例")
        value["最新价"]=0
        self.assertEqual(call([value],kind="industry_stocks",industry_name="示例")["rows"][0]["latest_price_cny"],0)
        for field in ("最新价","今日涨跌幅","今日主力净流入-净额","今日主力净流入-净占比"):value[field]=None
        missing=call([value],kind="industry_stocks",industry_name="示例")["rows"][0]["missing_fields"]
        self.assertEqual(set(missing),{"latest_price_cny","price_return_pct","order_bucket_net_cny.main","order_bucket_provider_share_pct.main"})
        self.assertNotIn("latest_price_cny",call()["rows"][0]["missing_fields"])

    def test_no_inference_from_order_buckets(self):
        value=row(); value["今日大单净流入-净额"]=500000
        self.assertEqual(call([value])["rows"][0]["main_order_flow_cny"],-12345.5)

if __name__ == '__main__': unittest.main()
