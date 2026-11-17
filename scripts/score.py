#!/usr/bin/env python3
"""Score a bug-hunt result against the bugs planted in playground/.

Usage: python3 scripts/score.py reports/bug-hunt/result.json [--tolerance 3]

The result file may be the full bug-hunt result ({"confirmed": [...], ...}) or a
plain list of findings. Each finding needs "file" and "line". A finding matches a
planted bug when the file paths share a suffix and the lines are within
--tolerance of each other. The key is base64-encoded in scripts/.planted_key so
hunting agents don't stumble on the answers; don't decode it in front of them.
"""
import argparse
import base64
import json
import sys
from pathlib import Path

KEY = Path(__file__).with_name(".planted_key")


def same_file(a: str, b: str) -> bool:
    a, b = a.lstrip("./"), b.lstrip("./")
    return a == b or a.endswith("/" + b) or b.endswith("/" + a)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("result")
    ap.add_argument("--tolerance", type=int, default=3)
    a = ap.parse_args()
    key = json.loads(base64.b64decode(KEY.read_text()))
    data = json.loads(Path(a.result).read_text())
    findings = data.get("confirmed", data) if isinstance(data, dict) else data

    found, false_pos = set(), []
    for f in findings:
        hit = next((k for k in key if same_file(f.get("file", ""), k["file"])
                    and abs(int(f.get("line", -999)) - k["line"]) <= a.tolerance), None)
        if hit:
            found.add(hit["id"])
        else:
            false_pos.append(f)

    print(f"Found {len(found)} / {len(key)} planted bugs")
    for k in key:
        mark = "x" if k["id"] in found else " "
        print(f"  [{mark}] {k['file']}:{k['line']}  {k['bug']}")
    if false_pos:
        print(f"\n{len(false_pos)} confirmed finding(s) not in the key (may still be real bugs):")
        for f in false_pos:
            print(f"  - {f.get('file')}:{f.get('line')}  {f.get('title', '')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
