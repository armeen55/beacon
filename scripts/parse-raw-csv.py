#!/usr/bin/env python3
"""Parse Profound raw execution CSV with proper multiline/quote handling.

Usage: python3 scripts/parse-raw-csv.py <path_to_csv>

Outputs NDJSON to stdout (one JSON object per data row).
"""
import csv
import json
import sys

csv.field_size_limit(sys.maxsize)

with open(sys.argv[1], "r", encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    for row in reader:
        print(json.dumps(row, ensure_ascii=False))
