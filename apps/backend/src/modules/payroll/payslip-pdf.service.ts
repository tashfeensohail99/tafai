import { Injectable, NotFoundException } from '@nestjs/common';
import type { Organization, Payslip, PayrollPeriod, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PdfRenderService } from '../pdf/pdf.service';
import { brandedPdfOptions } from '../pdf/branding';
import { PayrollConfigService } from './payroll-config.service';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

type EmpLite = {
  firstName: string;
  lastName: string;
  employeeCode: string | null;
  user: { email: string | null } | null;
} | null;

function esc(s: string | null | undefined): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}

/** Rupee amount, no decimals (matches the on-screen money() formatting). */
function rs(v: Prisma.Decimal | string | number | null | undefined): string {
  return 'Rs ' + Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** Day count — whole if integral, else one decimal (half-days etc.). */
function days(v: Prisma.Decimal | string | number | null | undefined): string {
  const n = Number(v ?? 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Renders a single employee payslip as a branded A4 PDF through the shared
 * headless-Chrome engine — same letterhead as receipts/agreements. Generated
 * on demand from the locked snapshot (no storage needed; payslips are
 * reproducible).
 */
@Injectable()
export class PayslipPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: PdfRenderService,
    private readonly config: PayrollConfigService,
  ) {}

  async render(payslipId: string): Promise<{ buffer: Buffer; fileName: string }> {
    const slip = await this.prisma.payslip.findUnique({ where: { id: payslipId } });
    if (!slip) throw new NotFoundException('Payslip not found');

    const [period, emp, org] = await Promise.all([
      this.prisma.payrollPeriod.findUnique({ where: { id: slip.payrollPeriodId } }),
      this.prisma.employee.findUnique({
        where: { id: slip.employeeId },
        select: {
          firstName: true,
          lastName: true,
          employeeCode: true,
          user: { select: { email: true } },
        },
      }),
      this.config.getOrg().catch(() => null),
    ]);

    const html = this.buildHtml(slip, period, emp, org);
    const buffer = await this.pdf.renderHtml(html, brandedPdfOptions());
    const tag = period ? `${period.year}-${String(period.month).padStart(2, '0')}` : 'period';
    const who = emp?.employeeCode || slip.employeeId.slice(0, 8);
    return { buffer, fileName: `payslip-${tag}-${who}.pdf` };
  }

  private buildHtml(
    s: Payslip,
    period: PayrollPeriod | null,
    emp: EmpLite,
    org: Organization | null,
  ): string {
    const orgName = esc(org?.name) || 'Tashfeen Immigration Solutions';
    const periodLabel = period ? `${MONTHS[period.month - 1]} ${period.year}` : '—';
    const empName = esc(emp ? `${emp.firstName} ${emp.lastName}`.trim() : 'Employee');
    const isFinal = period?.status === 'LOCKED';

    const row = (label: string, value: string, opts?: { strong?: boolean; danger?: boolean }) => `
      <tr>
        <td style="padding:7px 0;color:#475569;font-size:12.5px;">${esc(label)}</td>
        <td style="padding:7px 0;text-align:right;font-size:12.5px;${opts?.strong ? 'font-weight:700;color:#0b1f3a;' : 'color:#0f172a;'}${opts?.danger ? 'color:#b91c1c;' : ''}">${value}</td>
      </tr>`;

    return `<!doctype html><html><head><meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color:#0f172a; margin:0; }
  .wrap { padding: 6px 42px 0; }
  .titlebar { display:flex; align-items:flex-end; justify-content:space-between; border-bottom:2px solid #0b1f3a; padding-bottom:10px; margin-bottom:16px; }
  .pill { display:inline-block; font-size:10px; font-weight:700; letter-spacing:.05em; padding:3px 10px; border-radius:999px; }
  .grid { display:flex; flex-wrap:wrap; gap:6px 28px; margin-bottom:18px; }
  .field { min-width:160px; }
  .field .k { font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8; }
  .field .v { font-size:13px; font-weight:600; color:#0f172a; margin-top:2px; }
  .section { font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:#0b1f3a; margin:14px 0 4px; }
  table.lines { width:100%; border-collapse:collapse; }
  table.lines tr:not(:last-child) td { border-bottom:1px solid #eef2f7; }
  .att { display:flex; flex-wrap:wrap; gap:8px 20px; font-size:12px; color:#334155; }
  .att b { color:#0f172a; }
  .net { margin-top:18px; background:#0b1f3a; color:#fff; border-radius:10px; padding:14px 18px; display:flex; align-items:center; justify-content:space-between; }
  .net .lbl { font-size:12px; letter-spacing:.06em; text-transform:uppercase; color:#cbd5e1; }
  .net .amt { font-size:22px; font-weight:800; }
  .note { margin-top:16px; font-size:10.5px; color:#94a3b8; line-height:1.5; }
</style></head>
<body><div class="wrap">
  <div class="titlebar">
    <div>
      <div style="font-size:20px;font-weight:800;color:#0b1f3a;letter-spacing:.02em;">Payslip</div>
      <div style="font-size:12.5px;color:#64748b;margin-top:2px;">${orgName} · ${esc(periodLabel)}</div>
    </div>
    <span class="pill" style="background:${isFinal ? '#dcfce7' : '#fef3c7'};color:${isFinal ? '#166534' : '#92400e'};">
      ${isFinal ? 'FINAL' : 'DRAFT'}
    </span>
  </div>

  <div class="grid">
    <div class="field"><div class="k">Employee</div><div class="v">${empName}</div></div>
    <div class="field"><div class="k">Employee code</div><div class="v">${esc(emp?.employeeCode) || '—'}</div></div>
    <div class="field"><div class="k">Email</div><div class="v">${esc(emp?.user?.email) || '—'}</div></div>
    <div class="field"><div class="k">Pay period</div><div class="v">${esc(periodLabel)}</div></div>
  </div>

  <div class="section">Earnings</div>
  <table class="lines">
    ${row('Basic salary', rs(s.basicSalary))}
    ${row('Allowances', rs(s.allowances))}
    ${row('Overtime', rs(s.overtimePay))}
    ${row('Gross pay', rs(s.grossPay), { strong: true })}
  </table>

  <div class="section">Attendance</div>
  <div class="att">
    <span>Working days <b>${s.workingDays}</b></span>
    <span>Present <b>${days(s.presentDays)}</b></span>
    <span>Absent <b>${days(s.absentDays)}</b></span>
    <span>Half days <b>${s.halfDays}</b></span>
    <span>Paid leave <b>${days(s.paidLeaveDays)}</b></span>
    <span>Unpaid leave <b>${days(s.unpaidLeaveDays)}</b></span>
    <span>Holidays <b>${s.holidays}</b></span>
  </div>

  <div class="section">Deductions</div>
  <table class="lines">
    ${row('Absence', rs(s.absenceDeduction), { danger: Number(s.absenceDeduction) > 0 })}
    ${row('Unpaid leave', rs(s.unpaidLeaveDeduction), { danger: Number(s.unpaidLeaveDeduction) > 0 })}
    ${row('Total deductions', rs(s.totalDeductions), { strong: true })}
  </table>

  <div class="net">
    <span class="lbl">Net payable</span>
    <span class="amt">${rs(s.netPayable)}</span>
  </div>

  <div class="note">
    This is a computer-generated payslip and does not require a signature.
    ${isFinal ? '' : 'These figures are provisional and may change until the payroll month is locked.'}
  </div>
</div></body></html>`;
  }
}
