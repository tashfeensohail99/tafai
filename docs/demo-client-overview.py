"""
Builds docs/demo-client-overview.pdf — the leave-behind for prospects after a
Summit Immigration CRM demo. Client-facing: no logins, no internal notes.

    python docs/demo-client-overview.py [login_screenshot.jpg] [inbox_screenshot.jpg]
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

OUT = os.path.join(os.path.dirname(__file__), 'demo-client-overview.pdf')
LOGIN_SHOT = sys.argv[1] if len(sys.argv) > 1 and os.path.exists(sys.argv[1]) else None
INBOX_SHOT = sys.argv[2] if len(sys.argv) > 2 and os.path.exists(sys.argv[2]) else None

DEMO_URL = 'demo.summitautomates.com'

NAVY = colors.HexColor('#0f172a')
ACCENT = colors.HexColor('#4f46e5')
MUTED = colors.HexColor('#475569')
SOFT = colors.HexColor('#eef2ff')
OK = colors.HexColor('#ecfdf5')
OK_B = colors.HexColor('#34d399')

ss = getSampleStyleSheet()
H1 = ParagraphStyle('H1', parent=ss['Heading1'], fontSize=19, leading=23, textColor=NAVY, spaceBefore=6, spaceAfter=8)
H2 = ParagraphStyle('H2', parent=ss['Heading2'], fontSize=13.5, leading=17, textColor=ACCENT, spaceBefore=12, spaceAfter=5)
P = ParagraphStyle('P', parent=ss['BodyText'], fontSize=10.4, leading=15, textColor=colors.HexColor('#1e293b'), spaceAfter=6)
SMALL = ParagraphStyle('Small', parent=P, fontSize=8.8, leading=12, textColor=MUTED)
BUL = ParagraphStyle('Bul', parent=P, leftIndent=12, bulletIndent=2, spaceAfter=3)
TITLE = ParagraphStyle('Title', parent=ss['Title'], fontSize=27, leading=33, textColor=NAVY, alignment=TA_LEFT, spaceAfter=6)
SUB = ParagraphStyle('Sub', parent=P, fontSize=13, leading=18, textColor=MUTED, spaceAfter=16)
BIG = ParagraphStyle('Big', parent=P, fontSize=22, leading=26, textColor=ACCENT, spaceAfter=0)
CAP = ParagraphStyle('Cap', parent=SMALL, textColor=NAVY)


def bullets(items):
    return [Paragraph(f'• {t}', BUL) for t in items]


def box(text, bg=SOFT, border=ACCENT):
    t = Table([[Paragraph(text, P)]], colWidths=[170 * mm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), bg), ('BOX', (0, 0), (-1, -1), 0.8, border),
        ('LEFTPADDING', (0, 0), (-1, -1), 9), ('RIGHTPADDING', (0, 0), (-1, -1), 9),
        ('TOPPADDING', (0, 0), (-1, -1), 7), ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
    ]))
    return [Spacer(1, 3), t, Spacer(1, 8)]


def table(rows, widths, font=9.4):
    data = [[Paragraph(str(c), ParagraphStyle('cell', parent=P, fontSize=font, leading=font + 3.4, spaceAfter=0)) for c in r] for r in rows]
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#cbd5e1')),
        ('BACKGROUND', (0, 0), (-1, 0), SOFT), ('TEXTCOLOR', (0, 0), (-1, 0), NAVY),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6), ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    return t


def stats(items):
    cells = [[Paragraph(v, BIG) for v, _ in items], [Paragraph(k, CAP) for _, k in items]]
    t = Table(cells, colWidths=[170 * mm / len(items)] * len(items))
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), SOFT), ('BOX', (0, 0), (-1, -1), 0.8, ACCENT),
        ('LEFTPADDING', (0, 0), (-1, -1), 10), ('TOPPADDING', (0, 0), (0, 0), 10), ('BOTTOMPADDING', (0, 1), (-1, 1), 10),
    ]))
    return t


def shot(path, caption, width_mm=165):
    w, h = ImageReader(path).getSize()
    img = Image(path, width=width_mm * mm, height=width_mm * mm * h / w)
    return KeepTogether([img, Spacer(1, 3), Paragraph(caption, SMALL), Spacer(1, 6)])


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('Helvetica', 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(20 * mm, 12 * mm, 'Summit Immigration CRM · summitautomates.com')
    canvas.drawRightString(190 * mm, 12 * mm, f'{doc.page}')
    canvas.restoreState()


story = []

# cover
story += [
    Spacer(1, 34 * mm),
    Paragraph('Summit Immigration CRM', TITLE),
    Paragraph('Every enquiry answered in seconds, every lead owned, every case in one place. A summary of what you saw in the demo and how to get started.', SUB),
    Paragraph(f'Prepared {date.today().strftime("%B %Y")}', SMALL),
    Spacer(1, 10 * mm),
]
story.append(stats([('< 1 min', 'first reply to every WhatsApp enquiry, day or night'),
                    ('3 languages', 'English, Urdu and Roman Urdu, text and voice notes'),
                    ('1 record', 'from first message to final receipt')]))
story.append(Spacer(1, 8 * mm))
if LOGIN_SHOT:
    story.append(shot(LOGIN_SHOT, 'One workspace for sales, finance, processing and reception — each department signs in to its own view of the same records.', 150))
story.append(PageBreak())

# problem + answer
story.append(Paragraph('Why consultancies switch to Summit', H1))
story.append(Paragraph(
    'An immigration office lives on WhatsApp. Enquiries arrive on staff phones at all hours, the fast ones get answered, the rest '
    'go cold, and when a salesperson leaves, their conversations leave with them. Managers cannot see who replied, how fast, or why '
    'a lead was lost. Finance and processing keep their own files for the same client.', P))
story.append(Paragraph('Summit puts the whole journey in one system:', P))
story += bullets([
    '<b>One shared WhatsApp inbox</b> on your business number. Every message is saved, searchable and owned by the company, not a phone.',
    '<b>An AI assistant that answers first.</b> It replies within seconds in the customer\'s language, answers from facts you approve, books consultations into real availability, and hands over to a person the moment it should.',
    '<b>Fair, measured distribution.</b> New leads go round-robin to the agents who are online. Every reply is timed against the service level you set.',
    '<b>One record per person.</b> Lead, consultation, agreement, payment, receipt and case all hang off the same reference code, visible to every department with the right permission.',
    '<b>Reports that arrive by themselves.</b> Daily WhatsApp and call reports, per-agent performance, lead sources and conversion, delivered every morning.',
])

story.append(Paragraph('What you saw in the demo', H2))
story += bullets([
    'The <b>dashboard</b> an owner sees at 9 am: new leads, conversations waiting, appointments, money received.',
    'The <b>WhatsApp inbox</b>: thousands of conversations with status, owner and outcome tags, filtered to unread and uncontacted in one click.',
    'A <b>real conversation</b> handled by the assistant at night: questions answered, a voice note transcribed, a consultation booked, the chat handed to a human.',
    'The <b>lead record</b> behind the chat: which ad it came from, who owns it, follow-ups, appointments, notes.',
    'The <b>manager view</b>: who is online, who replies on time, who converts — and the settings that decide who receives new leads.',
    'The <b>agent view</b>: a deliberately simple screen with only that person\'s conversations and today\'s follow-ups.',
])
if INBOX_SHOT:
    story.append(shot(INBOX_SHOT, 'The shared inbox. Voice notes appear as transcripts; the assistant\'s replies are marked; a human can take over any chat with one click.'))
story.append(PageBreak())

# modules
story.append(Paragraph('What is included', H1))
mods = [
    ['Area', 'What it does for you'],
    ['WhatsApp inbox and AI assistant', 'Shared inbox on your number; instant first reply 24/7 in English, Urdu, Roman Urdu; voice-note transcription; consultation booking; human handover; templates for reminders outside the 24-hour window.'],
    ['Leads and follow-ups', 'Every enquiry, ad click, website form and walk-in becomes a lead with an owner, a status and an outcome. Follow-up queue, SLA timers, round-robin distribution, lead caps per agent.'],
    ['Appointments and reception', 'Consultations booked by the assistant or by staff, reminders, walk-in log, consultation fees.'],
    ['Agreements and finance', 'Service agreements with installments, invoices, verified payments, official receipts, finance approvals, payment history and audit trail.'],
    ['Processing and documents', 'Case pipeline per client with document checklists, status per stage, processing reports.'],
    ['Marketing', 'Meta (Facebook / Instagram) click-to-WhatsApp ads and lead forms feed leads automatically; cost and conversion per ad.'],
    ['Management and HR', 'Sales overview per agent, daily reports by email, activity logs, attendance, team directory, roles and permissions.'],
    ['Mobile', 'Companion app for staff on the move; the same records, the same permissions.'],
]
story.append(table(mods, [48 * mm, 122 * mm]))

story.append(Paragraph('How the assistant behaves', H2))
story += bullets([
    'It answers only from the knowledge your team approves: programs, fees, documents, office hours. Nothing improvised.',
    'It never promises an outcome and never asks for passport numbers, card details or passwords.',
    'It books into real availability, so there is no double booking, and confirms in the customer\'s language.',
    'It hands over to a person when the customer asks, when it is unsure, or when the conversation becomes commercial — and your team sees the full history.',
    'Every reply it writes is visible and marked in the inbox, so managers can review its work.',
])

story.append(Paragraph('Your data', H2))
story += bullets([
    'Your records live in your own cloud database. Access is by role: sales see their leads, finance sees finance, managers see everything.',
    'Every sensitive action — document views, payment verification, exports — is logged with who did it and when.',
    'The demo you saw runs on sample data: a real system\'s history with every name, number and document replaced by realistic substitutes.',
])
story.append(PageBreak())

# getting started
story.append(Paragraph('Getting started', H1))
steps = [
    ['Step', 'What happens', 'What we need from you'],
    ['1. Kick-off call', 'We agree the scope, the team and the launch date.', 'Who is in the WhatsApp rota, your working hours, your branches.'],
    ['2. Connect your number', 'Your WhatsApp Business number is connected to Summit; your existing number can be moved.', 'Access to your Meta Business account (we guide you through it).'],
    ['3. Teach the assistant', 'We load your programs, fees, documents and office details into the approved knowledge base.', 'Your current fee list and the facts you want customers to hear.'],
    ['4. Import and go live', 'Existing leads are imported; the inbox and reports go live; your team is trained in one session.', 'A spreadsheet of existing leads (optional).'],
]
story.append(table(steps, [34 * mm, 72 * mm, 64 * mm]))
story.append(Spacer(1, 4))
story.append(Paragraph('Typical time from kick-off to live is days, not months. The assistant learns from day one, and you can adjust its knowledge and tone at any time without technical help.', P))

story.append(Paragraph('Try it yourself', H2))
story += box(f'Ask your Summit representative for a <b>personal demo link</b>. It signs you straight in at <b>{DEMO_URL}</b> for a limited time, as an admin or as a sales agent, so you can explore the inbox, the lead records and the reports at your own pace. '
             'Anything you change in the demo is reset automatically.', bg=OK, border=OK_B)

story.append(Paragraph('Next steps', H2))
story += bullets([
    'A short follow-up call to answer your questions and confirm scope.',
    'A trial on your own WhatsApp number, with your own fee list in the assistant.',
    'A go-live date that suits your team.',
])
story.append(Spacer(1, 10))
story.append(Paragraph('Your Summit contact', H2))
contact = Table([[Paragraph('Name', CAP), Paragraph('', P)], [Paragraph('Phone / WhatsApp', CAP), Paragraph('', P)], [Paragraph('Email', CAP), Paragraph('', P)]],
                colWidths=[40 * mm, 130 * mm], rowHeights=[9 * mm] * 3)
contact.setStyle(TableStyle([('LINEBELOW', (1, 0), (1, -1), 0.5, colors.HexColor('#94a3b8')), ('VALIGN', (0, 0), (-1, -1), 'MIDDLE')]))
story.append(contact)
story.append(Spacer(1, 10))
story.append(Paragraph('Summit Immigration CRM is built and operated by Summit Systems. summitautomates.com', SMALL))

doc = SimpleDocTemplate(OUT, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=20 * mm,
                        title='Summit Immigration CRM — demo overview', author='Summit Systems')
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print('written', OUT)
