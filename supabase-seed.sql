-- ============================================================
-- Tashfeen Immigration Solutions — Seed Data
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor)
-- Safe to run multiple times — all inserts use ON CONFLICT DO NOTHING / DO UPDATE
-- NOTE: Prisma uses camelCase column names in PostgreSQL (no snake_case mapping)
-- ============================================================

-- Enable pgcrypto for bcrypt hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1. PERMISSIONS
-- ============================================================
INSERT INTO permissions (id, key, module, description, "createdAt")
VALUES
  (gen_random_uuid(), 'users.view_all',             'users',             'View all users',                              NOW()),
  (gen_random_uuid(), 'users.create',               'users',             'Create users',                                NOW()),
  (gen_random_uuid(), 'users.update',               'users',             'Update users',                                NOW()),
  (gen_random_uuid(), 'users.deactivate',           'users',             'Deactivate users',                            NOW()),
  (gen_random_uuid(), 'users.assign_role',          'users',             'Assign roles to users',                       NOW()),
  (gen_random_uuid(), 'employees.view_all',         'employees',         'View all employees',                          NOW()),
  (gen_random_uuid(), 'employees.create',           'employees',         'Create employee profiles',                    NOW()),
  (gen_random_uuid(), 'employees.update',           'employees',         'Update employee profiles',                    NOW()),
  (gen_random_uuid(), 'leads.view_all',             'leads',             'View all leads',                              NOW()),
  (gen_random_uuid(), 'leads.view_assigned',        'leads',             'View assigned leads only',                    NOW()),
  (gen_random_uuid(), 'leads.create',               'leads',             'Create leads',                                NOW()),
  (gen_random_uuid(), 'leads.update',               'leads',             'Update leads',                                NOW()),
  (gen_random_uuid(), 'leads.assign',               'leads',             'Assign leads to employees',                   NOW()),
  (gen_random_uuid(), 'leads.convert',              'leads',             'Convert leads to clients',                    NOW()),
  (gen_random_uuid(), 'leads.delete',               'leads',             'Delete/archive leads',                        NOW()),
  (gen_random_uuid(), 'follow_ups.view_all',        'follow_ups',        'View all follow-up tasks',                    NOW()),
  (gen_random_uuid(), 'follow_ups.view_assigned',   'follow_ups',        'View assigned follow-up tasks',               NOW()),
  (gen_random_uuid(), 'follow_ups.create',          'follow_ups',        'Create follow-up tasks',                      NOW()),
  (gen_random_uuid(), 'follow_ups.update',          'follow_ups',        'Update follow-up tasks',                      NOW()),
  (gen_random_uuid(), 'follow_ups.complete',        'follow_ups',        'Complete follow-up tasks',                    NOW()),
  (gen_random_uuid(), 'clients.view_all',           'clients',           'View all clients',                            NOW()),
  (gen_random_uuid(), 'clients.view_assigned',      'clients',           'View assigned clients only',                  NOW()),
  (gen_random_uuid(), 'clients.create',             'clients',           'Create clients',                              NOW()),
  (gen_random_uuid(), 'clients.update',             'clients',           'Update clients',                              NOW()),
  (gen_random_uuid(), 'cases.view_all',             'cases',             'View all cases',                              NOW()),
  (gen_random_uuid(), 'cases.view_assigned',        'cases',             'View assigned cases only',                    NOW()),
  (gen_random_uuid(), 'cases.create',               'cases',             'Create cases',                                NOW()),
  (gen_random_uuid(), 'cases.update',               'cases',             'Update cases',                                NOW()),
  (gen_random_uuid(), 'cases.change_status',        'cases',             'Change case status',                          NOW()),
  (gen_random_uuid(), 'cases.handover',             'cases',             'Handover cases to departments',               NOW()),
  (gen_random_uuid(), 'documents.view_all',         'documents',         'View all documents',                          NOW()),
  (gen_random_uuid(), 'documents.view_assigned',    'documents',         'View assigned client documents',              NOW()),
  (gen_random_uuid(), 'documents.upload',           'documents',         'Upload documents',                            NOW()),
  (gen_random_uuid(), 'documents.verify',           'documents',         'Verify or reject documents',                  NOW()),
  (gen_random_uuid(), 'documents.delete',           'documents',         'Delete documents',                            NOW()),
  (gen_random_uuid(), 'finance.view_all',           'finance',           'View all finance records',                    NOW()),
  (gen_random_uuid(), 'finance.view_assigned',      'finance',           'View assigned client finance records',        NOW()),
  (gen_random_uuid(), 'finance.create_invoice',     'finance',           'Create invoices',                             NOW()),
  (gen_random_uuid(), 'finance.record_payment',     'finance',           'Record payments',                             NOW()),
  (gen_random_uuid(), 'finance.verify_payment',     'finance',           'Verify payments',                             NOW()),
  (gen_random_uuid(), 'finance.refund',             'finance',           'Process refunds',                             NOW()),
  (gen_random_uuid(), 'finance_handover.view_all',  'finance_handover',  'View all finance handovers',                  NOW()),
  (gen_random_uuid(), 'finance_handover.view_own',  'finance_handover',  'View own finance handovers',                  NOW()),
  (gen_random_uuid(), 'finance_handover.create',    'finance_handover',  'Create finance handovers',                    NOW()),
  (gen_random_uuid(), 'finance_handover.update_own','finance_handover',  'Update own finance handovers before review',  NOW()),
  (gen_random_uuid(), 'finance_handover.review',    'finance_handover',  'Review and process finance handovers',        NOW()),
  (gen_random_uuid(), 'appointments.view_all',      'appointments',      'View all appointments',                       NOW()),
  (gen_random_uuid(), 'appointments.view_assigned', 'appointments',      'View own appointments',                       NOW()),
  (gen_random_uuid(), 'appointments.create',        'appointments',      'Create appointments',                         NOW()),
  (gen_random_uuid(), 'appointments.update',        'appointments',      'Update appointments',                         NOW()),
  (gen_random_uuid(), 'appointments.cancel',        'appointments',      'Cancel appointments',                         NOW()),
  (gen_random_uuid(), 'communications.view',        'communications',    'View messages',                               NOW()),
  (gen_random_uuid(), 'communications.send',        'communications',    'Send messages',                               NOW()),
  (gen_random_uuid(), 'reports.view',               'reports',           'View reports',                                NOW()),
  (gen_random_uuid(), 'reports.export',             'reports',           'Export reports',                              NOW()),
  (gen_random_uuid(), 'audit.view',                 'audit',             'View audit logs',                             NOW()),
  (gen_random_uuid(), 'settings.manage',            'settings',          'Manage system settings',                      NOW()),
  (gen_random_uuid(), 'ai.view_jobs',               'ai',                'View AI job outputs',                         NOW()),
  (gen_random_uuid(), 'ai.review_output',           'ai',                'Review and approve AI outputs',               NOW()),
  (gen_random_uuid(), 'partners.view_all',          'partners',          'View all partners',                           NOW()),
  (gen_random_uuid(), 'partners.create',            'partners',          'Create partners',                             NOW()),
  (gen_random_uuid(), 'partners.update',            'partners',          'Update partners',                             NOW()),
  (gen_random_uuid(), 'attendance.view_all',        'attendance',        'View all attendance',                         NOW()),
  (gen_random_uuid(), 'attendance.view_own',        'attendance',        'View own attendance',                         NOW()),
  (gen_random_uuid(), 'attendance.override',        'attendance',        'Override attendance manually',                NOW())
