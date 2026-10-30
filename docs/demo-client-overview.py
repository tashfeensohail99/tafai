"""
Builds docs/demo-client-overview.pdf — the leave-behind for prospects after a
Summit Immigration CRM demo. Client-facing: no logins, no internal notes.

    python docs/demo-client-overview.py [login_screenshot.jpg] [inbox_screenshot.jpg]
"""
import os
import sys
from datetime import date

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (BaseDocTemplate, Flowable, Frame, Image, KeepTogether, NextPageTemplate, PageBreak,
                                PageTemplate, Paragraph, Spacer, Table, TableStyle)

OUT = os.path.join(os.path.dirname(__file__), 'demo-client-overview.pdf')
LOGIN_SHOT = sys.argv[1] if len(sys.argv) > 1 and os.path.exists(sys.argv[1]) else None
INBOX_SHOT = sys.argv[2] if len(sys.argv) > 2 and os.path.exists(sys.argv[2]) else None
DEMO_URL = 'demo.summitautomates.com'

W, H = A4
M = 18 * mm
CW = W - 2 * M

NAVY = colors.HexColor('#0b1220')
NAVY2 = colors.HexColor('#111a2e')
INK = colors.HexColor('#0f172a')
INDIGO = colors.HexColor('#4f46e5')
VIOLET = colors.HexColor('#7c3aed')
CYAN = colors.HexColor('#22d3ee')
EMERALD = colors.HexColor('#34d399')
AMBER = colors.HexColor('#fbbf24')
ROSE = colors.HexColor('#fb7185')
MUTED = colors.HexColor('#64748b')
LINE = colors.HexColor('#e2e8f0')
SOFT = colors.HexColor('#f1f5f9')
TINT = colors.HexColor('#eef2ff')
WHITE = colors.white

ss = getSampleStyleSheet()
P = ParagraphStyle('P', parent=ss['BodyText'], fontName='Helvetica', fontSize=10.3, leading=15, textColor=colors.HexColor('#1e293b'), spaceAfter=6)
PW = ParagraphStyle('PW', parent=P, textColor=colors.HexColor('#cbd5e1'))
SMALL = ParagraphStyle('Small', parent=P, fontSize=8.6, leading=12, textColor=MUTED, spaceAfter=0)
SMALLW = ParagraphStyle('SmallW', parent=SMALL, textColor=colors.HexColor('#94a3b8'))
H1 = ParagraphStyle('H1', parent=P, fontName='Helvetica-Bold', fontSize=22, leading=26, textColor=INK, spaceBefore=0, spaceAfter=4)
LEAD = ParagraphStyle('Lead', parent=P, fontSize=11.5, leading=17, textColor=MUTED, spaceAfter=10)
BUL = ParagraphStyle('Bul', parent=P, leftIndent=14, bulletIndent=2, spaceAfter=4)
CARD_T = ParagraphStyle('CardT', parent=P, fontName='Helvetica-Bold', fontSize=10.6, leading=13, textColor=INK, spaceAfter=2)
CARD_B = ParagraphStyle('CardB', parent=P, fontSize=9.2, leading=12.8, textColor=colors.HexColor('#334155'), spaceAfter=0)
COVER_T = ParagraphStyle('CoverT', parent=P, fontName='Helvetica-Bold', fontSize=34, leading=38, textColor=WHITE, spaceAfter=8)
COVER_S = ParagraphStyle('CoverS', parent=P, fontSize=13.5, leading=19, textColor=colors.HexColor('#c7d2fe'), spaceAfter=14)
EYEBROW = ParagraphStyle('Eyebrow', parent=P, fontName='Helvetica-Bold', fontSize=8.5, leading=11, textColor=CYAN, spaceAfter=6)
EYEBROW_D = ParagraphStyle('EyebrowD', parent=EYEBROW, textColor=INDIGO)
DARK_H = ParagraphStyle('DarkH', parent=H1, textColor=WHITE)
DARK_B = ParagraphStyle('DarkB', parent=P, fontSize=11, leading=16.5, textColor=colors.HexColor('#cbd5e1'))
DARK_BUL = ParagraphStyle('DarkBul', parent=DARK_B, leftIndent=14, bulletIndent=2, spaceAfter=5)


