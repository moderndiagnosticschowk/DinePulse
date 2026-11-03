#!/usr/bin/env python3
"""Parse repository SQL files with PostgreSQL's grammar before merge."""

from pathlib import Path
import sys

from pglast import parse_sql

ROOT = Path(__file__).resolve().parents[1]
SQL_ROOTS = (ROOT / "supabase" / "migrations", ROOT / "supabase" / "tests")


def main() -> int:
    files = sorted(
        path
        for root in SQL_ROOTS
        if root.exists()
        for path in root.rglob("*.sql")
    )
    if not files:
        print("No SQL files found under supabase/migrations or supabase/tests.")
        return 1

    failures = 0
    for path in files:
        try:
            parse_sql(path.read_text(encoding="utf-8"))
            print(f"PASS {path.relative_to(ROOT)}")
        except Exception as error:  # pglast exposes parser errors as exceptions
            failures += 1
            print(f"FAIL {path.relative_to(ROOT)}: {error}", file=sys.stderr)

    print(f"Validated {len(files)} SQL files; failures: {failures}.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
