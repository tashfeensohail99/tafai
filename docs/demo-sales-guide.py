"""
Builds docs/demo-sales-guide.pdf — the plain-language guide for the Summit
sales team on running the CRM demo for prospective immigration consultancies.

    python docs/demo-sales-guide.py [login_screenshot.jpg] [inbox_screenshot.jpg]
"""
import os
import sys
from datetime import date

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table,
                                TableStyle)

OUT = os.path.join(os.path.dirname(__file__), 'demo-sales-guide.pdf')
LOGIN_SHOT = sys.argv[1] if len(sys.argv) > 1 and os.path.exists(sys.argv[1]) else None
INBOX_SHOT = sys.argv[2] if len(sys.argv) > 2 and os.path.exists(sys.argv[2]) else None

DEMO_URL = 'https://demo.summitautomates.com'
FALLBACK_URL = 'https://frontend-production-488d.up.railway.app'
DOMAIN = 'summit.demo'

NAVY = colors.HexColor('#0f172a')
ACCENT = colors.HexColor('#4f46e5')
MUTED = colors.HexColor('#475569')
SOFT = colors.HexColor('#eef2ff')
WARN = colors.HexColor('#fff7ed')
WARN_B = colors.HexColor('#fb923c')
OK = colors.HexColor('#ecfdf5')
OK_B = colors.HexColor('#34d399')

ss = getSampleStyleSheet()
H1 = ParagraphStyle('H1', parent=ss['Heading1'], fontSize=20, leading=24, textColor=NAVY, spaceBefore=6, spaceAfter=10)
H2 = ParagraphStyle('H2', parent=ss['Heading2'], fontSize=14, leading=18, textColor=ACCENT, spaceBefore=14, spaceAfter=6)
H3 = ParagraphStyle('H3', parent=ss['Heading3'], fontSize=11.5, leading=15, textColor=NAVY, spaceBefore=8, spaceAfter=3)
P = ParagraphStyle('P', parent=ss['BodyText'], fontSize=10.2, leading=14.5, textColor=colors.HexColor('#1e293b'), spaceAfter=5)
SMALL = ParagraphStyle('Small', parent=P, fontSize=8.8, leading=12, textColor=MUTED)
BUL = ParagraphStyle('Bul', parent=P, leftIndent=12, bulletIndent=2, spaceAfter=3)
SAY = ParagraphStyle('Say', parent=P, leftIndent=10, textColor=NAVY, backColor=SOFT, borderPadding=(5, 6, 5, 6), spaceBefore=3, spaceAfter=8)
CODE = ParagraphStyle('Code', parent=P, fontName='Courier', fontSize=9.4, leading=12.5)
TITLE = ParagraphStyle('Title', parent=ss['Title'], fontSize=26, leading=32, textColor=NAVY, alignment=TA_LEFT, spaceAfter=4)
SUB = ParagraphStyle('Sub', parent=P, fontSize=12.5, leading=17, textColor=MUTED, spaceAfter=18)


def bullets(items):
    return [Paragraph(f'• {t}', BUL) for t in items]


def callout(text, bg=WARN, border=WARN_B, label='Note'):
    tbl = Table([[Paragraph(f'<b>{label}.</b> {text}', P)]], colWidths=[170 * mm])
    tbl.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), bg),
        ('BOX', (0, 0), (-1, -1), 0.8, border),
        ('LEFTPADDING', (0, 0), (-1, -1), 8), ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    return [Spacer(1, 3), tbl, Spacer(1, 7)]