def lerp(a, b, t):
    return colors.Color(a.red + (b.red - a.red) * t, a.green + (b.green - a.green) * t, a.blue + (b.blue - a.blue) * t)


def gradient_rect(c, x, y, w, h, c1, c2, steps=80, vertical=False):
    for i in range(steps):
        t = i / (steps - 1)
        c.setFillColor(lerp(c1, c2, t))
        if vertical:
            c.rect(x, y + h * i / steps, w, h / steps + 1.5, stroke=0, fill=1)
        else:
            c.rect(x + w * i / steps, y, w / steps + 0.6, h, stroke=0, fill=1)


def glow(c, cx, cy, r, col, rings=14, alpha=0.06):
    for i in range(rings, 0, -1):
        c.setFillColor(col, alpha=alpha)
        c.circle(cx, cy, r * i / rings, stroke=0, fill=1)


# ───────────────────────── custom flowables ─────────────────────────
class StatCards(Flowable):
    def __init__(self, items, width=CW, height=30 * mm, dark=False):
        super().__init__()
        self.items, self.w, self.h, self.dark = items, width, height, dark

    def wrap(self, aw, ah):
        return self.w, self.h

    def draw(self):
        c = self.canv
        n = len(self.items)
        gap = 5 * mm
        cw = (self.w - gap * (n - 1)) / n
        accents = [INDIGO, CYAN, EMERALD, AMBER]
        for i, (big, cap) in enumerate(self.items):
            x = i * (cw + gap)
            c.setFillColor(NAVY2 if self.dark else WHITE)
            c.setStrokeColor(colors.HexColor('#1e293b') if self.dark else LINE)
            c.setLineWidth(0.8)
            c.roundRect(x, 0, cw, self.h, 4 * mm, stroke=1, fill=1)
            c.setFillColor(accents[i % 4])
            c.roundRect(x + 5 * mm, self.h - 6 * mm, 10 * mm, 1.6 * mm, 0.8 * mm, stroke=0, fill=1)
            c.setFillColor(WHITE if self.dark else INK)
            c.setFont('Helvetica-Bold', 19)
            c.drawString(x + 5 * mm, self.h - 15 * mm, big)
            p = Paragraph(cap, SMALLW if self.dark else SMALL)
            pw, ph = p.wrap(cw - 10 * mm, self.h)
            p.drawOn(c, x + 5 * mm, 4 * mm)


class Journey(Flowable):
    """Lead → Consultation → Agreement → Payment → Case as connected pills."""

    def __init__(self, stages, width=CW, height=22 * mm):
        super().__init__()
        self.stages, self.w, self.h = stages, width, height

    def wrap(self, aw, ah):
        return self.w, self.h

    def draw(self):
        c = self.canv
        n = len(self.stages)
        gap = 4 * mm
        pw = (self.w - gap * (n - 1)) / n
        y = 5 * mm
        ph = 12 * mm
        # connector line
        c.setStrokeColor(LINE)
        c.setLineWidth(2)
        c.line(pw / 2, y + ph / 2, self.w - pw / 2, y + ph / 2)
        for i, (label, sub) in enumerate(self.stages):
            x = i * (pw + gap)
            col = lerp(INDIGO, CYAN, i / max(1, n - 1))
            c.setFillColor(col)
            c.roundRect(x, y, pw, ph, ph / 2, stroke=0, fill=1)
            c.setFillColor(WHITE)
            c.setFont('Helvetica-Bold', 9.5)
            c.drawCentredString(x + pw / 2, y + ph / 2 - 3.2, label)
            c.setFillColor(MUTED)
            c.setFont('Helvetica', 7.6)
            c.drawCentredString(x + pw / 2, y - 3.6 * mm, sub)


