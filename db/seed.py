#!/usr/bin/env python3
"""
RailCast — load the local data into Supabase.

Run ONCE after creating the tables with db/schema.sql. Uses the Supabase REST
API with your SERVICE ROLE key (secret — never commit it, never put it in the
browser). It reads the JSON files in ../data and (re)loads every table.

    export SUPABASE_URL="https://YOURPROJECT.supabase.co"
    export SUPABASE_SERVICE_KEY="eyJ...your service_role key..."
    python3 db/seed.py

Idempotent: it clears each table first, so you can re-run it after regenerating
the data. Only stdlib is used (urllib) — no pip installs.
"""
import os, json, sys, urllib.request, urllib.error
from pathlib import Path

URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
if not URL or not KEY:
    sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables first.")

DATA = Path(__file__).resolve().parent.parent / "data"
HEAD = {
    "apikey": KEY,
    "Authorization": "Bearer " + KEY,
    "Content-Type": "application/json",
}

def _req(method, path, body=None, prefer=None):
    h = dict(HEAD)
    if prefer:
        h["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(URL + "/rest/v1/" + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status
    except urllib.error.HTTPError as e:
        sys.exit(f"\n{method} {path} failed: HTTP {e.code}\n{e.read().decode()[:500]}")

def clear(table, filt):
    _req("DELETE", f"{table}?{filt}", prefer="return=minimal")

def insert(table, rows, chunk=1000):
    for i in range(0, len(rows), chunk):
        _req("POST", table, rows[i:i + chunk], prefer="return=minimal")
    print(f"  {table}: {len(rows)} rows")

def load(name):
    return json.loads((DATA / name).read_text())

def main():
    trains_raw = load("trains.json")
    runs       = load("runs.json")
    live       = load("live.json")
    model      = load("model.json")
    metrics    = load("metrics.json")

    # --- reshape into table rows -------------------------------------------
    trains, stations = [], []
    for no, t in trains_raw.items():
        trains.append({"train_no": no, "name": t["name"], "type": t["type"]})
        for s in t["stations"]:
            stations.append({"train_no": no, "seq": s["seq"], "code": s["code"], "name": s["name"],
                             "km": s["km"], "sched_arr": s.get("sched_arr"),
                             "sched_dep": s.get("sched_dep"), "halt_min": s.get("halt_min", 0)})
    live_rows = [{
        "train_no": L["train_no"], "run_date": L.get("run_date"),
        "last_reported_station_seq": L.get("last_reported_station_seq"),
        "ref_seq": L.get("refSeq", L.get("last_reported_station_seq")),
        "current_delay_min": L.get("current_delay_min"),
        "reported_at_epoch": L.get("reported_at_epoch"),
        "ground_truth_date": L.get("groundTruthDate"),
        "actual_delay": L.get("actualDelay"), "source": "seed",
    } for L in live]
    artifacts = [{"name": "model", "data": model}, {"name": "metrics", "data": metrics}]

    # --- clear (children first) --------------------------------------------
    print("clearing existing rows...")
    for tbl, filt in [("stations", "train_no=not.is.null"), ("runs", "id=not.is.null"),
                      ("live_trains", "train_no=not.is.null"), ("trains", "train_no=not.is.null"),
                      ("model_artifacts", "name=not.is.null")]:
        clear(tbl, filt)

    # --- insert (parents first) --------------------------------------------
    print("inserting...")
    insert("trains", trains)
    insert("stations", stations)
    insert("runs", runs)                 # ~32k rows, chunked
    insert("live_trains", live_rows)
    insert("model_artifacts", artifacts)
    print(f"\nDone. Loaded {len(trains)} trains, {len(stations)} stations, "
          f"{len(runs)} runs, {len(live_rows)} live trains, model + metrics.")

if __name__ == "__main__":
    main()