def table(rows, widths, header=True, font=9.2):
    data = [[Paragraph(str(c), ParagraphStyle('cell', parent=P, fontSize=font, leading=font + 3.2, spaceAfter=0)) for c in r] for r in rows]
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    style = [
        ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#cbd5e1')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 5), ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]
    if header:
        style += [('BACKGROUND', (0, 0), (-1, 0), SOFT), ('TEXTCOLOR', (0, 0), (-1, 0), NAVY)]
    t.setStyle(TableStyle(style))
    return t


def shot(path, caption, width_mm=150):
    w, h = ImageReader(path).getSize()
    img = Image(path, width=width_mm * mm, height=width_mm * mm * h / w)
    return KeepTogether([Spacer(1, 4), Paragraph(caption, SMALL), img])


def step(n, title, click, see, say):
    block = [Paragraph(f'<b>Step {n} — {title}</b>', H3)]
    block.append(Paragraph(f'<b>Click:</b> {click}', P))
    block.append(Paragraph(f'<b>What the client sees:</b> {see}', P))
    block.append(Paragraph(f'<b>Say:</b> “{say}”', SAY))
    return KeepTogether(block)


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('Helvetica', 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(20 * mm, 12 * mm, 'Summit Systems · CRM demo guide for the sales team · internal')
    canvas.drawRightString(190 * mm, 12 * mm, f'Page {doc.page}')
    canvas.restoreState()


story = []

# ───────────────────────────── cover ─────────────────────────────
story += [
    Spacer(1, 40 * mm),
    Paragraph('Showing the Summit Immigration CRM', TITLE),
    Paragraph('A step-by-step guide for the sales team: what the demo is, how to log in, how to walk a prospect through it, and how to answer their questions.', SUB),
    Paragraph(f'Version 1.0 · {date.today().strftime("%d %B %Y")}', SMALL),
    Spacer(1, 10 * mm),
]
story += callout(
    'You do not need any technical background to use this guide. If you can open a website and log in, you can run this demo. '
    'Read pages 2–4 once before your first call; keep page 6 (the walkthrough) open during the call.',
    bg=OK, border=OK_B, label='Who this is for')
story.append(PageBreak())

# ───────────────────────────── 1. what you are selling ─────────────────────────────
story.append(Paragraph('1. What you are showing, in plain words', H1))
story.append(Paragraph(
    'The product is a CRM (customer management system) built for immigration consultancies. Its centre is a shared '
    '<b>WhatsApp inbox</b>: every enquiry the company receives on its business WhatsApp number lands in one place, is '
    'answered first by an <b>AI assistant</b>, and is then routed to the right salesperson. Around that inbox sit the '
    'things an immigration office needs every day: leads, appointments, follow-ups, documents, finance, and reporting.', P))
story.append(Paragraph('The five things prospects care about most', H2))
story += bullets([
    '<b>Never miss a lead.</b> Every WhatsApp message, ad click and walk-in becomes a lead automatically.',
    '<b>Instant first reply, 24/7.</b> The AI assistant answers questions in English, Urdu or Roman Urdu, books consultations into the calendar and hands over to a human when needed.',
    '<b>Fair, measured sales team.</b> Leads are shared round-robin, every reply is timed against an SLA, managers see who is online and who is slow.',
    '<b>One record from first message to final payment.</b> The same reference code follows a person from lead to client to case to receipt.',
    '<b>Everything auditable.</b> Managers see all conversations, dispositions and finance approvals; nothing lives in a rep\'s personal phone.',
])

story.append(Paragraph('What the demo actually is', H2))
story.append(Paragraph(
    'The demo is a <b>live, working copy</b> of the system filled with a real consultancy\'s history (about 77,000 leads and '
    '680,000 WhatsApp messages), with every name, phone number, email, ID number and document replaced by realistic fakes. '
    'The company appears as “Summit Immigration Consultants”. Nothing you type in the demo can reach a real customer: '
    'sending is switched off at the deepest level, and the data resets itself every few minutes.', P))
story += callout(
    'Say “this is sample data from a live system, with names and numbers replaced” and nothing more. Do not name the '
    'consultancy the data came from, and do not describe it as “a client\'s data”.',
    label='How to describe the data')
story.append(PageBreak())

# ───────────────────────────── 2. before the call ─────────────────────────────
story.append(Paragraph('2. Before the call — 5-minute checklist', H1))
story += bullets([
    f'Open <b>{DEMO_URL}</b> in Chrome. If it does not load, use <b>{FALLBACK_URL}</b> (same demo).',
    'Log in as the <b>demo admin</b> (login table below) and make sure the dashboard and the WhatsApp inbox open.',
    'Open a second browser tab and log in as the <b>demo sales agent</b> (use an incognito/private window so both logins stay active).',
    'Pick two conversations in the inbox you like the look of — one with voice notes, one where the AI booked an appointment — and keep them open.',
    'Close other tabs, turn on Do-Not-Disturb, share only the browser window on the call.',
    'Have this guide\'s walkthrough page (page 6) next to you.',
])
story.append(Paragraph('Logins', H2))
story.append(Paragraph(f'Every login ends in <b>@{DOMAIN}</b> and every one uses the same password: <b>Summit2026!</b> (capital S, exclamation mark at the end).', P))
logins = [
    ['Login (email)', 'Password', 'What it opens', 'Use it for'],
    [f'admin@{DOMAIN}', 'Summit2026!', 'Admin — everything', 'Main demo login'],
    [f'sales@{DOMAIN}', 'Summit2026!', 'Sales agent workspace', 'Second tab: the rep\'s view'],
    [f'manager@{DOMAIN}', 'Summit2026!', 'Admin (non-super)', 'Manager questions'],
    [f'finance@{DOMAIN}', 'Summit2026!', 'Finance', 'Receipts, contracts, approvals'],
    [f'processing@{DOMAIN}', 'Summit2026!', 'Processing', 'Case pipeline, documents'],
    [f'processing.manager@{DOMAIN}', 'Summit2026!', 'Processing (manager)', 'Case oversight'],
    [f'documentation@{DOMAIN}', 'Summit2026!', 'Processing (documents)', 'Document checklists'],
    [f'reception@{DOMAIN}', 'Summit2026!', 'Reception', 'Walk-ins, consultation fees'],
    [f'marketing@{DOMAIN}', 'Summit2026!', 'Marketing', 'Meta ads, campaigns, conversions'],
    [f'hr@{DOMAIN}', 'Summit2026!', 'HR', 'Team directory, onboarding'],
    [f'jr@{DOMAIN}', 'Summit2026!', 'Judicial Review', 'Legal caseload (Canada)'],
]
story.append(table(logins, [58 * mm, 46 * mm, 34 * mm, 32 * mm], font=8.6))
story += callout('Do not share these passwords with prospects. To let a prospect try the demo themselves, give them a personal link (section 5), which expires on its own.', label='Important')
if LOGIN_SHOT:
    story.append(shot(LOGIN_SHOT, 'The login page. The yellow strip at the top is always visible in the demo: it tells everyone the data is sample data.'))
story.append(PageBreak())

# ───────────────────────────── 3. what the system does (plain tour) ─────────────────────────────
story.append(Paragraph('3. A plain-language tour of the screens', H1))
story.append(Paragraph('You will use the admin login for most of the call. The left sidebar is the menu; these are the parts that matter.', P))
tour = [
    ['Menu item', 'What it is', 'One line to say'],
    ['Dashboard', 'Today\'s numbers: new leads, conversations waiting, appointments, revenue.', '“This is what the owner sees at 9 am.”'],
    ['WhatsApp → Chats (the sales login calls it WhatsApp Inbox)', 'Every chat on the business number, newest first. Filters: All, Unread, Uncontacted, Blocked, by outcome tag.', '“Every message your team has ever received, searchable, nothing on anyone\'s phone.”'],
    ['A conversation', 'The chat itself: customer messages, AI replies (marked), human replies, voice notes with transcripts, documents.', '“Watch how the assistant answered at 2 am and booked the consultation.”'],
    ['Leads', 'The list of people who enquired, their status, outcome tag, source (which ad), owner.', '“Every lead has an owner, a status and a reason if it was lost.”'],
    ['Appointments', 'Consultations booked by the AI or by staff, with reminders.', '“The assistant books into real availability — no double booking.”'],
    ['Sales overview', 'Per-agent numbers: leads, replies on time, conversions.', '“You see who is fast and who is slow, every day.”'],
    ['WhatsApp report / Calls', 'Daily totals, response times, missed calls.', '“This goes to the manager\'s email every morning.”'],
    ['Settings → WhatsApp Team / Hours', 'Who is in the inbox rota, working hours, SLA targets.', '“You control who gets new leads and how fast they must answer.”'],
    ['Settings → Bot Knowledge', 'The facts the AI is allowed to use (fees, programs, documents).', '“The assistant only says what you have approved here.”'],
    ['Finance / Processing / Reception', 'Separate workspaces for other departments, same records.', '“Sales, finance and processing all look at the same file.”'],
]
story.append(table(tour, [40 * mm, 72 * mm, 58 * mm], font=8.6))
if INBOX_SHOT:
    story.append(shot(INBOX_SHOT, 'The WhatsApp inbox: conversation list on the left, the open chat on the right. Voice notes show as transcript cards; images and documents are blurred in the demo.'))
story.append(PageBreak())

# ───────────────────────────── 4. the walkthrough ─────────────────────────────
story.append(Paragraph('4. The 12-minute walkthrough', H1))
story.append(Paragraph('Keep this page open during the call. Each step has what to click, what the client will see, and a sentence you can say word for word.', P))
story.append(step(1, 'Open the door (1 min)', 'Log in as admin@summit.demo. Stay on the Dashboard.',
                  'A dashboard with today\'s leads, conversations, appointments and money; a yellow strip saying “Demo environment — sample data”.',
                  'This is a live copy of a working immigration CRM. Names and numbers are replaced, everything else is real: the volume, the conversations, the way the AI works.'))
story.append(step(2, 'The inbox (2 min)', 'Sidebar → WhatsApp → Chats. Scroll slowly. Click the “Unread” and “Uncontacted” filters at the top of the list.',
                  'Hundreds of WhatsApp chats with names, last message, time, owner, and outcome tags.',
                  'Every enquiry on your business number lands here. Nothing lives on a salesperson\'s personal phone, nothing is lost when someone leaves.'))
story.append(step(3, 'A real conversation with the AI (3 min)', 'Open one of the two conversations you picked before the call. Point at the AI replies and at the “AI” strip at the top of the chat.',
                  'The customer\'s questions, the assistant\'s answers in the customer\'s language, a voice note shown as a transcript, and the “Book appointment / Handed off” state.',
                  'The assistant answered within seconds, in the customer\'s own language, using only the facts the company approved. When the customer was ready it booked the consultation and handed the chat to a human.'))
story.append(step(4, 'Reply yourself (1 min)', 'Type a short reply in the box at the bottom and press send.',
                  'The message appears in the chat as sent, with a tick.',
                  'In the demo this message goes nowhere — sending is switched off so we can never bother a real person. In your system this is the customer\'s WhatsApp.'))
story.append(step(5, 'The lead behind the chat (1 min)', 'Click the customer\'s name at the top of the chat (opens the lead card). Change the outcome tag (disposition) and change it back.',
                  'The lead card: source ad, status, owner, follow-ups, appointments, notes, reference code.',
                  'One record follows the person from first message to final payment. Everyone — sales, finance, processing — looks at the same file.'))
story.append(step(6, 'The manager\'s view (2 min)', 'Sidebar → Sales overview, then Settings → WhatsApp Team.',
                  'Per-agent numbers, who is online, response-time scores; the inbox rota and working hours.',
                  'You decide who receives new leads, how fast they must answer, and you see every morning who kept the promise.'))
story.append(step(7, 'The rep\'s view (1 min)', 'Switch to the second tab (sales@summit.demo) and open WhatsApp Inbox.',
                  'A simpler screen: only this agent\'s conversations, follow-ups due today, their own numbers.',
                  'Your salespeople see only what is theirs. Simple on purpose.'))
story.append(step(8, 'Close (1 min)', 'Go back to the admin tab, Sidebar → Leads, filter by a source. Then stop sharing.',
                  'Leads grouped by the ad that produced them.',
                  'You will know which ad made money. Shall I set up a trial on your own WhatsApp number?'))
story += callout('Steps 1–4 are the demo. If you only have five minutes, do those four and stop.', bg=OK, border=OK_B, label='Short on time')
story.append(PageBreak())

# ───────────────────────────── 5. letting prospects try it ─────────────────────────────
story.append(Paragraph('5. Letting a prospect try it themselves', H1))
story.append(Paragraph('You can give a prospect a personal link that logs them straight in, without a password, for a limited time.', P))
story += bullets([
    'Log in as admin@summit.demo and open <b>/admin/settings/demo</b> (type it after the demo address in the browser).',
    'Under “New prospect link”, enter a label (company and person, e.g. “Acme Immigration — Ahmed”), choose <b>Demo admin</b> (everything) or <b>Demo sales agent</b>, set how many hours it stays valid (48 is the default) and click <b>Create link</b>.',
    'Copy the link immediately — it is shown once. Send it to the prospect.',
    'The same page shows when each link was opened and from where. Click <b>Revoke</b> to switch a link off early.',
    'Anything the prospect changes in the demo is undone automatically by the next data refresh (every few minutes), so you never need to clean up.',
])
story += callout('Never give a prospect the passwords from page 3. Links expire and can be revoked; passwords cannot.', label='Rule')

# ───────────────────────────── 6. questions you will get ─────────────────────────────
story.append(Paragraph('6. Questions you will get — and the honest answers', H1))
faq = [
    ['They ask', 'You answer'],
    ['Is this real data?', 'It is a real system\'s history with every personal detail replaced by realistic fakes. The volumes, timings and AI behaviour are real.'],
    ['Did the AI really write those replies?', 'Yes. Every reply marked as the assistant was written by the AI at the time, from the company\'s approved knowledge. Humans can take over any chat with one click.'],
    ['Does it speak Urdu?', 'English, Urdu and Roman Urdu. Voice notes in Urdu are transcribed automatically (you saw the transcript cards).'],
    ['Can I message the demo number now?', 'The “try it yourself” number is being set up; for now the demo shows past conversations. On a trial it runs on your own number from day one.'],
    ['Will it reply to the wrong thing or promise results?', 'It only uses facts you approve (Settings → Bot Knowledge), never promises outcomes, never asks for passport or card numbers, and hands over to a human when it is unsure.'],
    ['What do we need to start?', 'A WhatsApp Business number (your current one can be moved), your fee list and program facts for the assistant, and your team list. Typical setup is days, not months.'],
    ['Where is the data stored? Who can see it?', 'In the company\'s own cloud database; access is by role (sales see their leads, finance sees finance). Every action is logged.'],
    ['Does it work with Facebook/Instagram ads?', 'Yes — click-to-WhatsApp ads and lead forms create leads automatically, and the marketing screens show cost per lead per ad.'],
    ['What about our existing leads?', 'They can be imported from a spreadsheet; the system drips a welcome message to them and tells you who replied.'],
]
story.append(table(faq, [48 * mm, 122 * mm], font=8.8))
story.append(PageBreak())

# ───────────────────────────── 7. do / don't ─────────────────────────────
story.append(Paragraph('7. Things to avoid during a demo', H1))
story += bullets([
    '<b>Do not open Settings → API Keys or Integrations.</b> Nothing to show there and it looks technical.',
    '<b>Do not click Delete, Archive, Block or Revoke</b> on real-looking records; it works, it just confuses the story. (It resets later, but not during your call.)',
    '<b>Do not open images or documents expecting a picture.</b> They are deliberately blurred placeholders in the demo — say so if asked (“documents are hidden in the demo”).',
    '<b>Do not promise the live “message the demo number” experience</b> until you are told it is switched on.',
    '<b>Do not type a real person\'s phone number or name</b> into the demo. Use made-up ones.',
    '<b>Do not present the data as belonging to any named company.</b> “Sample data from a live system” is the whole sentence.',
])

# ───────────────────────────── 8. troubleshooting ─────────────────────────────
story.append(Paragraph('8. If something goes wrong', H1))
fix = [
    ['What you see', 'What to do'],
    ['The page is blank or a list stays empty for more than ten seconds.', 'Refresh the page (F5). The demo refreshes its data every few minutes and can pause briefly.'],
    ['“Session expired” or you are back on the login page.', 'Log in again; it takes five seconds.'],
    [f'{DEMO_URL} does not open.', f'Use {FALLBACK_URL} — it is the same demo.'],
    ['A record you changed came back to its old value.', 'Expected: the demo resets itself from the master copy every few minutes.'],
    ['A name or number looks odd (e.g. a city as a surname).', 'The replacement names are generated; occasionally they read strangely. Move on.'],
    ['The prospect cannot open their link.', 'Links expire (48 h by default) and can be used only from the link itself. Create a new one on /admin/settings/demo.'],
]
story.append(table(fix, [70 * mm, 100 * mm], font=8.8))

# ───────────────────────────── 9. glossary ─────────────────────────────
story.append(Paragraph('9. Words you will hear', H1))
gl = [
    ['Word', 'Meaning'],
    ['Lead', 'A person who enquired but is not yet a paying client.'],
    ['Conversation / thread', 'One WhatsApp chat with one person.'],
    ['Disposition', 'The outcome tag a salesperson puts on a lead: follow up, price concern, not eligible, junk, converted…'],
    ['SLA', 'The promised reply time. The system times every reply against it.'],
    ['Handoff', 'When the AI assistant stops and a human continues the chat.'],
    ['24-hour window', 'WhatsApp rule: a business can message freely for 24 hours after the customer\'s last message; after that only approved templates.'],
    ['Template', 'A pre-approved WhatsApp message (e.g. appointment reminder) allowed outside the 24-hour window.'],
    ['Round-robin', 'New leads are shared across the agents who are online, in turn.'],
    ['Reference code', 'The ID (TIS-2026-00123 style) that follows a person from lead to client to receipt.'],
]
story.append(table(gl, [40 * mm, 130 * mm], font=8.8))
story.append(Spacer(1, 8))
story.append(Paragraph('Questions about the demo itself: ask the Summit Systems team. Keep this document internal.', SMALL))

doc = SimpleDocTemplate(OUT, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=20 * mm,
                        title='Showing the Summit Immigration CRM — sales team guide', author='Summit Systems')
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print('written', OUT)