class CardGrid(Flowable):
    """Two-column rounded cards: coloured dot, bold title, body."""

    def __init__(self, cards, width=CW, cols=2, gap=5 * mm, pad=5 * mm):
        super().__init__()
        self.cards, self.w, self.cols, self.gap, self.pad = cards, width, cols, gap, pad
        self.cw = (width - gap * (cols - 1)) / cols
        self._layout = None

    def _measure(self):
        rows = []
        for i in range(0, len(self.cards), self.cols):
            row = []
            hmax = 0
            for title, body, col in self.cards[i:i + self.cols]:
                tp = Paragraph(title, CARD_T)
                bp = Paragraph(body, CARD_B)
                tw, th = tp.wrap(self.cw - 2 * self.pad - 6 * mm, 1000)
                bw, bh = bp.wrap(self.cw - 2 * self.pad, 1000)
                h = th + bh + 2 * self.pad + 2 * mm
                hmax = max(hmax, h)
                row.append((tp, th, bp, bh, col))
            rows.append((row, hmax))
        self._layout = rows
        return sum(h for _, h in rows) + self.gap * (len(rows) - 1)

    def wrap(self, aw, ah):
        return self.w, self._measure()

    def split(self, aw, ah):
        # keep it simple: never split a grid; let the doc move it whole
        return []

    def draw(self):
        c = self.canv
        if self._layout is None:
            self._measure()
        y = sum(h for _, h in self._layout) + self.gap * (len(self._layout) - 1)
        for row, hmax in self._layout:
            y -= hmax
            for j, (tp, th, bp, bh, col) in enumerate(row):
                x = j * (self.cw + self.gap)
                c.setFillColor(WHITE)
                c.setStrokeColor(LINE)
                c.setLineWidth(0.8)
                c.roundRect(x, y, self.cw, hmax, 3.5 * mm, stroke=1, fill=1)
                c.setFillColor(col)
                c.circle(x + self.pad + 1.8 * mm, y + hmax - self.pad - 2 * mm, 1.8 * mm, stroke=0, fill=1)
                tp.drawOn(c, x + self.pad + 6 * mm, y + hmax - self.pad - th)
                bp.drawOn(c, x + self.pad, y + hmax - self.pad - th - 2 * mm - bh)
            y -= self.gap


class Section(Flowable):
    """Section title with a gradient accent bar underneath."""

    def __init__(self, eyebrow, title, width=CW):
        super().__init__()
        self.eyebrow, self.title, self.w = eyebrow, title, width

    def wrap(self, aw, ah):
        return self.w, 19 * mm

    def draw(self):
        c = self.canv
        c.setFillColor(INDIGO)
        c.setFont('Helvetica-Bold', 8.5)
        c.drawString(0, 15 * mm, self.eyebrow.upper())
        c.setFillColor(INK)
        c.setFont('Helvetica-Bold', 21)
        c.drawString(0, 6.5 * mm, self.title)
        gradient_rect(c, 0, 2 * mm, 28 * mm, 1.4 * mm, INDIGO, CYAN, steps=30)


class Callout(Flowable):
    def __init__(self, text, col=EMERALD, width=CW, bg=colors.HexColor('#ecfdf5')):
        super().__init__()
        self.p = Paragraph(text, P)
        self.col, self.w, self.bg = col, width, bg

    def wrap(self, aw, ah):
        _, self.ph = self.p.wrap(self.w - 14 * mm, ah)
        self.h = self.ph + 10 * mm
        return self.w, self.h

    def draw(self):
        c = self.canv
        c.setFillColor(self.bg)
        c.roundRect(0, 0, self.w, self.h, 3.5 * mm, stroke=0, fill=1)
        c.setFillColor(self.col)
        c.roundRect(0, 0, 2.2 * mm, self.h, 1.1 * mm, stroke=0, fill=1)
        self.p.drawOn(c, 8 * mm, 5 * mm)


