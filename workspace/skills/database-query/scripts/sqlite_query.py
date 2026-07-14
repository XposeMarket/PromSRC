#!/usr/bin/env python3
"""Execute one parameterized SQLite statement and emit a JSON result."""

import argparse
import json
import pathlib
import sqlite3
import sys
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", required=True, help="Path to the SQLite database")
    query = parser.add_mutually_exclusive_group(required=True)
    query.add_argument("--sql", help="One SQL statement")
    query.add_argument("--sql-file", help="UTF-8 file containing one SQL statement")
    parser.add_argument("--params", default="[]", help="JSON array or object of bound parameters")
    parser.add_argument("--write", action="store_true", help="Allow and commit a mutating statement")
    return parser.parse_args()


def load_params(raw: str) -> Any:
    value = json.loads(raw)
    if not isinstance(value, (list, dict)):
        raise ValueError("--params must decode to a JSON array or object")
    return value


def main() -> int:
    args = parse_args()
    db_path = pathlib.Path(args.db).expanduser().resolve()
    sql = args.sql if args.sql is not None else pathlib.Path(args.sql_file).read_text(encoding="utf-8")
    params = load_params(args.params)

    if args.write:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(str(db_path))
    else:
        if not db_path.is_file():
            raise FileNotFoundError(f"SQLite database does not exist: {db_path}")
        connection = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)

    connection.row_factory = sqlite3.Row
    try:
        cursor = connection.execute(sql, params)
        rows = [dict(row) for row in cursor.fetchall()] if cursor.description else []
        if args.write:
            connection.commit()
        result = {
            "database": str(db_path),
            "read_only": not args.write,
            "columns": [item[0] for item in cursor.description] if cursor.description else [],
            "rows": rows,
            "row_count": len(rows),
            "changes": cursor.rowcount if cursor.rowcount >= 0 else 0,
        }
        print(json.dumps(result, indent=2, default=str))
        return 0
    except Exception:
        if args.write:
            connection.rollback()
        raise
    finally:
        connection.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        raise SystemExit(1)
