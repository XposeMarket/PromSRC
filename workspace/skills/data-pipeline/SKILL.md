---
name: Data Pipeline
description: Read, transform, and write data files reliably. Use for CSV processing, JSON transformation, data cleaning, bulk file operations, chunked large-file handling, deduplication, filtering, aggregation, and writing output reports. Triggers on: CSV, data file, spreadsheet, transform data, process rows, clean data, pipeline, large file, chunk, parse data, ETL, export data, aggregate, filter records, deduplicate.
emoji: 🔄
version: 1.0.0
triggers: CSV, data file, spreadsheet, transform, process rows, clean data, pipeline, large file, chunk, parse data, ETL, export, aggregate, filter records, deduplicate, tsv, json data, batch process
---

# Data Pipeline

Read, transform, and write data correctly. Use this before writing any data processing code.

---

## 1. Reading Data

### CSV
```python
import csv

# Simple read
with open("data.csv", newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    rows = list(reader)

# With type coercion
rows = []
with open("data.csv", newline="", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        rows.append({
            "id": int(row["id"]),
            "value": float(row["value"]),
            "name": row["name"].strip()
        })
```

### JSON
```python
import json

with open("data.json", encoding="utf-8") as f:
    data = json.load(f)

# JSONL (one JSON object per line)
records = []
with open("data.jsonl", encoding="utf-8") as f:
    for line in f:
        if line.strip():
            records.append(json.loads(line))
```

### Excel (openpyxl)
```python
import openpyxl

wb = openpyxl.load_workbook("data.xlsx")
ws = wb.active
headers = [cell.value for cell in ws[1]]
rows = []
for row in ws.iter_rows(min_row=2, values_only=True):
    rows.append(dict(zip(headers, row)))
```

---

## 2. Transforming Data

### Clean & Normalize
```python
def clean_row(row):
    return {
        "id": str(row.get("id", "")).strip(),
        "email": row.get("email", "").strip().lower(),
        "name": row.get("name", "").strip().title(),
        "amount": float(row.get("amount") or 0),
    }

cleaned = [clean_row(r) for r in rows if r.get("id")]
```

### Filter
```python
active = [r for r in rows if r["status"] == "active"]
recent = [r for r in rows if r["date"] >= "2024-01-01"]
```

### Deduplicate
```python
seen = set()
unique = []
for row in rows:
    key = row["email"]  # or tuple of multiple fields
    if key not in seen:
        seen.add(key)
        unique.append(row)
```

### Aggregate
```python
from collections import defaultdict

by_category = defaultdict(list)
for row in rows:
    by_category[row["category"]].append(row)

totals = {cat: sum(r["amount"] for r in items) for cat, items in by_category.items()}
```

### Sort
```python
sorted_rows = sorted(rows, key=lambda r: r["date"], reverse=True)
# Multi-key sort
sorted_rows = sorted(rows, key=lambda r: (r["category"], -r["amount"]))
```

---

## 3. Writing Output

### CSV
```python
import csv

with open("output.csv", "w", newline="", encoding="utf-8") as f:
    if rows:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
```

### JSON
```python
with open("output.json", "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False, default=str)

# JSONL
with open("output.jsonl", "w", encoding="utf-8") as f:
    for record in records:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
```

---

## 4. Large Files (Chunked Processing)

Never load huge files entirely into memory. Process in chunks:

```python
def process_large_csv(input_path, output_path, chunk_size=10_000):
    processed = 0

    with open(input_path, newline="", encoding="utf-8") as infile, \
         open(output_path, "w", newline="", encoding="utf-8") as outfile:

        reader = csv.DictReader(infile)
        writer = None

        chunk = []
        for row in reader:
            chunk.append(transform(row))  # your transform function

            if len(chunk) >= chunk_size:
                if writer is None:
                    writer = csv.DictWriter(outfile, fieldnames=chunk[0].keys())
                    writer.writeheader()
                writer.writerows(chunk)
                processed += len(chunk)
                print(f"Processed {processed} rows...")
                chunk = []

        if chunk:
            if writer is None:
                writer = csv.DictWriter(outfile, fieldnames=chunk[0].keys())
                writer.writeheader()
            writer.writerows(chunk)
            processed += len(chunk)

    print(f"Done. Total: {processed} rows")
```

---

## 5. Validation

Always validate before writing output:

```python
def validate_row(row, row_num):
    errors = []
    if not row.get("id"):
        errors.append(f"Row {row_num}: missing id")
    if not row.get("email") or "@" not in row["email"]:
        errors.append(f"Row {row_num}: invalid email")
    if row.get("amount") is not None and float(row["amount"]) < 0:
        errors.append(f"Row {row_num}: negative amount")
    return errors

all_errors = []
for i, row in enumerate(rows, 1):
    all_errors.extend(validate_row(row, i))

if all_errors:
    print(f"Found {len(all_errors)} validation errors:")
    for e in all_errors[:20]:  # show first 20
        print(f"  {e}")
```

---

## 6. Pipeline Pattern (composable)

```python
def run_pipeline(input_path, output_path):
    print(f"Reading: {input_path}")
    rows = read_csv(input_path)
    print(f"  Read {len(rows)} rows")

    rows = [clean_row(r) for r in rows]
    rows = [r for r in rows if r["id"]]  # filter invalid
    rows = deduplicate(rows, key="email")
    print(f"  After cleaning: {len(rows)} rows")

    errors = []
    for i, row in enumerate(rows, 1):
        errors.extend(validate_row(row, i))
    if errors:
        raise ValueError(f"{len(errors)} validation errors found")

    write_csv(rows, output_path)
    print(f"Output written: {output_path} ({len(rows)} rows)")
    return len(rows)
```

---

## 7. Quick Checklist

Before processing any data file:
- [ ] What's the encoding? (usually utf-8, sometimes latin-1)
- [ ] Does it have a header row?
- [ ] What are the key fields and their types?
- [ ] How large is the file? (use chunking if >100MB or >500k rows)
- [ ] Are there known dirty/missing values to handle?
- [ ] What's the output format and destination?
- [ ] Is a validation step needed before writing?