class Framed(Flowable):
    """Screenshot in a rounded dark frame with a soft shadow."""

    def __init__(self, path, width=CW, caption=None):
        super().__init__()
        iw, ih = ImageReader(path).getSize()
        self.path = path
        self.w = width
        self.img_w = width - 2 * 3 * mm
        self.img_h = self.img_w * ih / iw
        self.cap = Paragraph(caption, SMALL) if caption else None
        self.hAlign = 'CENTER'

    def wrap(self, aw, ah):
        ch = 0
        if self.cap:
            _, ch = self.cap.wrap(self.w, ah)
            ch += 3 * mm
        self.ch = ch
        self.h = self.img_h + 6 * mm + ch
        return self.w, self.h

    def draw(self):
        c = self.canv
        top = self.h
        fy = self.ch
        c.setFillColor(colors.HexColor('#0f172a'), alpha=0.12)
        c.roundRect(1.5 * mm, fy - 1.5 * mm, self.w, self.img_h + 6 * mm, 3.5 * mm, stroke=0, fill=1)
        c.setFillColor(NAVY)
        c.roundRect(0, fy, self.w, self.img_h + 6 * mm, 3.5 * mm, stroke=0, fill=1)
        c.drawImage(self.path, 3 * mm, fy + 3 * mm, self.img_w, self.img_h, preserveAspectRatio=True, mask='auto')
        if self.cap:
            self.cap.drawOn(c, 0, 0)


class Steps(Flowable):
    """Numbered timeline for getting started."""

    def __init__(self, steps, width=CW):
        super().__init__()
        self.steps, self.w = steps, width
        self.rows = []

    def wrap(self, aw, ah):
        self.rows = []
        total = 0
        for title, what, need in self.steps:
            tp = Paragraph(title, CARD_T)
            wp = Paragraph(what, CARD_B)
            np_ = Paragraph(f'<font color="#4f46e5"><b>You bring:</b></font> {need}', CARD_B)
            tw = self.w - 16 * mm
            _, th = tp.wrap(tw, ah)
            _, wh = wp.wrap(tw, ah)
            _, nh = np_.wrap(tw, ah)
            h = th + wh + nh + 7 * mm
            self.rows.append((tp, th, wp, wh, np_, nh, h))
            total += h
        self.h = total
        return self.w, total

    def draw(self):
        c = self.canv
        y = self.h
        cx = 5 * mm
        c.setStrokeColor(LINE)
        c.setLineWidth(1.5)
        c.line(cx, 6 * mm, cx, self.h - 6 * mm)
        for i, (tp, th, wp, wh, np_, nh, h) in enumerate(self.rows):
            y -= h
            col = lerp(INDIGO, CYAN, i / max(1, len(self.rows) - 1))
            c.setFillColor(col)
            c.circle(cx, y + h - 4 * mm, 3.6 * mm, stroke=0, fill=1)
            c.setFillColor(WHITE)
            c.setFont('Helvetica-Bold', 9)
            c.drawCentredString(cx, y + h - 4 * mm - 3, str(i + 1))
            x = 16 * mm
            tp.drawOn(c, x, y + h - th - 1 * mm)
            wp.drawOn(c, x, y + h - th - wh - 2.5 * mm)
            np_.drawOn(c, x, y + h - th - wh - nh - 4 * mm)


# ───────────────────────── page decorations ─────────────────────────
def cover_page(c, doc):
    c.saveState()
    gradient_rect(c, 0, 0, W, H, NAVY, colors.HexColor('#1e1b4b'), steps=300, vertical=True)
    glow(c, W * 0.85, H * 0.86, 110 * mm, INDIGO, alpha=0.05)
    glow(c, W * 0.12, H * 0.18, 90 * mm, CYAN, alpha=0.035)
    gradient_rect(c, 0, H - 3.5 * mm, W, 3.5 * mm, INDIGO, CYAN, steps=90)
    # logo mark
    c.setFillColor(INDIGO)
    c.roundRect(M, H - 34 * mm, 11 * mm, 11 * mm, 3 * mm, stroke=0, fill=1)
    c.setFillColor(WHITE)
    c.setFont('Helvetica-Bold', 13)
    c.drawString(M + 3.2 * mm, H - 31 * mm, 'S')
    c.setFont('Helvetica-Bold', 12)
    c.drawString(M + 14 * mm, H - 27.5 * mm, 'Summit')
    c.setFont('Helvetica', 7.5)
    c.setFillColor(colors.HexColor('#a5b4fc'))
    c.drawString(M + 14 * mm, H - 32 * mm, 'SALES OPERATING SYSTEM FOR IMMIGRATION CONSULTANCIES')
    c.setFillColor(colors.HexColor('#94a3b8'))
    c.setFont('Helvetica', 8)
    c.drawString(M, 12 * mm, f'Demo overview · {date.today().strftime("%B %Y")}')
    c.drawRightString(W - M, 12 * mm, 'summitautomates.com')
    c.restoreState()


