-- Phase 0 seed: program-specific document requirement sets for the first four
-- programs (C11, ICT, LMIA = Canada work-permit family; VISIT = generic visitor).
-- Keyed on programCode (layered over the broad `service` bucket) so a case for
-- a specific program builds the RIGHT checklist instead of the generic list.
--
-- Idempotent: every row guarded by WHERE NOT EXISTS on
-- (programCode, targetCountry, documentName). Re-runs add only what's missing;
-- managers can delete rows they don't want.
--
-- Attestation chains use ASCII '->' (e.g. HEC->MOFA). Verify each list against
-- the live IRCC / official page before relying on it (see lastVerifiedAt on the
-- catalog row). Rules change frequently.

-- ── Document requirement rows ───────────────────────────────────────────────
INSERT INTO "processing"."document_requirement_templates" (
  "id", "service", "targetCountry", "documentName", "description", "criticality",
  "validityRule", "validityMonths", "docType", "documentKind", "programCode",
  "applicantRole", "stageGroup", "attestationRequired", "attestationChain",
  "translationRequired", "sortOrder", "isActive", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), v.service, v.country, v.docname, v.descr,
  v.crit::"processing"."DocumentCriticality",
  v.vrule::"processing"."DocumentValidityRule",
  v.vmonths,
  v.doctype,
  v.dkind::"processing"."DocumentKind",
  v.prog,
  v.role::"processing"."ApplicantRole",
  v.stage::"processing"."DocumentStageGroup",
  v.attreq, v.attchain, v.transreq, v.sortord, TRUE,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  -- ===== C11 — Entrepreneur Work Permit (Canada) =====
  ('WORK_PERMIT','Canada','Passport (bio page)','Clear scan of the passport bio-data page; must stay valid through the permit.','CRITICAL','MUST_BE_VALID_FOR_N_MONTHS',6,'PASSPORT','TEXT_DOCUMENT','C11','PRIMARY','PROVIDE_FIRST',false,NULL,false,1),
  ('WORK_PERMIT','Canada','Passport-sized photographs','Recent photo, white background, per IRCC photo specs.','REQUIRED','NONE',NULL,'PHOTOGRAPH','PHOTO','C11','PRIMARY','PROVIDE_FIRST',false,NULL,false,2),
  ('WORK_PERMIT','Canada','Personal settlement funds','Bank statements showing settlement funds for you and any family.','CRITICAL','NONE',NULL,'BANK_STATEMENT','TEXT_DOCUMENT','C11','PRIMARY','PROVIDE_FIRST',false,NULL,false,3),
  ('WORK_PERMIT','Canada','Business capital proof','Proof of capital to start or operate the Canadian business, separate from settlement funds.','CRITICAL','NONE',NULL,'BANK_STATEMENT','TEXT_DOCUMENT','C11','PRIMARY','NEXT',false,NULL,false,4),
  ('WORK_PERMIT','Canada','Educational credentials','Degrees and transcripts. Pakistani credentials should be HEC then MOFA attested.','REQUIRED','NONE',NULL,'EDUCATIONAL_DOCUMENT','TEXT_DOCUMENT','C11','PRIMARY','NEXT',true,'HEC->MOFA',true,5),
  ('WORK_PERMIT','Canada','Experience / reference letters','Employer letters on letterhead with dates, role and signatory.','REQUIRED','NONE',NULL,'EXPERIENCE_LETTER','TEXT_DOCUMENT','C11','PRIMARY','NEXT',true,'NOTARY->MOFA',false,6),
  ('WORK_PERMIT','Canada','Police clearance certificate','Police character certificate, MOFA-attested. Usually must be recent (about 6 months).','CRITICAL','MUST_BE_VALID_FOR_N_MONTHS',6,'POLICE_CHARACTER_CERTIFICATE','TEXT_DOCUMENT','C11','PRIMARY','NEXT',true,'MOFA',false,7),
  ('WORK_PERMIT','Canada','Medical examination report','Panel-physician immigration medical; valid about 12 months.','CONDITIONAL','MUST_BE_VALID_FOR_N_MONTHS',12,'MEDICAL_REPORT','TEXT_DOCUMENT','C11','PRIMARY','LATER',false,NULL,false,8),
  ('WORK_PERMIT','Canada','Family information form','IRCC family information form for the applicant.','REQUIRED','NONE',NULL,'FORM','TEXT_DOCUMENT','C11','PRIMARY','NEXT',false,NULL,false,9),
  ('WORK_PERMIT','Canada','Business plan','Detailed plan covering market, costs, hiring and Canadian benefit. Reviewed by your consultant.','CRITICAL','NONE',NULL,'BUSINESS_PLAN','TEXT_DOCUMENT','C11','PRIMARY','NEXT',false,NULL,false,10),
  ('WORK_PERMIT','Canada','Proof of at least 51% ownership','Share register or shareholder agreement showing controlling interest.','CRITICAL','NONE',NULL,'OWNERSHIP_PROOF','TEXT_DOCUMENT','C11','PRIMARY','NEXT',false,NULL,false,11),
  ('WORK_PERMIT','Canada','Incorporation / business registration','Federal or provincial incorporation or registration documents.','CRITICAL','NONE',NULL,'INCORPORATION','TEXT_DOCUMENT','C11','PRIMARY','NEXT',false,NULL,false,12),
  ('WORK_PERMIT','Canada','Offer of Employment number + compliance-fee receipt','IRCC Employer Portal offer-of-employment number and the CAD 230 compliance-fee receipt.','CRITICAL','NONE',NULL,'OFFER_OF_EMPLOYMENT','TEXT_DOCUMENT','C11','PRIMARY','NEXT',false,NULL,false,13),
  ('WORK_PERMIT','Canada','Financial statements','Business financial statements or proof of available funds.','REQUIRED','NONE',NULL,'FINANCIALS','TEXT_DOCUMENT','C11','PRIMARY','LATER',false,NULL,false,14),

  -- ===== ICT — Intra-Company Transfer (Canada) =====
  ('WORK_PERMIT','Canada','Passport (bio page)','Clear scan of the passport bio-data page.','CRITICAL','MUST_BE_VALID_FOR_N_MONTHS',6,'PASSPORT','TEXT_DOCUMENT','ICT','PRIMARY','PROVIDE_FIRST',false,NULL,false,1),
  ('WORK_PERMIT','Canada','Passport-sized photographs','Recent photo per IRCC specs.','REQUIRED','NONE',NULL,'PHOTOGRAPH','PHOTO','ICT','PRIMARY','PROVIDE_FIRST',false,NULL,false,2),
  ('WORK_PERMIT','Canada','Qualifying employment proof','Proof of at least 1 year continuous full-time employment with the foreign entity in the last 3 years.','CRITICAL','NONE',NULL,'EXPERIENCE_LETTER','TEXT_DOCUMENT','ICT','PRIMARY','PROVIDE_FIRST',false,NULL,false,3),
  ('WORK_PERMIT','Canada','Job descriptions (foreign and Canadian roles)','Detailed duties and level for both the foreign and the Canadian position.','REQUIRED','NONE',NULL,'JOB_DESCRIPTION','TEXT_DOCUMENT','ICT','PRIMARY','NEXT',false,NULL,false,4),
  ('WORK_PERMIT','Canada','Educational credentials','Degrees and transcripts; HEC then MOFA attested for Pakistani credentials.','REQUIRED','NONE',NULL,'EDUCATIONAL_DOCUMENT','TEXT_DOCUMENT','ICT','PRIMARY','NEXT',true,'HEC->MOFA',true,5),
  ('WORK_PERMIT','Canada','Qualifying-relationship proof','Org chart or ownership documents linking the foreign and Canadian entities.','CRITICAL','NONE',NULL,'CORP_RELATIONSHIP','TEXT_DOCUMENT','ICT','EMPLOYER','NEXT',false,NULL,false,6),
  ('WORK_PERMIT','Canada','Proof both entities are doing business','Incorporation, financials and contracts showing both entities actively operate.','CRITICAL','NONE',NULL,'CORP_LEGITIMACY','TEXT_DOCUMENT','ICT','EMPLOYER','NEXT',false,NULL,false,7),
  ('WORK_PERMIT','Canada','Employer transfer / support letter','Letter stating purpose, duration, role and salary of the transfer.','CRITICAL','NONE',NULL,'EMPLOYER_LETTER','TEXT_DOCUMENT','ICT','EMPLOYER','NEXT',false,NULL,false,8),
  ('WORK_PERMIT','Canada','Offer of Employment number + compliance-fee receipt','IRCC Employer Portal offer number and the CAD 230 fee receipt.','CRITICAL','NONE',NULL,'OFFER_OF_EMPLOYMENT','TEXT_DOCUMENT','ICT','EMPLOYER','NEXT',false,NULL,false,9),
  ('WORK_PERMIT','Canada','Police clearance certificate','Police character certificate, MOFA-attested, recent.','CRITICAL','MUST_BE_VALID_FOR_N_MONTHS',6,'POLICE_CHARACTER_CERTIFICATE','TEXT_DOCUMENT','ICT','PRIMARY','NEXT',true,'MOFA',false,10),
  ('WORK_PERMIT','Canada','Medical examination report','Panel-physician medical; valid about 12 months.','CONDITIONAL','MUST_BE_VALID_FOR_N_MONTHS',12,'MEDICAL_REPORT','TEXT_DOCUMENT','ICT','PRIMARY','LATER',false,NULL,false,11),

  -- ===== LMIA — Skilled Worker (Canada); EMPLOYER stage + worker stage =====
  ('WORK_PERMIT','Canada','LMIA processing-fee receipt','Proof of the CAD 1000 per-position LMIA fee. Cannot be recovered from the worker.','CRITICAL','NONE',NULL,'LMIA_FEE','TEXT_DOCUMENT','LMIA','EMPLOYER','PROVIDE_FIRST',false,NULL,false,1),
  ('WORK_PERMIT','Canada','Recruitment / advertising proof','Job Bank ad plus two other methods, with a 4-week ad within the last 3 months.','CRITICAL','NONE',NULL,'RECRUITMENT','TEXT_DOCUMENT','LMIA','EMPLOYER','PROVIDE_FIRST',false,NULL,false,2),
  ('WORK_PERMIT','Canada','Transition plan','Plan to recruit, train and retain Canadians (high-wage stream).','CRITICAL','NONE',NULL,'TRANSITION_PLAN','TEXT_DOCUMENT','LMIA','EMPLOYER','NEXT',false,NULL,false,3),
  ('WORK_PERMIT','Canada','Business legitimacy documents','CRA documents per entity type (e.g. T2 schedules) and a valid business licence.','CRITICAL','NONE',NULL,'CORP_LEGITIMACY','TEXT_DOCUMENT','LMIA','EMPLOYER','NEXT',false,NULL,false,4),
  ('WORK_PERMIT','Canada','Positive LMIA + Annex A','The approved LMIA letter and Annex A carrying the LMIA number. Valid about 6 months.','CRITICAL','MUST_BE_VALID_FOR_N_MONTHS',6,'LMIA_DECISION','TEXT_DOCUMENT','LMIA','PRIMARY','PROVIDE_FIRST',false,NULL,false,5),
  ('WORK_PERMIT','Canada','Signed job offer','Signed offer or contract matching the LMIA.','CRITICAL','NONE',NULL,'JOB_OFFER','TEXT_DOCUMENT','LMIA','PRIMARY','PROVIDE_FIRST',false,NULL,false,6),
  ('WORK_PERMIT','Canada','Passport (bio page)','Clear scan of the passport bio-data page.','CRITICAL','MUST_BE_VALID_FOR_N_MONTHS',6,'PASSPORT','TEXT_DOCUMENT','LMIA','PRIMARY','PROVIDE_FIRST',false,NULL,false,7),
  ('WORK_PERMIT','Canada','Passport-sized photographs','Recent photo per IRCC specs.','REQUIRED','NONE',NULL,'PHOTOGRAPH','PHOTO','LMIA','PRIMARY','NEXT',false,NULL,false,8),
  ('WORK_PERMIT','Canada','Qualifications and experience','Degrees and experience letters for the role; HEC and MOFA attested where applicable.','REQUIRED','NONE',NULL,'EDUCATIONAL_DOCUMENT','TEXT_DOCUMENT','LMIA','PRIMARY','NEXT',true,'HEC->MOFA',true,9),
  ('WORK_PERMIT','Canada','Police clearance certificate','Police character certificate, MOFA-attested, recent.','CRITICAL','MUST_BE_VALID_FOR_N_MONTHS',6,'POLICE_CHARACTER_CERTIFICATE','TEXT_DOCUMENT','LMIA','PRIMARY','NEXT',true,'MOFA',false,10),
  ('WORK_PERMIT','Canada','Medical examination report','Panel-physician medical; valid about 12 months.','CONDITIONAL','MUST_BE_VALID_FOR_N_MONTHS',12,'MEDICAL_REPORT','TEXT_DOCUMENT','LMIA','PRIMARY','LATER',false,NULL,false,11),
  ('WORK_PERMIT','Canada','Proof of funds','Bank statements showing establishment funds.','REQUIRED','NONE',NULL,'BANK_STATEMENT','TEXT_DOCUMENT','LMIA','PRIMARY','NEXT',false,NULL,false,12),

  -- ===== VISIT — Visitor visa (generic; target country tuned later) =====
  ('VISIT_VISA','GLOBAL','Passport (bio page)','Valid passport with at least 6 months validity.','CRITICAL','MUST_BE_VALID_FOR_N_MONTHS',6,'PASSPORT','TEXT_DOCUMENT','VISIT','PRIMARY','PROVIDE_FIRST',false,NULL,false,1),
  ('VISIT_VISA','GLOBAL','Passport-sized photographs','Recent photo per destination specs.','REQUIRED','NONE',NULL,'PHOTOGRAPH','PHOTO','VISIT','PRIMARY','PROVIDE_FIRST',false,NULL,false,2),
  ('VISIT_VISA','GLOBAL','Bank statements (6 months)','Last 6 months of statements showing sufficient funds for the trip.','CRITICAL','NONE',NULL,'BANK_STATEMENT','TEXT_DOCUMENT','VISIT','PRIMARY','PROVIDE_FIRST',false,NULL,false,3),
  ('VISIT_VISA','GLOBAL','Employment / ties to home country','Job letter, property or family ties showing intent to return.','CRITICAL','NONE',NULL,'TIES_PROOF','TEXT_DOCUMENT','VISIT','PRIMARY','PROVIDE_FIRST',false,NULL,false,4),
  ('VISIT_VISA','GLOBAL','Travel itinerary','Planned travel dates and itinerary.','REQUIRED','NONE',NULL,'ITINERARY','TEXT_DOCUMENT','VISIT','PRIMARY','NEXT',false,NULL,false,5),
  ('VISIT_VISA','GLOBAL','Accommodation / hotel booking','Hotel reservation or host address.','REQUIRED','NONE',NULL,'ACCOMMODATION','TEXT_DOCUMENT','VISIT','PRIMARY','NEXT',false,NULL,false,6),
  ('VISIT_VISA','GLOBAL','Invitation letter','Invitation from a host, if visiting family or friends.','CONDITIONAL','NONE',NULL,'INVITATION','TEXT_DOCUMENT','VISIT','PRIMARY','NEXT',false,NULL,false,7),
  ('VISIT_VISA','GLOBAL','Travel insurance','Travel medical insurance (mandatory for Schengen, about 30000 EUR cover).','CONDITIONAL','NONE',NULL,'INSURANCE','TEXT_DOCUMENT','VISIT','PRIMARY','NEXT',false,NULL,false,8),
  ('VISIT_VISA','GLOBAL','Cover letter','Cover letter explaining the purpose and funding of the trip.','SUPPORTING','NONE',NULL,'COVER_LETTER','TEXT_DOCUMENT','VISIT','PRIMARY','LATER',false,NULL,false,9)
) AS v(service,country,docname,descr,crit,vrule,vmonths,doctype,dkind,prog,role,stage,attreq,attchain,transreq,sortord)
WHERE NOT EXISTS (
  SELECT 1 FROM "processing"."document_requirement_templates" t
  WHERE t."programCode" = v.prog AND t."targetCountry" = v.country AND t."documentName" = v.docname
);