ON CONFLICT (key) DO UPDATE
  SET module      = EXCLUDED.module,
      description = EXCLUDED.description;

-- ============================================================
-- 2. ROLES
-- ============================================================
INSERT INTO roles (id, name, "displayName", description, "isSystem", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'super_admin',   'Super Admin',   'Full system access',                                        TRUE, NOW(), NOW()),
  (gen_random_uuid(), 'admin',         'Admin',         'Administrative access excluding system settings override',  TRUE, NOW(), NOW()),
  (gen_random_uuid(), 'sales',         'Sales',         'Lead and client management',                                TRUE, NOW(), NOW()),
  (gen_random_uuid(), 'documentation', 'Documentation', 'Document collection and verification',                      TRUE, NOW(), NOW()),
  (gen_random_uuid(), 'processing',    'Processing',    'Case processing and submission',                            TRUE, NOW(), NOW()),
  (gen_random_uuid(), 'finance',       'Finance',       'Finance and payment management',                            TRUE, NOW(), NOW()),
  (gen_random_uuid(), 'support',       'Support',       'Client support and communications',                         TRUE, NOW(), NOW()),
  (gen_random_uuid(), 'marketing',     'Marketing',     'Marketing and lead source tracking',                        TRUE, NOW(), NOW()),
  (gen_random_uuid(), 'client',        'Client',        'Client portal access',                                      TRUE, NOW(), NOW()),
  (gen_random_uuid(), 'partner',       'Partner',       'Partner/referral portal access',                            TRUE, NOW(), NOW())