def body_page(c, doc):
    c.saveState()
    gradient_rect(c, 0, H - 2.5 * mm, W, 2.5 * mm, INDIGO, CYAN, steps=90)
    c.setFillColor(MUTED)
    c.setFont('Helvetica', 8)
    c.drawString(M, 11 * mm, 'Summit Immigration CRM  ·  summitautomates.com')
    c.setFillColor(INDIGO)
    c.circle(W - M - 3 * mm, 12.5 * mm, 3.6 * mm, stroke=0, fill=1)
    c.setFillColor(WHITE)
    c.setFont('Helvetica-Bold', 8)
    c.drawCentredString(W - M - 3 * mm, 11.3 * mm, str(doc.page))
    c.restoreState()


def dark_page(c, doc):
    c.saveState()
    gradient_rect(c, 0, 0, W, H, colors.HexColor('#1e1b4b'), NAVY, steps=300, vertical=True)
    glow(c, W * 0.2, H * 0.8, 120 * mm, INDIGO, alpha=0.05)
    glow(c, W * 0.9, H * 0.15, 90 * mm, CYAN, alpha=0.04)
    gradient_rect(c, 0, H - 2.5 * mm, W, 2.5 * mm, INDIGO, CYAN, steps=90)
    c.setFillColor(colors.HexColor('#94a3b8'))
    c.setFont('Helvetica', 8)
    c.drawString(M, 11 * mm, 'Summit Immigration CRM  ·  summitautomates.com')
    c.drawRightString(W - M, 11 * mm, str(doc.page))
    c.restoreState()


doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=M, rightMargin=M, topMargin=22 * mm, bottomMargin=20 * mm,
                      title='Summit Immigration CRM — demo overview', author='Summit Systems')
