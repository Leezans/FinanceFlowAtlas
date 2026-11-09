"""Offline SQLite migration evidence; no workerd, network, credentials or D1 claims."""
from pathlib import Path
import json
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = sorted((ROOT / "drizzle").glob("[0-9][0-9][0-9][0-9]*.sql"))
assert len(MIGRATIONS) == 27
assert MIGRATIONS[-1].name == "0026_news_asia_technology.sql"
assert [entry["tag"] + ".sql" for entry in json.loads(
    (ROOT / "drizzle/meta/_journal.json").read_text())["entries"]] == [p.name for p in MIGRATIONS]


def apply(db, migration):
    # Individual executes in one transaction; executescript would implicitly commit.
    with db:
        db.execute("BEGIN")
        for sql in migration.read_text().split("--> statement-breakpoint"):
            if sql.strip():
                db.execute(sql)


def rows(db):
    return db.execute("SELECT * FROM news_source_gate ORDER BY id").fetchall()


with sqlite3.connect(":memory:") as db:
    for migration in MIGRATIONS[:-1]:
        apply(db, migration)
    db.execute("UPDATE news_source_gate SET status='busy',lease_token='owned',payload='{}',attempted_ms=11,updated_ms=12,not_before_ms=13 WHERE id='fed-press'")
    db.execute("UPDATE news_source_gate SET status='blocked',error_text='http_403',attempted_ms=21,updated_ms=22,not_before_ms=23 WHERE id='nist-news'")
    db.commit()
    before = rows(db)
    assert len(before) == 9
    tables = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='news_source_gate' ORDER BY name")]
    unrelated = {table: db.execute(f'SELECT * FROM "{table}"').fetchall() for table in tables}
    apply(db, MIGRATIONS[-1])
    after = rows(db)
    new_ids = {"taiwan-nstc", "japan-digital-agency"}
    assert len(after) == 11
    assert [row for row in after if row[0] not in new_ids] == before
    assert all(row[1:] == ("idle", None, None, None, 0, 0, 0) for row in after if row[0] in new_ids)
    try:
        apply(db, MIGRATIONS[-1])
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError("Duplicate migration unexpectedly succeeded")
    assert rows(db) == after
    assert db.execute("SELECT name FROM sqlite_master WHERE name='news_source_gate_next'").fetchall() == []
    assert {table: db.execute(f'SELECT * FROM "{table}"').fetchall() for table in tables} == unrelated
print("PASS: 27 migrations match journal; 11 news rows; old states preserved; duplicate rollback; unrelated tables unchanged (in-memory SQLite, not native D1)")