ON CONFLICT (name) DO UPDATE
  SET "displayName" = EXCLUDED."displayName",
      description   = EXCLUDED.description,
      "isSystem"    = TRUE,
      "updatedAt"   = NOW();

-- ============================================================
-- 3. ROLE PERMISSIONS
-- Rebuild system role permissions cleanly
-- ============================================================
DELETE FROM role_permissions
WHERE "roleId" IN (SELECT id FROM roles WHERE "isSystem" = TRUE);

-- super_admin: all permissions
INSERT INTO role_permissions (id, "roleId", "permissionId")
SELECT gen_random_uuid(), r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name = 'super_admin';

-- admin: all except audit module
INSERT INTO role_permissions (id, "roleId", "permissionId")
SELECT gen_random_uuid(), r.id, p.id
FROM roles r JOIN permissions p ON p.module != 'audit'
WHERE r.name = 'admin';

-- sales
INSERT INTO role_permissions (id, "roleId", "permissionId")
SELECT gen_random_uuid(), r.id, p.id
FROM roles r JOIN permissions p ON p.key IN (
  'leads.view_assigned', 'leads.create', 'leads.update', 'leads.assign',
  'follow_ups.view_assigned', 'follow_ups.create', 'follow_ups.update', 'follow_ups.complete',
  'finance_handover.view_own', 'finance_handover.create', 'finance_handover.update_own',
  'clients.view_assigned', 'clients.create', 'clients.update',
  'appointments.view_assigned', 'appointments.create', 'appointments.update',
  'communications.view', 'communications.send'
)
WHERE r.name = 'sales';

-- documentation
INSERT INTO role_permissions (id, "roleId", "permissionId")
SELECT gen_random_uuid(), r.id, p.id
FROM roles r JOIN permissions p ON p.key IN (
  'clients.view_assigned', 'cases.view_assigned',
  'documents.view_assigned', 'documents.upload', 'documents.verify',
  'appointments.view_assigned', 'appointments.create',
  'communications.view', 'communications.send'
)
WHERE r.name = 'documentation';

-- processing
INSERT INTO role_permissions (id, "roleId", "permissionId")
SELECT gen_random_uuid(), r.id, p.id
FROM roles r JOIN permissions p ON p.key IN (
  'clients.view_assigned', 'cases.view_assigned', 'cases.update', 'cases.change_status',
  'documents.view_assigned', 'documents.upload',
  'appointments.view_assigned',
  'communications.view'
)
WHERE r.name = 'processing';

-- finance
INSERT INTO role_permissions (id, "roleId", "permissionId")
SELECT gen_random_uuid(), r.id, p.id
FROM roles r JOIN permissions p ON p.key IN (
  'clients.view_assigned',
  'finance_handover.view_all', 'finance_handover.review',
  'finance.view_all', 'finance.create_invoice', 'finance.record_payment',
  'finance.verify_payment', 'finance.refund'
)
WHERE r.name = 'finance';

-- support
INSERT INTO role_permissions (id, "roleId", "permissionId")
SELECT gen_random_uuid(), r.id, p.id
FROM roles r JOIN permissions p ON p.key IN (
  'clients.view_assigned', 'cases.view_assigned',
  'communications.view', 'communications.send',
  'appointments.view_assigned', 'appointments.create'
)
WHERE r.name = 'support';

-- marketing
INSERT INTO role_permissions (id, "roleId", "permissionId")
SELECT gen_random_uuid(), r.id, p.id
FROM roles r JOIN permissions p ON p.key IN ('leads.view_all', 'reports.view')
WHERE r.name = 'marketing';

-- partner
INSERT INTO role_permissions (id, "roleId", "permissionId")
SELECT gen_random_uuid(), r.id, p.id
FROM roles r JOIN permissions p ON p.key IN ('leads.create')
WHERE r.name = 'partner';

