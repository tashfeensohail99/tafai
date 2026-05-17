# Fix garbled UTF-8 characters (mojibake) across all frontend files.
# These appear when UTF-8 bytes are stored/read as Latin-1.

import os

# Each tuple: (garbled_string, correct_replacement)
# Ordered longest-first to avoid partial replacements.
REPLACEMENTS = [
    # ellipsis variants
    ("Ã¢â‚¬Â¦", "..."),
    ("â€¦", "..."),
    # em dash
    ("Ã¢â‚¬â€", "\u2014"),
    ("â€"", "\u2014"),
    # right single curly quote / apostrophe
    ("â€™", "\u2019"),
    # left single curly quote
    ("â€˜", "\u2018"),
    # left double quote
    ("â€œ", "\u201c"),
    # right double quote (trailing junk)
    ("â€", "\u201d"),
    # en dash
    ("â€"", "\u2013"),
    # bullet
    ("â€¢", "\u2022"),
    # middle dot / Â·
    ("Â·", "\u00b7"),
    # non-breaking space
    ("Â ", "\u00a0"),
    # é
    ("Ã©", "\u00e9"),
    # —  (already correct but just in case double encoded)
]

FILES = [
    "apps/frontend/components/admin/AuditLogPage.tsx",
    "apps/frontend/components/admin/UsersAdminPage.tsx",
    "apps/frontend/components/admin/WhatsAppAdminPage.tsx",
    "apps/frontend/components/employee/SalesFollowUpsPage.tsx",
    "apps/frontend/components/employee/SalesLeadsPage.tsx",
    "apps/frontend/components/finance/FinanceCorrectionDetailPage.tsx",
    "apps/frontend/components/finance/FinanceCorrectionsPage.tsx",
    "apps/frontend/components/whatsapp/WhatsAppChatPanel.tsx",
    "apps/frontend/app/(admin)/admin/documents/page.tsx",
    "apps/frontend/app/(admin)/admin/finance/page.tsx",
    "apps/frontend/app/(admin)/admin/workflow/page.tsx",
    "apps/frontend/app/(employee)/sales/inbox/page.tsx",
]

for fpath in FILES:
    if not os.path.exists(fpath):
        print(f"MISSING: {fpath}")
        continue
    with open(fpath, "r", encoding="utf-8") as f:
        content = f.read()
    original = content
    for bad, good in REPLACEMENTS:
        content = content.replace(bad, good)
    if content != original:
        with open(fpath, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"Fixed:  {fpath}")
    else:
        print(f"Clean:  {fpath}")

print("\nDone.")
