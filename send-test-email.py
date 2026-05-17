"""
Quick test: send an email via Hostinger SMTP.
Usage: python send-test-email.py recipient@example.com
The script will prompt for the SMTP password (input is hidden).
"""
import smtplib, sys, getpass
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

TO   = sys.argv[1] if len(sys.argv) > 1 else input('Recipient email: ')
PASS = getpass.getpass('Hostinger SMTP password for admin@tashfeengroup.com: ')

HTML = """
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px">
  <div style="background:linear-gradient(135deg,#1e40af,#7c3aed);padding:20px;border-radius:6px;text-align:center;margin-bottom:24px">
    <h1 style="color:#fff;margin:0;font-size:22px">Tashfeen Immigration</h1>
    <p style="color:#bfdbfe;margin:4px 0 0">tashfeengroup.com</p>
  </div>
  <h2 style="color:#1e293b">Test Email - OK</h2>
  <p style="color:#475569">This is a test email sent from the <strong>Tashfeen Immigration CRM platform</strong>.</p>
  <p style="color:#475569">If you received this, the Hostinger SMTP integration is working correctly.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="color:#94a3b8;font-size:12px">Sent from admin@tashfeengroup.com via smtp.hostinger.com</p>
</div>
"""

msg = MIMEMultipart('alternative')
msg['Subject'] = 'Test Email - Tashfeen Immigration Platform'
msg['From']    = 'Tashfeen Immigration <admin@tashfeengroup.com>'
msg['To']      = TO
msg.attach(MIMEText('This is a test email from Tashfeen Immigration CRM. If you received this, SMTP is working.', 'plain', 'utf-8'))
msg.attach(MIMEText(HTML, 'html', 'utf-8'))

print(f'\nConnecting to smtp.hostinger.com:465 ...')
try:
    with smtplib.SMTP_SSL('smtp.hostinger.com', 465, timeout=15) as server:
        server.login('admin@tashfeengroup.com', PASS)
        server.send_message(msg)
    print(f'✓ Email sent successfully to {TO}')
except smtplib.SMTPAuthenticationError:
    print('✗ Authentication failed — check your Hostinger email password')
except Exception as e:
    print(f'✗ Failed: {e}')
