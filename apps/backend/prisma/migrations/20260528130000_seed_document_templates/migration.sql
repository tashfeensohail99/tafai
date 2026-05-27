-- Seed default DocumentRequirementTemplate rows for the 9 canonical service
-- codes. Each row is keyed at (service, targetCountry='GLOBAL') so it acts as
-- the universal fallback when no country-specific override exists yet.
--
-- Idempotent: every row is guarded by WHERE NOT EXISTS on
-- (service, targetCountry, documentName). Re-running the migration won't
-- duplicate rows, and admins can safely delete templates they don't want —
-- a future re-run will only re-add the missing ones.
--
-- Document lists are intentionally lean (~10 per service) and represent
-- well-known immigration baseline requirements. Admins extend via
-- /processing/admin/templates per (service, targetCountry) for country-
-- specific additions.

INSERT INTO "processing"."document_requirement_templates" (
  "id", "service", "targetCountry", "documentName", "description",
  "criticality", "validityRule", "validityMonths", "sortOrder", "isActive",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  v."service",
  v."targetCountry",
  v."documentName",
  v."description",
  v."criticality"::"processing"."DocumentCriticality",
  v."validityRule"::"processing"."DocumentValidityRule",
  v."validityMonths",
  v."sortOrder",
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (VALUES
  -- =====================================================================
  -- STUDY_VISA
  -- =====================================================================
  ('STUDY_VISA', 'GLOBAL', 'Passport', 'Valid passport with at least 6 months validity beyond intended stay. Submit a clear scan of the bio-data page.', 'CRITICAL', 'MUST_BE_VALID_FOR_N_MONTHS', 6, 1),
  ('STUDY_VISA', 'GLOBAL', 'Passport-sized photographs', 'Recent passport-sized photos with white background as required by the destination authority.', 'REQUIRED', 'NONE', NULL, 2),
  ('STUDY_VISA', 'GLOBAL', 'Letter of Acceptance', 'Official admission/acceptance letter from the educational institution.', 'CRITICAL', 'NONE', NULL, 3),
  ('STUDY_VISA', 'GLOBAL', 'Academic transcripts', 'Transcripts for all completed academic levels (secondary, post-secondary).', 'REQUIRED', 'NONE', NULL, 4),
  ('STUDY_VISA', 'GLOBAL', 'Educational certificates', 'Degree certificates and diplomas for all completed qualifications.', 'REQUIRED', 'NONE', NULL, 5),
  ('STUDY_VISA', 'GLOBAL', 'Language proficiency test', 'IELTS / TOEFL / PTE / Duolingo English Test result (validity typically 24 months).', 'CRITICAL', 'MUST_BE_VALID_FOR_N_MONTHS', 24, 6),
  ('STUDY_VISA', 'GLOBAL', 'Proof of funds', 'Bank statements covering the last 6 months showing tuition + living expenses.', 'CRITICAL', 'NONE', NULL, 7),
  ('STUDY_VISA', 'GLOBAL', 'Statement of Purpose (SOP)', 'Written statement explaining study plan, career goals and reasons for the chosen institution.', 'REQUIRED', 'NONE', NULL, 8),
  ('STUDY_VISA', 'GLOBAL', 'Updated CV / Resume', 'Detailed CV covering education, work experience and achievements.', 'REQUIRED', 'NONE', NULL, 9),
  ('STUDY_VISA', 'GLOBAL', 'Birth certificate', 'Official birth certificate; translated if not in English.', 'SUPPORTING', 'NONE', NULL, 10),
  ('STUDY_VISA', 'GLOBAL', 'Medical examination report', 'Panel-physician medical certificate (required by many destinations).', 'CONDITIONAL', 'MUST_BE_VALID_FOR_N_MONTHS', 12, 11),
  ('STUDY_VISA', 'GLOBAL', 'Police clearance certificate', 'Police clearance from country of residence (required for adult applicants by many destinations).', 'CONDITIONAL', 'MUST_BE_VALID_FOR_N_MONTHS', 6, 12),

  -- =====================================================================
  -- WORK_PERMIT
  -- =====================================================================
  ('WORK_PERMIT', 'GLOBAL', 'Passport', 'Valid passport (12 months min remaining validity preferred).', 'CRITICAL', 'MUST_BE_VALID_FOR_N_MONTHS', 12, 1),
  ('WORK_PERMIT', 'GLOBAL', 'Passport-sized photographs', 'Recent passport-sized photos.', 'REQUIRED', 'NONE', NULL, 2),
  ('WORK_PERMIT', 'GLOBAL', 'Job offer letter / Employment contract', 'Signed offer letter or employment contract from the employer.', 'CRITICAL', 'NONE', NULL, 3),
  ('WORK_PERMIT', 'GLOBAL', 'Educational certificates', 'Degree certificates relevant to the offered role.', 'REQUIRED', 'NONE', NULL, 4),
  ('WORK_PERMIT', 'GLOBAL', 'Work experience letters', 'Reference / experience letters from previous employers covering relevant work history.', 'REQUIRED', 'NONE', NULL, 5),
  ('WORK_PERMIT', 'GLOBAL', 'Updated CV / Resume', 'CV covering complete work history with dates and responsibilities.', 'REQUIRED', 'NONE', NULL, 6),
  ('WORK_PERMIT', 'GLOBAL', 'Medical examination report', 'Panel-physician medical certificate.', 'CONDITIONAL', 'MUST_BE_VALID_FOR_N_MONTHS', 12, 7),
  ('WORK_PERMIT', 'GLOBAL', 'Police clearance certificate', 'Police clearance from country of residence and any country lived in for 6+ months as an adult.', 'CONDITIONAL', 'MUST_BE_VALID_FOR_N_MONTHS', 6, 8),
  ('WORK_PERMIT', 'GLOBAL', 'Bank statements', 'Bank statements covering the last 3-6 months.', 'REQUIRED', 'NONE', NULL, 9),
  ('WORK_PERMIT', 'GLOBAL', 'Marriage certificate', 'Required if dependent spouse is included on the application.', 'CONDITIONAL', 'NONE', NULL, 10),
  ('WORK_PERMIT', 'GLOBAL', 'Birth certificates of dependents', 'Required for each dependent child included on the application.', 'CONDITIONAL', 'NONE', NULL, 11),
  ('WORK_PERMIT', 'GLOBAL', 'Professional licenses / certifications', 'Any role-specific licenses or certifications (e.g. nursing, engineering, trades).', 'CONDITIONAL', 'NONE', NULL, 12),

  -- =====================================================================
  -- PR_CASE (Permanent Residency)
  -- =====================================================================
  ('PR_CASE', 'GLOBAL', 'Passport', 'Valid passport.', 'CRITICAL', 'MUST_BE_VALID_FOR_N_MONTHS', 12, 1),
  ('PR_CASE', 'GLOBAL', 'Passport-sized photographs', 'Recent passport-sized photos.', 'REQUIRED', 'NONE', NULL, 2),
  ('PR_CASE', 'GLOBAL', 'Birth certificate', 'Official birth certificate; translated if not in English.', 'CRITICAL', 'NONE', NULL, 3),
  ('PR_CASE', 'GLOBAL', 'Marriage certificate', 'Required if married; translated if not in English.', 'CONDITIONAL', 'NONE', NULL, 4),
  ('PR_CASE', 'GLOBAL', 'Educational credential assessment (ECA)', 'ECA report from a designated assessing organization (for points-based systems).', 'CRITICAL', 'NONE', NULL, 5),
  ('PR_CASE', 'GLOBAL', 'Language proficiency test', 'IELTS / CELPIP / TEF or equivalent (validity typically 24 months).', 'CRITICAL', 'MUST_BE_VALID_FOR_N_MONTHS', 24, 6),
  ('PR_CASE', 'GLOBAL', 'Work experience letters', 'Reference letters covering all claimed work experience with dates, hours and duties.', 'CRITICAL', 'NONE', NULL, 7),
  ('PR_CASE', 'GLOBAL', 'Police clearance certificates', 'Police clearance from every country lived in for 6+ months as an adult.', 'CRITICAL', 'MUST_BE_VALID_FOR_N_MONTHS', 6, 8),
  ('PR_CASE', 'GLOBAL', 'Medical examination report', 'Panel-physician medical (typically valid 12 months from completion).', 'CRITICAL', 'MUST_BE_VALID_FOR_N_MONTHS', 12, 9),
  ('PR_CASE', 'GLOBAL', 'Proof of funds', 'Bank statements / settlement funds proof for the required amount.', 'CRITICAL', 'NONE', NULL, 10),
  ('PR_CASE', 'GLOBAL', 'Tax records', 'Last 2 years of tax returns / assessments where applicable.', 'REQUIRED', 'NONE', NULL, 11),
  ('PR_CASE', 'GLOBAL', 'Updated CV / Resume', 'Complete employment history.', 'REQUIRED', 'NONE', NULL, 12),

  -- =====================================================================
  -- VISIT_VISA
  -- =====================================================================
  ('VISIT_VISA', 'GLOBAL', 'Passport', 'Valid passport with at least 6 months validity beyond intended stay.', 'CRITICAL', 'MUST_BE_VALID_FOR_N_MONTHS', 6, 1),
  ('VISIT_VISA', 'GLOBAL', 'Passport-sized photographs', 'Recent passport-sized photos.', 'REQUIRED', 'NONE', NULL, 2),
  ('VISIT_VISA', 'GLOBAL', 'Travel itinerary', 'Detailed day-by-day travel plan.', 'REQUIRED', 'NONE', NULL, 3),
  ('VISIT_VISA', 'GLOBAL', 'Hotel reservations', 'Booking confirmations for the duration of stay.', 'REQUIRED', 'NONE', NULL, 4),
  ('VISIT_VISA', 'GLOBAL', 'Flight reservations', 'Return flight reservation / itinerary.', 'REQUIRED', 'NONE', NULL, 5),
  ('VISIT_VISA', 'GLOBAL', 'Bank statements', 'Personal bank statements covering the last 6 months.', 'CRITICAL', 'NONE', NULL, 6),
  ('VISIT_VISA', 'GLOBAL', 'Employment / ties to home country', 'Employment letter, NOC, business registration, or other proof of strong ties to home country.', 'CRITICAL', 'NONE', NULL, 7),
  ('VISIT_VISA', 'GLOBAL', 'Invitation letter', 'Required when visiting family/friends — includes sponsor details and relationship proof.', 'CONDITIONAL', 'NONE', NULL, 8),
  ('VISIT_VISA', 'GLOBAL', 'Travel insurance', 'Insurance covering the full duration of stay (mandatory for some destinations).', 'CONDITIONAL', 'NONE', NULL, 9),
  ('VISIT_VISA', 'GLOBAL', 'Cover letter', 'Written explanation of purpose, duration and ties to home country.', 'REQUIRED', 'NONE', NULL, 10),

  -- =====================================================================
  -- TOURIST_VISA
  -- =====================================================================
  ('TOURIST_VISA', 'GLOBAL', 'Passport', 'Valid passport with at least 6 months validity beyond intended stay.', 'CRITICAL', 'MUST_BE_VALID_FOR_N_MONTHS', 6, 1),
  ('TOURIST_VISA', 'GLOBAL', 'Passport-sized photographs', 'Recent passport-sized photos.', 'REQUIRED', 'NONE', NULL, 2),
  ('TOURIST_VISA', 'GLOBAL', 'Detailed travel itinerary', 'Day-by-day plan covering arrival, accommodation, sightseeing and departure.', 'CRITICAL', 'NONE', NULL, 3),
  ('TOURIST_VISA', 'GLOBAL', 'Hotel bookings', 'Confirmed hotel reservations for the entire duration of stay.', 'REQUIRED', 'NONE', NULL, 4),
  ('TOURIST_VISA', 'GLOBAL', 'Return flight reservations', 'Confirmed return flight bookings.', 'CRITICAL', 'NONE', NULL, 5),
  ('TOURIST_VISA', 'GLOBAL', 'Bank statements', 'Bank statements covering the last 3-6 months showing sufficient funds.', 'CRITICAL', 'NONE', NULL, 6),
  ('TOURIST_VISA', 'GLOBAL', 'Employment letter / leave approval', 'Employer letter confirming employment + approved leave for the travel period.', 'REQUIRED', 'NONE', NULL, 7),
  ('TOURIST_VISA', 'GLOBAL', 'Travel insurance', 'Insurance covering full duration including medical and trip cancellation.', 'REQUIRED', 'NONE', NULL, 8),
  ('TOURIST_VISA', 'GLOBAL', 'Cover letter', 'Written explanation of trip purpose and ties to home country.', 'REQUIRED', 'NONE', NULL, 9),
  ('TOURIST_VISA', 'GLOBAL', 'Tour package booking', 'Tour operator booking confirmation if travelling on a packaged tour.', 'CONDITIONAL', 'NONE', NULL, 10),

  -- =====================================================================
  -- SPOUSE_VISA
  -- =====================================================================
  ('SPOUSE_VISA', 'GLOBAL', 'Passport (applicant)', 'Valid passport of the applicant.', 'CRITICAL', 'MUST_BE_VALID_FOR_N_MONTHS', 12, 1),
  ('SPOUSE_VISA', 'GLOBAL', 'Passport-sized photographs', 'Recent passport-sized photos of both applicant and sponsor.', 'REQUIRED', 'NONE', NULL, 2),
  ('SPOUSE_VISA', 'GLOBAL', 'Marriage certificate', 'Official marriage certificate; translated if not in English.', 'CRITICAL', 'NONE', NULL, 3),
  ('SPOUSE_VISA', 'GLOBAL', 'Wedding photographs', 'Photographs from the wedding ceremony and family events showing the relationship.', 'CRITICAL', 'NONE', NULL, 4),
  ('SPOUSE_VISA', 'GLOBAL', 'Sponsor passport / status proof', 'Sponsor''s passport copy and proof of citizenship / PR / valid status.', 'CRITICAL', 'NONE', NULL, 5),
  ('SPOUSE_VISA', 'GLOBAL', 'Sponsor employment / income proof', 'Sponsor''s employment letter, pay stubs and tax records demonstrating ability to support.', 'CRITICAL', 'NONE', NULL, 6),
  ('SPOUSE_VISA', 'GLOBAL', 'Joint financial records', 'Joint bank statements, lease, utility bills or other proof of shared finances.', 'REQUIRED', 'NONE', NULL, 7),
  ('SPOUSE_VISA', 'GLOBAL', 'Communication history', 'Sample call logs, messages, emails and travel records demonstrating continued contact.', 'REQUIRED', 'NONE', NULL, 8),
  ('SPOUSE_VISA', 'GLOBAL', 'Police clearance certificate', 'Police clearance from every country lived in for 6+ months as an adult.', 'CRITICAL', 'MUST_BE_VALID_FOR_N_MONTHS', 6, 9),
  ('SPOUSE_VISA', 'GLOBAL', 'Medical examination report', 'Panel-physician medical certificate.', 'CRITICAL', 'MUST_BE_VALID_FOR_N_MONTHS', 12, 10),
  ('SPOUSE_VISA', 'GLOBAL', 'Birth certificate', 'Birth certificate of applicant; translated if not in English.', 'REQUIRED', 'NONE', NULL, 11),
  ('SPOUSE_VISA', 'GLOBAL', 'Statement of relationship', 'Written narrative covering how the couple met, courtship, marriage and ongoing relationship.', 'REQUIRED', 'NONE', NULL, 12),

  -- =====================================================================
  -- E2_VISA (US Treaty Investor)
  -- =====================================================================
  ('E2_VISA', 'GLOBAL', 'Passport', 'Valid passport of treaty country nationality.', 'CRITICAL', 'MUST_BE_VALID_FOR_N_MONTHS', 12, 1),
  ('E2_VISA', 'GLOBAL', 'Passport-sized photographs', 'Recent passport-sized photos meeting US visa specifications.', 'REQUIRED', 'NONE', NULL, 2),
  ('E2_VISA', 'GLOBAL', 'Business plan', 'Comprehensive 5-year business plan with financial projections and hiring plan.', 'CRITICAL', 'NONE', NULL, 3),
  ('E2_VISA', 'GLOBAL', 'Proof of investment', 'Wire transfer records, escrow agreements and bank documents showing funds in the US business.', 'CRITICAL', 'NONE', NULL, 4),
  ('E2_VISA', 'GLOBAL', 'Source of funds documentation', 'Paper trail proving lawful source of investment funds (sale records, tax returns, gift deeds).', 'CRITICAL', 'NONE', NULL, 5),
  ('E2_VISA', 'GLOBAL', 'Business registration documents', 'Articles of incorporation, EIN letter, state filings and operating agreements for the US business.', 'CRITICAL', 'NONE', NULL, 6),
  ('E2_VISA', 'GLOBAL', 'Treaty country nationality proof', 'Documents proving treaty country nationality (passport bio page + birth certificate).', 'CRITICAL', 'NONE', NULL, 7),
  ('E2_VISA', 'GLOBAL', 'Lease / property documents', 'Commercial lease or property purchase agreement for the US business premises.', 'REQUIRED', 'NONE', NULL, 8),
  ('E2_VISA', 'GLOBAL', 'Financial statements', 'Profit-and-loss, balance sheet and cash flow statements for the US business.', 'REQUIRED', 'NONE', NULL, 9),
  ('E2_VISA', 'GLOBAL', 'Tax returns', 'Personal and business tax returns from the last 3 years where available.', 'REQUIRED', 'NONE', NULL, 10),
  ('E2_VISA', 'GLOBAL', 'Educational / professional credentials', 'Degrees, certifications and professional licenses relevant to the business.', 'REQUIRED', 'NONE', NULL, 11),
  ('E2_VISA', 'GLOBAL', 'DS-160 confirmation page', 'Completed DS-160 form confirmation page with barcode.', 'CRITICAL', 'NONE', NULL, 12),

  -- =====================================================================
  -- CBI (Citizenship by Investment)
  -- =====================================================================
  ('CBI', 'GLOBAL', 'Passport', 'Valid passport.', 'CRITICAL', 'MUST_BE_VALID_FOR_N_MONTHS', 12, 1),
  ('CBI', 'GLOBAL', 'Passport-sized photographs', 'Recent passport-sized photos meeting program specifications.', 'REQUIRED', 'NONE', NULL, 2),
  ('CBI', 'GLOBAL', 'Birth certificate', 'Official birth certificate; apostilled / authenticated as required.', 'CRITICAL', 'NONE', NULL, 3),
  ('CBI', 'GLOBAL', 'Police clearance certificates', 'Police clearance from every country lived in for 6+ months as an adult.', 'CRITICAL', 'MUST_BE_VALID_FOR_N_MONTHS', 6, 4),
  ('CBI', 'GLOBAL', 'Medical / health certificate', 'Medical certificate / health declaration as required by the program.', 'CRITICAL', 'MUST_BE_VALID_FOR_N_MONTHS', 6, 5),
  ('CBI', 'GLOBAL', 'Source of funds documentation', 'Detailed paper trail proving lawful source of investment + supporting wealth.', 'CRITICAL', 'NONE', NULL, 6),
  ('CBI', 'GLOBAL', 'Bank statements', 'Bank statements covering the last 12 months.', 'CRITICAL', 'NONE', NULL, 7),
  ('CBI', 'GLOBAL', 'Investment / SPA confirmation', 'Signed Sale & Purchase Agreement or contribution confirmation per program option.', 'CRITICAL', 'NONE', NULL, 8),
  ('CBI', 'GLOBAL', 'Marriage certificate', 'Required if spouse is included on the application.', 'CONDITIONAL', 'NONE', NULL, 9),
  ('CBI', 'GLOBAL', 'Educational certificates', 'Degrees and diplomas; apostilled where required.', 'SUPPORTING', 'NONE', NULL, 10),
  ('CBI', 'GLOBAL', 'Updated CV / Resume', 'Detailed CV covering education, employment and significant achievements.', 'REQUIRED', 'NONE', NULL, 11),
  ('CBI', 'GLOBAL', 'Professional reference letters', '2-3 professional reference letters from bankers, lawyers or business associates.', 'REQUIRED', 'NONE', NULL, 12),
  ('CBI', 'GLOBAL', 'Due diligence form', 'Completed program due-diligence questionnaire / personal declaration.', 'CRITICAL', 'NONE', NULL, 13),
  ('CBI', 'GLOBAL', 'Net worth statement', 'Sworn net-worth statement supported by asset documentation.', 'REQUIRED', 'NONE', NULL, 14),

  -- =====================================================================
  -- JR_RESUBMISSION (Judicial Review / Resubmission after refusal)
  -- =====================================================================
  ('JR_RESUBMISSION', 'GLOBAL', 'Previous refusal letter', 'Complete refusal letter / GCMS notes from the previous application.', 'CRITICAL', 'NONE', NULL, 1),
  ('JR_RESUBMISSION', 'GLOBAL', 'Previous application package', 'Full set of documents submitted with the previous (refused) application.', 'CRITICAL', 'NONE', NULL, 2),
  ('JR_RESUBMISSION', 'GLOBAL', 'New supporting evidence', 'New evidence directly addressing each ground of refusal cited in the previous decision.', 'CRITICAL', 'NONE', NULL, 3),
  ('JR_RESUBMISSION', 'GLOBAL', 'Updated police clearance', 'Fresh police clearance certificates.', 'REQUIRED', 'MUST_BE_VALID_FOR_N_MONTHS', 6, 4),
  ('JR_RESUBMISSION', 'GLOBAL', 'Updated medical examination', 'Fresh panel-physician medical certificate if the previous one has expired.', 'CONDITIONAL', 'MUST_BE_VALID_FOR_N_MONTHS', 12, 5),
  ('JR_RESUBMISSION', 'GLOBAL', 'Legal counsel submissions', 'Legal memo or submissions prepared by counsel addressing the refusal grounds.', 'REQUIRED', 'NONE', NULL, 6),
  ('JR_RESUBMISSION', 'GLOBAL', 'Affidavit / Statutory declaration', 'Sworn affidavit clarifying or correcting facts misstated in the previous application.', 'REQUIRED', 'NONE', NULL, 7),
  ('JR_RESUBMISSION', 'GLOBAL', 'Updated bank statements', 'Latest bank statements covering the last 6 months.', 'REQUIRED', 'NONE', NULL, 8),
  ('JR_RESUBMISSION', 'GLOBAL', 'Passport', 'Current valid passport.', 'REQUIRED', 'MUST_BE_VALID_FOR_N_MONTHS', 6, 9),
  ('JR_RESUBMISSION', 'GLOBAL', 'Cover letter', 'Cover letter explaining what has changed since the previous application and why the refusal grounds no longer apply.', 'REQUIRED', 'NONE', NULL, 10)
) AS v(
  "service", "targetCountry", "documentName", "description",
  "criticality", "validityRule", "validityMonths", "sortOrder"
)
WHERE NOT EXISTS (
  SELECT 1 FROM "processing"."document_requirement_templates" t
  WHERE t."service" = v."service"
    AND t."targetCountry" = v."targetCountry"
    AND t."documentName" = v."documentName"
);