-- ============================================================
-- 4. ORGANIZATION
-- ============================================================
INSERT INTO organizations (id, name, "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'Tashfeen Immigration Solutions', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM organizations LIMIT 1);

-- ============================================================
-- 5. BRANCH
-- ============================================================
INSERT INTO branches (id, "organizationId", name, city, country, "createdAt", "updatedAt")
SELECT gen_random_uuid(), o.id, 'Main Branch', 'Toronto', 'Canada', NOW(), NOW()
FROM organizations o
WHERE NOT EXISTS (SELECT 1 FROM branches WHERE "organizationId" = o.id);

-- ============================================================
-- 6. DEPARTMENT
-- ============================================================
INSERT INTO departments (id, "organizationId", name, description, "createdAt", "updatedAt")
SELECT gen_random_uuid(), o.id, 'Sales', 'Sales consultants and lead follow-up workspace', NOW(), NOW()
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM departments WHERE "organizationId" = o.id AND name = 'Sales'
);

-- ============================================================
-- 7. DESIGNATION
-- ============================================================
INSERT INTO designations (id, name, description, "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'Sales Consultant', 'Lead intake, follow-up, and finance handover consultant', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM designations WHERE name = 'Sales Consultant');

-- ============================================================
-- 8. SERVICES
-- ============================================================
INSERT INTO services (id, name, code, description, "sortOrder", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'Work Permit', 'WORK_PERMIT', 'Work permit consulting and processing service', 1, NOW(), NOW()),
  (gen_random_uuid(), 'Study Visa',  'STUDY_VISA',  'Study visa consulting and processing service',  2, NOW(), NOW()),
  (gen_random_uuid(), 'Visit Visa',  'VISIT_VISA',  'Visit visa consulting and processing service',  3, NOW(), NOW())
ON CONFLICT (code) DO UPDATE
  SET name        = EXCLUDED.name,
      description = EXCLUDED.description,
      "sortOrder" = EXCLUDED."sortOrder",
      "updatedAt" = NOW();

-- ============================================================
-- 9. COUNTRIES
-- ============================================================
INSERT INTO countries (id, name, code, "isoCode", "sortOrder", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'Canada',         'CANADA',         'CA', 1, NOW(), NOW()),
  (gen_random_uuid(), 'Australia',      'AUSTRALIA',      'AU', 2, NOW(), NOW()),
  (gen_random_uuid(), 'United Kingdom', 'UNITED_KINGDOM', 'GB', 3, NOW(), NOW())
ON CONFLICT (code) DO UPDATE
  SET name        = EXCLUDED.name,
      "isoCode"   = EXCLUDED."isoCode",
      "sortOrder" = EXCLUDED."sortOrder",
      "updatedAt" = NOW();

-- ============================================================
-- 10. ADMIN USER  (admin@tashfeen.com / Admin@123456)
-- ============================================================
DO $$
DECLARE
  v_user_id  TEXT;
  v_role_id  TEXT;
  v_hash     TEXT;
BEGIN
  SELECT id INTO v_role_id FROM roles WHERE name = 'super_admin';

  IF NOT EXISTS (SELECT 1 FROM user_accounts WHERE email = 'admin@tashfeen.com') THEN
    v_hash    := crypt('Admin@123456', gen_salt('bf', 12));
    v_user_id := gen_random_uuid()::TEXT;

    INSERT INTO user_accounts (
      id, email, "passwordHash", status,
      "emailVerifiedAt", "mustChangePassword", "createdAt", "updatedAt"
    )
    VALUES (
      v_user_id, 'admin@tashfeen.com', v_hash, 'ACTIVE',
      NOW(), TRUE, NOW(), NOW()
    );

    INSERT INTO user_roles (id, "userId", "roleId", "grantedAt")
    VALUES (gen_random_uuid()::TEXT, v_user_id, v_role_id, NOW());

    RAISE NOTICE 'Created admin user: admin@tashfeen.com';
  ELSE
    RAISE NOTICE 'Admin user already exists — skipping';
  END IF;
END $$;

-- ============================================================
-- 11. SALES CONSULTANT USER  (sales@tashfeen.com / Sales@123456)
-- ============================================================
DO $$
DECLARE
  v_user_id    TEXT;
  v_role_id    TEXT;
  v_dept_id    TEXT;
  v_branch_id  TEXT;
  v_desig_id   TEXT;
  v_hash       TEXT;
BEGIN
  SELECT id INTO v_role_id   FROM roles        WHERE name = 'sales';
  SELECT id INTO v_dept_id   FROM departments  WHERE name = 'Sales' LIMIT 1;
  SELECT id INTO v_branch_id FROM branches     WHERE name = 'Main Branch' LIMIT 1;
  SELECT id INTO v_desig_id  FROM designations WHERE name = 'Sales Consultant';

  IF NOT EXISTS (SELECT 1 FROM user_accounts WHERE email = 'sales@tashfeen.com') THEN
    v_hash    := crypt('Sales@123456', gen_salt('bf', 12));
    v_user_id := gen_random_uuid()::TEXT;

    INSERT INTO user_accounts (
      id, email, "passwordHash", status,
      "emailVerifiedAt", "mustChangePassword", "createdAt", "updatedAt"
    )
    VALUES (
      v_user_id, 'sales@tashfeen.com', v_hash, 'ACTIVE',
      NOW(), TRUE, NOW(), NOW()
    );

    INSERT INTO user_roles (id, "userId", "roleId", "grantedAt")
    VALUES (gen_random_uuid()::TEXT, v_user_id, v_role_id, NOW());

    INSERT INTO employees (
      id, "userId", "departmentId", "branchId", "designationId",
      "employeeCode", "firstName", "lastName", nationality,
      "joiningDate", "isActive", "createdAt", "updatedAt"
    )
    VALUES (
      gen_random_uuid()::TEXT, v_user_id, v_dept_id, v_branch_id, v_desig_id,
      'SAL-001', 'Sales', 'Consultant', 'Canada',
      NOW(), TRUE, NOW(), NOW()
    );

    RAISE NOTICE 'Created sales consultant user: sales@tashfeen.com';
  ELSE
    RAISE NOTICE 'Sales user already exists — skipping';
  END IF;
END $$;

-- ============================================================
-- 12. WALKTHROUGH LEAD
-- ============================================================
DO $$
DECLARE
  v_emp_id    TEXT;
  v_user_id   TEXT;
  v_branch_id TEXT;
BEGIN
  SELECT id INTO v_branch_id FROM branches      WHERE name = 'Main Branch' LIMIT 1;
  SELECT id INTO v_user_id   FROM user_accounts WHERE email = 'sales@tashfeen.com';
  SELECT id INTO v_emp_id    FROM employees      WHERE "userId" = v_user_id;

  IF NOT EXISTS (SELECT 1 FROM leads WHERE phone = '+14165550111' AND "deletedAt" IS NULL) THEN
    INSERT INTO leads (
      id, "assignedEmployeeId", "createdByUserId", "branchId",
      "firstName", "lastName", email, phone,
      nationality, "targetCountry", "serviceInterest", "sourceChannel",
      status, notes, "createdAt", "updatedAt"
    )
    VALUES (
      gen_random_uuid()::TEXT, v_emp_id, v_user_id, v_branch_id,
      'Walkthrough', 'Lead', 'walkthrough.lead@tashfeen.local', '+14165550111',
      'Pakistan', 'Canada', 'Study Visa', 'Walkthrough Seed',
      'FOLLOW_UP',
      'Seeded lead for the Sales portal walkthrough.',
      NOW(), NOW()
    );
    RAISE NOTICE 'Created walkthrough lead';
  ELSE
    RAISE NOTICE 'Walkthrough lead already exists — skipping';
  END IF;
END $$;

-- ============================================================
-- Verification
-- ============================================================
SELECT 'permissions'       AS tbl, COUNT(*) AS rows FROM permissions     -- expect 63
UNION ALL SELECT 'roles',            COUNT(*) FROM roles                  -- expect 10
UNION ALL SELECT 'role_permissions', COUNT(*) FROM role_permissions       -- expect ~130+
UNION ALL SELECT 'organizations',    COUNT(*) FROM organizations          -- expect 1
UNION ALL SELECT 'branches',         COUNT(*) FROM branches               -- expect 1
UNION ALL SELECT 'departments',      COUNT(*) FROM departments            -- expect 1
UNION ALL SELECT 'designations',     COUNT(*) FROM designations           -- expect 1
UNION ALL SELECT 'services',         COUNT(*) FROM services               -- expect 3
UNION ALL SELECT 'countries',        COUNT(*) FROM countries              -- expect 3
UNION ALL SELECT 'user_accounts',    COUNT(*) FROM user_accounts          -- expect 2
UNION ALL SELECT 'user_roles',       COUNT(*) FROM user_roles             -- expect 2
UNION ALL SELECT 'employees',        COUNT(*) FROM employees              -- expect 1
UNION ALL SELECT 'leads',            COUNT(*) FROM leads                  -- expect 1
ORDER BY tbl;