-- ── Photo spec for the photograph rows ──────────────────────────────────────
UPDATE "processing"."document_requirement_templates"
SET "photoSpec" = '{"background":"white","sizeMm":"35x45","faceRequired":true,"maxBlur":0.3}'::jsonb
WHERE "documentKind" = 'PHOTO'
  AND "programCode" IN ('C11','ICT','LMIA','VISIT')
  AND "photoSpec" IS NULL;

-- ── Program catalog rows (manager-facing; last-verified date) ────────────────
INSERT INTO "processing"."program_requirement_sets" (
  "id", "programCode", "targetCountry", "displayName", "isActive",
  "lastVerifiedAt", "createdAt", "updatedAt"
)
SELECT gen_random_uuid(), v.prog, v.country, v.name, TRUE,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('C11','Canada','C11 - Entrepreneur Work Permit (Canada)'),
  ('ICT','Canada','ICT - Intra-Company Transfer (Canada)'),
  ('LMIA','Canada','LMIA - Skilled Worker (Canada)'),
  ('VISIT','GLOBAL','Visitor Visa (generic)')
) AS v(prog,country,name)
WHERE NOT EXISTS (
  SELECT 1 FROM "processing"."program_requirement_sets" s
  WHERE s."programCode" = v.prog AND s."targetCountry" = v.country
);
