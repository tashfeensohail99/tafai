import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { PdfRenderService } from '../pdf/pdf.service';
import { brandedPdfOptions, LOGO_DATA_URI } from '../pdf/branding';
import type { HydratedWorkReport } from './jr-work-report.service';

/**
 * Caps on inline image embedding. Puppeteer holds every base64 data URI in
 * memory while it lays the page out, so an uncapped report (a Head can attach
 * dozens of 25 MB screenshots) OOMs headless Chrome mid-render. We embed at most
 * MAX_EMBEDDED_IMAGES, and stop once the running total crosses MAX_EMBEDDED_BYTES
 * — whichever trips first. Dropped images are logged and replaced with a small
 * "omitted" placeholder so the PDF still records that they existed.
 */
const MAX_EMBEDDED_IMAGES = 20;
const MAX_EMBEDDED_BYTES = 15 * 1024 * 1024;

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function esc(value: string | null | undefined): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}

/** Short, locale-stable date used across the report body. */
function fmtDate(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * Renders a JR associate work report as a branded A4 PDF through the shared
 * headless-Chrome engine (§11.7, PR 10C) — the same letterhead as payslips /
 * receipts / agreements. Mirrors {@link PayslipPdfService}: build HTML, hand it
 * to {@link PdfRenderService} with {@link brandedPdfOptions}.
 *
 * The compiled body arrives already hydrated (never recompiled here). Image
 * attachments are embedded as base64 data URIs — NEVER a signed-URL `<img src>`,
 * which would expire mid-render and hang puppeteer. Those downloads are strictly
 * SERIALIZED and CAPPED (count + total bytes) so a fat report can't OOM Chrome.
 */
@Injectable()
export class JrWorkReportPdfService {
  private readonly logger = new Logger(JrWorkReportPdfService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly pdf: PdfRenderService,
  ) {}

  /** Hydrated report → branded PDF bytes. */
  async render(hydrated: HydratedWorkReport): Promise<Buffer> {
    const html = await this.renderHtml(hydrated);
    return this.pdf.renderHtml(html, brandedPdfOptions());
  }

  /**
   * Build the full branded HTML document from a hydrated report. Async because
   * embedded images are downloaded (serialized + capped) into base64 data URIs.
   */
  async renderHtml(hydrated: HydratedWorkReport): Promise<string> {
    const { report, body, notes } = hydrated;
    const isFinal = report.status === 'FINALIZED';
    const subject = esc(report.subjectName) || 'JR associate';
    const periodLabel = `${fmtDate(report.periodFrom)} — ${fmtDate(report.periodTo)}`;

    const s = body.summary;
    const tiles = [
      { k: 'Matters', v: s.matterCount },
      { k: 'Draft versions', v: s.draftVersions },
      { k: 'Submitted for review', v: s.submittedForReview },
      { k: 'Counsel approvals', v: s.approvals },
      { k: 'Changes requested', v: s.changesRequested },
      { k: 'Filings', v: s.filings },
      { k: 'Case notes', v: s.caseNotes },
      { k: 'Wins', v: s.wins },
    ];

    const tilesHtml = tiles
      .map(
        (t) => `
        <div class="tile">
          <div class="tile-v">${t.v}</div>
          <div class="tile-k">${esc(t.k)}</div>
        </div>`,
      )
      .join('');

    const mattersRows = body.matters.length
      ? body.matters
          .map(
            (m) => `
        <tr>
          <td>${esc(m.matterNumber) || '—'}</td>
          <td>${esc(m.clientName) || esc(m.styleOfCause) || '—'}</td>
          <td>${esc(humanize(m.stage))}</td>
          <td style="text-align:right;">${m.draftVersions}</td>
          <td style="text-align:center;">${m.isWin ? '<span class="win">WIN</span>' : ''}</td>
        </tr>`,
          )
          .join('')
      : `<tr><td colspan="5" class="muted">No matters credited in this period.</td></tr>`;

    const caseNotesHtml = body.caseNotes.length
      ? `<ul class="list">${body.caseNotes
          .map(
            (n) =>
              `<li><span class="tag">${esc(humanize(n.noteType))}</span> ${esc(
                n.content,
              )} <span class="muted">· ${fmtDate(n.createdAt)}</span></li>`,
          )
          .join('')}</ul>`
      : `<div class="muted">No case-workspace notes in this period.</div>`;

    const d = body.deadlines;
    const deadlinesHtml = d.items.length
      ? `<table class="lines">
          <thead><tr><th>Milestone</th><th>Due</th><th style="text-align:right;">Status</th></tr></thead>
          <tbody>${d.items
            .map(
              (it) => `
            <tr>
              <td>${esc(it.label) || esc(humanize(it.milestoneKey))}${
                it.isFatal ? ' <span class="fatal">FATAL</span>' : ''
              }</td>
              <td>${fmtDate(it.computedDueAt)}</td>
              <td style="text-align:right;">${esc(humanize(it.status))}</td>
            </tr>`,
            )
            .join('')}</tbody>
        </table>
        <div class="muted" style="margin-top:6px;">On-time ${d.onTime} · Missed ${d.missed} · Pending ${d.pending} (matter-level; deadlines are not individually attributed).</div>`
      : `<div class="muted">No deadlines on the caseload matters.</div>`;

    // Report-level enrichment notes (already HTML-escaped at store time in 10A,
    // but re-escaped defensively here — double-escaping a stored entity is
    // harmless, under-escaping is not).
    const reportNotesHtml = notes.length
      ? `<ul class="list">${notes
          .map(
            (n) => `<li>${esc(n.content)} <span class="muted">· ${fmtDate(n.createdAt)}</span></li>`,
          )
          .join('')}</ul>`
      : `<div class="muted">No report notes.</div>`;

    const attachmentsHtml = await this.buildAttachmentsHtml(report.id);

    return `<!doctype html><html><head><meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color:#0f172a; margin:0; }
  .wrap { padding: 6px 42px 0; }
  .titlebar { display:flex; align-items:flex-end; justify-content:space-between; border-bottom:2px solid #0b1f3a; padding-bottom:10px; margin-bottom:16px; }
  .brand { display:flex; align-items:center; gap:12px; }
  .brand img { height:34px; display:block; }
  .pill { display:inline-block; font-size:10px; font-weight:700; letter-spacing:.05em; padding:3px 10px; border-radius:999px; }
  .grid { display:flex; flex-wrap:wrap; gap:6px 28px; margin-bottom:14px; }
  .field { min-width:160px; }
  .field .k { font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:#94a3b8; }
  .field .v { font-size:13px; font-weight:600; color:#0f172a; margin-top:2px; }
  .section { font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:#0b1f3a; margin:18px 0 6px; }
  .tiles { display:flex; flex-wrap:wrap; gap:8px; }
  .tile { flex:1 1 90px; min-width:90px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; }
  .tile-v { font-size:20px; font-weight:800; color:#0b1f3a; }
  .tile-k { font-size:10px; text-transform:uppercase; letter-spacing:.05em; color:#64748b; margin-top:2px; }
  table.lines { width:100%; border-collapse:collapse; font-size:12px; }
  table.lines th { text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:.05em; color:#94a3b8; padding:6px 8px; border-bottom:1px solid #e2e8f0; }
  table.lines td { padding:7px 8px; border-bottom:1px solid #eef2f7; color:#0f172a; }
  .win { display:inline-block; font-size:9px; font-weight:800; color:#166534; background:#dcfce7; border-radius:999px; padding:2px 7px; }
  .fatal { display:inline-block; font-size:9px; font-weight:800; color:#b91c1c; background:#fee2e2; border-radius:999px; padding:1px 6px; }
  .tag { display:inline-block; font-size:9px; font-weight:700; color:#3730a3; background:#eef2ff; border-radius:999px; padding:1px 7px; margin-right:4px; }
  .list { margin:0; padding-left:18px; font-size:12.5px; line-height:1.6; }
  .muted { color:#94a3b8; font-size:12px; }
  .att { display:flex; flex-wrap:wrap; gap:12px; }
  .att figure { margin:0; max-width:260px; }
  .att img { max-width:260px; max-height:200px; border:1px solid #e2e8f0; border-radius:8px; display:block; }
  .voice { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; font-size:12.5px; }
  .voice .marker { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:#64748b; margin-bottom:4px; }
  .note { margin-top:20px; font-size:10.5px; color:#94a3b8; line-height:1.5; }
</style></head>
<body><div class="wrap">
  <div class="titlebar">
    <div class="brand">
      ${LOGO_DATA_URI ? `<img src="${LOGO_DATA_URI}" alt="Tashfeen"/>` : ''}
      <div>
        <div style="font-size:20px;font-weight:800;color:#0b1f3a;letter-spacing:.02em;">JR work report</div>
        <div style="font-size:12.5px;color:#64748b;margin-top:2px;">${subject} · ${esc(periodLabel)}</div>
        ${
          isFinal
            ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">Snapshot as of ${fmtDate(
                report.updatedAt,
              )}</div>`
            : ''
        }
      </div>
    </div>
    <span class="pill" style="background:${isFinal ? '#dcfce7' : '#fef3c7'};color:${
      isFinal ? '#166534' : '#92400e'
    };">${isFinal ? 'FINALIZED' : 'DRAFT'}</span>
  </div>

  <div class="grid">
    <div class="field"><div class="k">Associate</div><div class="v">${subject}</div></div>
    <div class="field"><div class="k">Period</div><div class="v">${esc(periodLabel)}</div></div>
    <div class="field"><div class="k">Activity</div><div class="v">${
      body.hasActivity ? 'Work recorded' : 'No work this period'
    }</div></div>
  </div>

  <div class="section">Summary</div>
  <div class="tiles">${tilesHtml}</div>

  <div class="section">Matters</div>
  <table class="lines">
    <thead><tr><th>Matter</th><th>Client / cause</th><th>Stage</th><th style="text-align:right;">Drafts</th><th style="text-align:center;">Win</th></tr></thead>
    <tbody>${mattersRows}</tbody>
  </table>

  <div class="section">Case notes</div>
  ${caseNotesHtml}

  <div class="section">Deadlines</div>
  ${deadlinesHtml}

  <div class="section">Report notes</div>
  ${reportNotesHtml}

  <div class="section">Attachments</div>
  ${attachmentsHtml}

  <div class="note">
    This report was compiled from the JR audit log for the period shown.
    ${
      isFinal
        ? 'This is the frozen snapshot filed at finalize; its figures do not change.'
        : 'This is a live draft — its figures recompute until the report is finalized.'
    }
  </div>
</div></body></html>`;
  }

  /**
   * Build the attachments block: images embedded as base64 data URIs (serialized
   * downloads, capped by count + total bytes), each voice note printed as its
   * transcript + a "voice note — audio in-app" marker. NEVER a signed-URL
   * `<img src>` (it expires mid-render and hangs puppeteer).
   */
  private async buildAttachmentsHtml(reportId: string): Promise<string> {
    const attachments = await this.prisma.jrWorkReportAttachment.findMany({
      where: { reportId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        kind: true,
        mimeType: true,
        storageKey: true,
        transcript: true,
        transcriptStatus: true,
      },
    });
    if (attachments.length === 0) return '<div class="muted">No attachments.</div>';

    const images = attachments.filter((a) => a.kind === 'IMAGE');
    const voices = attachments.filter((a) => a.kind === 'VOICE_NOTE');

    // Images — serialized (NEVER Promise.all) + capped so a fat report can't OOM
    // headless Chrome. Stop at the count OR byte ceiling, whichever trips first.
    const figures: string[] = [];
    let embedded = 0;
    let totalBytes = 0;
    let dropped = 0;
    for (const img of images) {
      if (embedded >= MAX_EMBEDDED_IMAGES || totalBytes >= MAX_EMBEDDED_BYTES) {
        dropped += 1;
        continue;
      }
      try {
        const { bytes, mimeType } = await this.storage.download(img.storageKey);
        if (totalBytes + bytes.length > MAX_EMBEDDED_BYTES) {
          dropped += 1;
          continue;
        }
        const mime = mimeType || img.mimeType || 'image/png';
        figures.push(
          `<figure><img src="data:${mime};base64,${bytes.toString('base64')}" alt="attachment"/></figure>`,
        );
        embedded += 1;
        totalBytes += bytes.length;
      } catch (err) {
        dropped += 1;
        this.logger.warn(
          `Skipped image ${img.id} on report ${reportId} — download failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    if (dropped > 0) {
      this.logger.warn(
        `Report ${reportId}: embedded ${embedded} image(s), dropped ${dropped} (cap ${MAX_EMBEDDED_IMAGES} images / ${MAX_EMBEDDED_BYTES} bytes).`,
      );
    }

    const imagesHtml = images.length
      ? `<div class="att">${figures.join('')}</div>${
          dropped > 0
            ? `<div class="muted" style="margin-top:6px;">${dropped} image(s) omitted to keep the PDF within size limits — view them in-app.</div>`
            : ''
        }`
      : '';

    const voicesHtml = voices.length
      ? voices
          .map((v) => {
            const text =
              v.transcriptStatus === 'DONE' && v.transcript
                ? esc(v.transcript)
                : v.transcriptStatus === 'FAILED'
                  ? '<span class="muted">Transcript unavailable.</span>'
                  : '<span class="muted">Transcript pending.</span>';
            return `<div class="voice"><div class="marker">Voice note — audio in-app</div>${text}</div>`;
          })
          .join('')
      : '';

    if (!imagesHtml && !voicesHtml) return '<div class="muted">No attachments.</div>';
    return `${imagesHtml}${imagesHtml && voicesHtml ? '<div style="height:10px;"></div>' : ''}${voicesHtml}`;
  }
}
