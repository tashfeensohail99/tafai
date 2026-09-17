"""Download recent face-capture images so you can actually look at them.

    apps/face-worker/.venv/Scripts/python.exe scripts/pull_captures.py
    ... --limit 40 --matched-only

Captures live in Supabase S3 storage (bucket `receipts`, prefix
`attendance-faces/`), not on local disk, and the bucket is not public — so
there is no URL you can just paste into a browser. This signs the requests
with the STORAGE_* credentials from .env and writes the files locally,
naming each one with its channel, match status and similarity so the folder
itself tells you how the system is performing.

Output:  Desktop/attendance-captures/
         42_MATCHED_0.844_18-33-05.jpg
         41_UNMATCHED_0.381_18-31-17.jpg
"""

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

import boto3
from botocore.config import Config

ENV = Path(__file__).resolve().parent.parent / ".env"


def env(name: str, default: str = "") -> str:
    if not ENV.exists():
        return default
    for line in ENV.read_text(encoding="utf8", errors="ignore").splitlines():
        line = line.strip()
        if line.startswith(f"{name}=") and not line.startswith("#"):
            return line.split("=", 1)[1].strip()
    return default


def rows(limit: int, matched_only: bool):
    """Read straight from Postgres — no API endpoint exposes these."""
    conds = ['"imageObjectKey" IS NOT NULL']
    if matched_only:
        conds.append("status='MATCHED'")
    sql = (
        'SELECT "channelId", status, COALESCE(ROUND(similarity::numeric,3),0), '
        '"capturedAt", "imageObjectKey" FROM core.face_capture_events WHERE '
        + " AND ".join(conds)
        + f' ORDER BY "capturedAt" DESC LIMIT {int(limit)};'
    )
    out = subprocess.run(
        ["docker", "exec", "-e", "PGPASSWORD=postgres", "tafai-pg",
         "psql", "-U", "postgres", "-d", "tafai", "-t", "-A", "-F", "|", "-c", sql],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        sys.exit(f"could not read the database:\n{out.stderr[:400]}")
    for line in out.stdout.replace("\r", "").strip().splitlines():
        parts = line.split("|")
        if len(parts) == 5:
            yield parts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=25)
    ap.add_argument("--matched-only", action="store_true")
    ap.add_argument("--out", default=str(Path.home() / "Desktop" / "attendance-captures"))
    args = ap.parse_args()

    bucket = env("STORAGE_BUCKET", "receipts")
    s3 = boto3.client(
        "s3",
        endpoint_url=env("STORAGE_ENDPOINT"),
        aws_access_key_id=env("STORAGE_ACCESS_KEY"),
        aws_secret_access_key=env("STORAGE_SECRET_KEY"),
        region_name=env("STORAGE_REGION", "ap-northeast-2"),
        config=Config(signature_version="s3v4"),
    )

    dest = Path(args.out)
    dest.mkdir(parents=True, exist_ok=True)
    print(f"\n  bucket: {bucket}\n  into:   {dest}\n")

    got = fail = 0
    for ch, status, sim, when, key in rows(args.limit, args.matched_only):
        # 2026-07-20 13:31:48 -> 18-31-48 is confusing; keep the DB's own clock.
        stamp = re.sub(r"[^0-9]", "-", when.split(" ")[-1])[:8]
        name = f"{ch}_{status}_{sim}_{stamp}.jpg"
        try:
            s3.download_file(bucket, key, str(dest / name))
            print(f"  {name}")
            got += 1
        except Exception as e:
            print(f"  FAILED {key}: {str(e)[:90]}")
            fail += 1

    print(f"\n  {got} image(s) downloaded"
          + (f", {fail} failed" if fail else "")
          + f"\n  open: {dest}\n")
    if got and os.name == "nt":
        os.startfile(dest)  # noqa: S606 — convenience, opens Explorer


if __name__ == "__main__":
    main()