frame = Frame(M, 20 * mm, CW, H - 42 * mm, id='f', leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
cover_frame = Frame(M, 20 * mm, CW, H - 60 * mm, id='c', leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
doc.addPageTemplates([
    PageTemplate(id='cover', frames=[cover_frame], onPage=cover_page),
    PageTemplate(id='body', frames=[frame], onPage=body_page),
    PageTemplate(id='dark', frames=[frame], onPage=dark_page),
])


def bullets(items, style=BUL):
    return [Paragraph(f'<font color="#4f46e5">●</font>&nbsp; {t}', style) for t in items]


story = []

# ───────────── cover ─────────────
story += [
    Spacer(1, 10 * mm),
    Paragraph('EVERY ENQUIRY. ONE SYSTEM.', EYEBROW),
    Paragraph('Summit<br/>Immigration CRM', COVER_T),
    Paragraph('Every WhatsApp enquiry answered in seconds, every lead owned, every case in one place — a summary of what you saw in the demo and how to get started.', COVER_S),
    StatCards([('< 1 min', 'first reply to every enquiry, day or night'),
               ('3 languages', 'English, Urdu and Roman Urdu — text and voice'),
               ('1 record', 'from first message to final receipt')], height=27 * mm, dark=True),
    Spacer(1, 8 * mm),
]
if LOGIN_SHOT:
    story.append(Framed(LOGIN_SHOT, width=146 * mm))
story.append(NextPageTemplate('body'))
story.append(PageBreak())

# ───────────── why ─────────────
story.append(Section('The problem', 'Why consultancies switch to Summit'))
story.append(Paragraph(
    'An immigration office lives on WhatsApp. Enquiries arrive on staff phones at all hours; the fast ones get answered, the rest go cold, '
    'and when a salesperson leaves, their conversations leave with them. Managers cannot see who replied, how fast, or why a lead was lost. '
    'Finance and processing keep their own files for the same client.', LEAD))
story.append(CardGrid([
    ('One shared WhatsApp inbox', 'On your business number. Every message is saved, searchable and owned by the company — not by a phone.', INDIGO),
    ('An assistant that answers first', 'Replies within seconds in the customer\'s language, from facts you approve, books consultations into real availability, and hands over to a person the moment it should.', CYAN),
    ('Fair, measured distribution', 'New leads go round-robin to the agents who are online. Every reply is timed against the service level you set.', EMERALD),
    ('One record per person', 'Lead, consultation, agreement, payment, receipt and case hang off one reference code, visible to every department with the right permission.', AMBER),
    ('Reports that arrive by themselves', 'Daily WhatsApp and call reports, per-agent performance, lead sources and conversion — in your inbox every morning.', VIOLET),
    ('Built for immigration work', 'Programs, document checklists, consultation fees, installments and judicial review cases are first-class, not add-ons.', ROSE),
]))
story.append(Spacer(1, 8 * mm))
story.append(Paragraph('THE JOURNEY SUMMIT TRACKS', EYEBROW_D))
story.append(Journey([('Enquiry', 'WhatsApp, ad, walk-in'), ('Consultation', 'booked by the assistant'), ('Agreement', 'installments, approval'),
                      ('Payment', 'verified, receipted'), ('Case', 'documents, stages')]))
story.append(PageBreak())

# ───────────── what you saw ─────────────
story.append(Section('The demo', 'What you saw'))
story += bullets([
    'The <b>dashboard</b> an owner sees at 9 am: new leads, conversations waiting, appointments, money received.',
    'The <b>WhatsApp inbox</b>: thousands of conversations with status, owner and outcome tags, filtered to unread and uncontacted in one click.',
    'A <b>real conversation</b> handled by the assistant at night: questions answered, a voice note transcribed, a consultation booked, the chat handed to a human.',
    'The <b>lead record</b> behind the chat: which ad it came from, who owns it, follow-ups, appointments, notes.',
    'The <b>manager view</b>: who is online, who replies on time, who converts — and the settings that decide who receives new leads.',
    'The <b>agent view</b>: a deliberately simple screen with only that person\'s conversations and today\'s follow-ups.',
])
story.append(Spacer(1, 4 * mm))
if INBOX_SHOT:
    story.append(Framed(INBOX_SHOT, width=124 * mm, caption='The shared inbox. Voice notes appear as transcripts, the assistant\'s replies are marked, and a human can take over any chat with one click.'))
story.append(Spacer(1, 2 * mm))
story.append(Callout('<b>How the assistant behaves.</b> It answers only from the knowledge your team approves — programs, fees, documents, office hours. '
                     'It never promises an outcome and never asks for passport numbers, card details or passwords. It books into real availability, '
                     'hands over when the customer asks or when it is unsure, and every reply it writes is marked in the inbox so managers can review its work.',
                     col=CYAN, bg=colors.HexColor('#ecfeff')))
story.append(PageBreak())

# ───────────── what is included ─────────────
story.append(Section('The product', 'What is included'))
story.append(CardGrid([
    ('WhatsApp inbox and AI assistant', 'Shared inbox on your number; instant first reply 24/7 in English, Urdu and Roman Urdu; voice-note transcription; consultation booking; human handover; approved templates for reminders outside the 24-hour window.', INDIGO),
    ('Leads and follow-ups', 'Every enquiry, ad click, website form and walk-in becomes a lead with an owner, a status and an outcome. Follow-up queue, SLA timers, round-robin, lead caps per agent.', CYAN),
    ('Appointments and reception', 'Consultations booked by the assistant or by staff, reminders, walk-in log, consultation fees.', EMERALD),
    ('Agreements and finance', 'Service agreements with installments, invoices, verified payments, official receipts, finance approvals, payment history and audit trail.', AMBER),
    ('Processing and documents', 'Case pipeline per client with document checklists, status per stage and processing reports.', VIOLET),
    ('Marketing', 'Meta (Facebook / Instagram) click-to-WhatsApp ads and lead forms feed leads automatically, with cost and conversion per ad.', ROSE),
    ('Management and HR', 'Sales overview per agent, daily reports by email, activity logs, attendance, team directory, roles and permissions.', INDIGO),
    ('Mobile', 'Companion app for staff on the move — the same records, the same permissions.', CYAN),
]))
story.append(Spacer(1, 7 * mm))
story.append(Callout('<b>Your data.</b> Your records live in your own cloud database. Access is by role: sales see their leads, finance sees finance, managers see everything. '
                     'Every sensitive action — document views, payment verification, exports — is logged with who did it and when. '
                     'The demo you saw runs on sample data: a real system\'s history with every name, number and document replaced by realistic substitutes.',
                     col=INDIGO, bg=TINT))
story.append(PageBreak())

# ───────────── getting started ─────────────
story.append(Section('Next', 'Getting started'))
story.append(Paragraph('Typical time from kick-off to live is days, not months. The assistant learns from day one, and you can change its knowledge and tone at any time without technical help.', LEAD))
story.append(Steps([
    ('Kick-off call', 'We agree the scope, the team and the launch date.', 'who is in the WhatsApp rota, your working hours, your branches.'),
    ('Connect your number', 'Your WhatsApp Business number is connected to Summit; your existing number can be moved.', 'access to your Meta Business account — we guide you through it.'),
    ('Teach the assistant', 'We load your programs, fees, documents and office details into the approved knowledge base.', 'your current fee list and the facts you want customers to hear.'),
    ('Import and go live', 'Existing leads are imported; the inbox and reports go live; your team is trained in one session.', 'a spreadsheet of existing leads (optional).'),
]))
story.append(Spacer(1, 6 * mm))
story.append(Callout(f'<b>Try it yourself.</b> Ask your Summit representative for a <b>personal demo link</b>. It signs you straight in at <b>{DEMO_URL}</b> for a limited time, '
                     'as an admin or as a sales agent, so you can explore the inbox, the lead records and the reports at your own pace. Anything you change in the demo is reset automatically.',
                     col=EMERALD))
story.append(NextPageTemplate('dark'))
story.append(PageBreak())

# ───────────── closing (dark) ─────────────
story += [
    Spacer(1, 28 * mm),
    Paragraph('NEXT STEPS', EYEBROW),
    Paragraph('Let\'s put it on your number.', DARK_H),
    Spacer(1, 4 * mm),
]
story += bullets([
    'A short follow-up call to answer your questions and confirm scope.',
    'A trial on your own WhatsApp number, with your own fee list in the assistant.',
    'A go-live date that suits your team.',
], DARK_BUL)
story.append(Spacer(1, 14 * mm))
story.append(Paragraph('YOUR SUMMIT CONTACT', EYEBROW))
contact = Table([[Paragraph('Name', SMALLW), Paragraph('', DARK_B)], [Paragraph('Phone / WhatsApp', SMALLW), Paragraph('', DARK_B)], [Paragraph('Email', SMALLW), Paragraph('', DARK_B)]],
                colWidths=[42 * mm, CW - 42 * mm], rowHeights=[11 * mm] * 3)
contact.setStyle(TableStyle([('LINEBELOW', (1, 0), (1, -1), 0.6, colors.HexColor('#475569')), ('VALIGN', (0, 0), (-1, -1), 'MIDDLE')]))
story.append(contact)
story.append(Spacer(1, 16 * mm))
story.append(Paragraph('Summit Immigration CRM is built and operated by Summit Systems.', SMALLW))

doc.build(story)
print('written', OUT)
