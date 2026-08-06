#!/usr/bin/env python3
"""
Sync ALL leads from the ELC Postgres DB into the Google Sheet (Apps Script webhook).
Same 24 columns as the Leads "Export CSV".

Setup (once):   pip install psycopg2-binary
Run:            python sync_leads_to_sheet.py

⚠️ This file contains your DB password — do NOT commit it. Delete it after use.
"""

import json
import time
from urllib.parse import urlparse
import urllib.request
import psycopg2
import psycopg2.extras

# ── Config ─────────────────────────────────────────────────────────────
DATABASE_URL = "postgresql://postgres.zvaeyvesemijedqcofoe:lctOx5mBvlOMlzR3@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connect_timeout=15&schema=elc"
WEBHOOK = "https://script.google.com/macros/s/AKfycbwAQO612dgq9h5I33URaw2FOBgf6rPHuchkP1lgxOTLYv3Oet5VJi9Lm-dzUPjbg-Wj/exec"

HEADER = [
    "Date", "Event", "Booth", "Visitor Type", "Source", "Status",
    "Company", "Name", "Mobile", "Email", "Designation",
    "City", "State", "Country", "Website", "GST", "Industry",
    "Annual Turnover", "Products Interested", "Budget", "Remarks",
    "Category", "BNI Chapter", "Notes",
]


def pick(d, keys):
    for k in keys:
        v = d.get(k)
        if v is not None and str(v).strip():
            return str(v)
    return ""


def build_row(r):
    d = r["raw_form_data"] or {}
    if isinstance(d, str):
        d = json.loads(d)
    return [
        r["created_at"].isoformat() if r["created_at"] else "",
        r["event"] or "", r["booth"] or "", r["visitor_type"] or "",
        r["source"] or "", r["status"] or "",
        pick(d, ["companyName", "company_name", "company", "organization"]),
        pick(d, ["contactPerson", "contact_person", "name", "full_name", "fullName", "contactName"]),
        pick(d, ["mobileNumber", "mobile_number", "phone", "phoneNumber", "phone_number", "mobile"]),
        pick(d, ["email", "emailAddress", "email_address"]),
        pick(d, ["designation", "title", "role"]),
        pick(d, ["city"]), pick(d, ["state"]), pick(d, ["country"]),
        pick(d, ["website", "url", "web"]),
        pick(d, ["gstNumber", "gst_number", "gst"]),
        pick(d, ["industry"]),
        pick(d, ["annualTurnover", "annual_turnover"]),
        pick(d, ["productsInterested", "products_interested"]),
        pick(d, ["budget"]), pick(d, ["remarks"]),
        pick(d, ["category"]),
        pick(d, ["bni_chapter", "bniChapter"]),
        pick(d, ["notes"]),
    ]


def post(payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(WEBHOOK, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=25) as resp:
        return resp.read().decode()[:80]


def main():
    u = urlparse(DATABASE_URL)
    conn = psycopg2.connect(
        host=u.hostname, port=u.port, user=u.username, password=u.password,
        dbname=u.path.lstrip("/"), options="-c search_path=elc", connect_timeout=15,
    )
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT l.created_at, l.source, l.status, l.raw_form_data,
               e.name AS event, b.name AS booth, vt.name AS visitor_type
        FROM leads l
        LEFT JOIN events e         ON e.id  = l.event_id
        LEFT JOIN booths b         ON b.id  = l.booth_id
        LEFT JOIN visitor_types vt ON vt.id = l.visitor_type_id
        ORDER BY l.created_at ASC
    """)
    leads = cur.fetchall()
    cur.close()
    conn.close()

    total = len(leads)
    print(f"Found {total} leads. Pushing to the sheet…\n")
    ok = fail = 0
    for i, r in enumerate(leads, 1):
        payload = {"header": HEADER, "row": build_row(r)}   # header only used when the sheet is empty
        try:
            post(payload)
            ok += 1
        except Exception as ex:
            fail += 1
            print(f"  [{i}] FAILED: {ex}")
        if i % 10 == 0 or i == total:
            print(f"  {i}/{total}  (ok {ok}, fail {fail})")
        time.sleep(0.25)  # be gentle on Apps Script

    print(f"\nDONE — synced {ok}, failed {fail} of {total}.")


if __name__ == "__main__":
    main()
