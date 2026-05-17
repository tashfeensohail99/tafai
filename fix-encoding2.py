"""
Comprehensive binary-level encoding fix for triple and double-encoded mojibake.
All sequences were computed by tracing UTF-8 bytes through CP1252 misinterpretation.
"""
import os

# All files still showing encoding issues after previous passes
FILES = [
    'apps/frontend/app/(admin)/admin/documents/page.tsx',
    'apps/frontend/app/(admin)/admin/finance/page.tsx',
    'apps/frontend/app/(admin)/admin/workflow/page.tsx',
    'apps/frontend/app/(employee)/sales/inbox/page.tsx',
    'apps/frontend/components/admin/AuditLogPage.tsx',
    'apps/frontend/components/admin/UsersAdminPage.tsx',
    'apps/frontend/components/admin/WhatsAppAdminPage.tsx',
    'apps/frontend/components/employee/SalesDashboardPage.tsx',
    'apps/frontend/components/employee/SalesFollowUpsPage.tsx',
    'apps/frontend/components/employee/SalesLeadsPage.tsx',
    'apps/frontend/components/finance/FinanceCorrectionDetailPage.tsx',
    'apps/frontend/components/finance/FinanceCorrectionsPage.tsx',
    'apps/frontend/components/processing/CorrectionRequestModal.tsx',
    'apps/frontend/components/processing/ProcessingReportsPage.tsx',
    'apps/frontend/components/whatsapp/WhatsAppChatPanel.tsx',
]

# TRIPLE-ENCODED sequences (3 passes of UTF-8→CP1252 misread)
# Format: (bad_bytes, correct_utf8_bytes, label)
TRIPLE_FIXES = [
    # ellipsis … U+2026
    (b'\xc3\x83\xc2\xa2\xc3\xa2\xe2\x80\x9a\xc2\xac\xc3\x82\xc2\xa6',
     b'\xe2\x80\xa6', 'ellipsis'),
    # em dash — U+2014
    (b'\xc3\x83\xc2\xa2\xc3\xa2\xe2\x80\x9a\xc2\xac\xc3\xa2\xe2\x82\xac\xc2\x9d',
     b'\xe2\x80\x94', 'em-dash triple'),
    # en dash – U+2013
    (b'\xc3\x83\xc2\xa2\xc3\xa2\xe2\x80\x9a\xc2\xac\xc3\xa2\xe2\x80\x9e\xc2\x9b',
     b'\xe2\x80\x93', 'en-dash triple'),
    # right double quote " U+201D
    (b'\xc3\x83\xc2\xa2\xc3\xa2\xe2\x80\x9a\xc2\xac\xc3\xa2\xe2\x80\x9e\xc2\xa2',
     b'\xe2\x80\x9d', 'right-dquote triple'),
    # left double quote " U+201C
    (b'\xc3\x83\xc2\xa2\xc3\xa2\xe2\x80\x9a\xc2\xac\xc3\x85\xe2\x80\x9c',
     b'\xe2\x80\x9c', 'left-dquote triple'),
    # right single quote ' U+2019
    (b'\xc3\x83\xc2\xa2\xc3\xa2\xe2\x80\x9a\xc2\xac\xc3\xa2\xe2\x82\xac\xe2\x80\x99',
     b'\xe2\x80\x99', 'right-squote triple'),
    # left single quote ' U+2018
    (b'\xc3\x83\xc2\xa2\xc3\xa2\xe2\x80\x9a\xc2\xac\xc3\xa2\xe2\x82\xac\xe2\x80\x98',
     b'\xe2\x80\x98', 'left-squote triple'),
    # bullet • U+2022
    (b'\xc3\x83\xc2\xa2\xc3\xa2\xe2\x80\x9a\xc2\xac\xc3\xa2\xe2\x80\x9e\xc2\xa2',
     b'\xe2\x80\xa2', 'bullet triple'),
]

# DOUBLE-ENCODED sequences (2 passes)
DOUBLE_FIXES = [
    # em dash — U+2014
    (b'\xc3\xa2\xe2\x82\xac\xe2\x80\x9d', b'\xe2\x80\x94', 'em-dash double'),
    # en dash – U+2013
    (b'\xc3\xa2\xe2\x82\xac\xe2\x80\x9c', b'\xe2\x80\x93', 'en-dash double'),
    # ellipsis … U+2026
    (b'\xc3\xa2\xe2\x82\xac\xc2\xa6', b'\xe2\x80\xa6', 'ellipsis double'),
    # right single quote ' U+2019
    (b'\xc3\xa2\xe2\x82\xac\xe2\x80\x99', b'\xe2\x80\x99', 'right-squote double'),
    # left single quote ' U+2018
    (b'\xc3\xa2\xe2\x82\xac\xe2\x80\x98', b'\xe2\x80\x98', 'left-squote double'),
    # right double quote " U+201D
    (b'\xc3\xa2\xe2\x82\xac\xe2\x80\x9d', b'\xe2\x80\x9d', 'right-dquote double'),
    # left double quote " U+201C  (via latin small oe œ)
    (b'\xc3\xa2\xe2\x82\xac\xc5\x93', b'\xe2\x80\x9c', 'left-dquote double'),
    # bullet • U+2022
    (b'\xc3\xa2\xe2\x82\xac\xe2\x80\xa2', b'\xe2\x80\xa2', 'bullet double'),
    # trademark ™ U+2122
    (b'\xc3\xa2\xe2\x82\xac\xc2\xa2', b'\xe2\x84\xa2', 'trademark double'),
]

# Apply longest patterns first to avoid partial matches
ALL_FIXES = sorted(TRIPLE_FIXES + DOUBLE_FIXES, key=lambda x: -len(x[0]))

total_fixed = 0
for fpath in FILES:
    fp = fpath.replace('/', os.sep)
    if not os.path.exists(fp):
        print(f'MISSING: {fp}')
        continue
    with open(fp, 'rb') as f:
        data = f.read()
    original = data
    for bad, good, label in ALL_FIXES:
        if bad in data:
            count = data.count(bad)
            data = data.replace(bad, good)
    if data != original:
        # Validate result is valid UTF-8
        try:
            data.decode('utf-8')
            with open(fp, 'wb') as f:
                f.write(data)
            print(f'Fixed:  {fp}')
            total_fixed += 1
        except UnicodeDecodeError as e:
            print(f'ERROR (invalid UTF-8 after fix, reverting): {fp} - {e}')
    else:
        print(f'Clean:  {fp}')

print(f'\nFixed {total_fixed} files.')
