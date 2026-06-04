import {
  CommunicationDirection,
  CommunicationMessageType,
  DocumentCriticality,
  DocumentItemStatus,
  FinanceHandoverStatus,
  FollowUpPriority,
  FollowUpStatus,
  LeadStatus,
  PrismaClient,
  ProcessingCaseStage,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const PERMISSIONS: { key: string; module: string; description: string }[] = [
  // Users
  { key: 'users.view_all', module: 'users', description: 'View all users' },
  { key: 'users.create', module: 'users', description: 'Create users' },
  { key: 'users.update', module: 'users', description: 'Update users' },
  { key: 'users.deactivate', module: 'users', description: 'Deactivate users' },
  { key: 'users.assign_role', module: 'users', description: 'Assign roles to users' },
  // Employees
  { key: 'employees.view_all', module: 'employees', description: 'View all employees' },
  { key: 'employees.create', module: 'employees', description: 'Create employee profiles' },
  { key: 'employees.update', module: 'employees', description: 'Update employee profiles' },
  // Attendance & payroll (camera-attendance integration)
  { key: 'attendance.view', module: 'attendance', description: 'View attendance + camera integration' },
  // Leads
  { key: 'leads.view_all', module: 'leads', description: 'View all leads' },
  { key: 'leads.view_assigned', module: 'leads', description: 'View assigned leads only' },
  { key: 'leads.create', module: 'leads', description: 'Create leads' },
  { key: 'leads.update', module: 'leads', description: 'Update leads' },
  { key: 'leads.assign', module: 'leads', description: 'Assign leads to employees' },
  { key: 'leads.convert', module: 'leads', description: 'Convert leads to clients' },
  { key: 'leads.delete', module: 'leads', description: 'Delete/archive leads' },
  // Follow Ups
  { key: 'follow_ups.view_all', module: 'follow_ups', description: 'View all follow-up tasks' },
  { key: 'follow_ups.view_assigned', module: 'follow_ups', description: 'View assigned follow-up tasks' },
  { key: 'follow_ups.create', module: 'follow_ups', description: 'Create follow-up tasks' },
  { key: 'follow_ups.update', module: 'follow_ups', description: 'Update follow-up tasks' },
  { key: 'follow_ups.complete', module: 'follow_ups', description: 'Complete follow-up tasks' },
  // Clients
  { key: 'clients.view_all', module: 'clients', description: 'View all clients' },
  { key: 'clients.view_assigned', module: 'clients', description: 'View assigned clients only' },
  { key: 'clients.create', module: 'clients', description: 'Create clients' },
  { key: 'clients.update', module: 'clients', description: 'Update clients' },
  // Cases
  { key: 'cases.view_all', module: 'cases', description: 'View all cases' },
  { key: 'cases.view_assigned', module: 'cases', description: 'View assigned cases only' },
  { key: 'cases.create', module: 'cases', description: 'Create cases' },
  { key: 'cases.update', module: 'cases', description: 'Update cases' },
  { key: 'cases.change_status', module: 'cases', description: 'Change case status' },
  { key: 'cases.handover', module: 'cases', description: 'Handover cases to departments' },
  // Documents
  { key: 'documents.view_all', module: 'documents', description: 'View all documents' },
  { key: 'documents.view_assigned', module: 'documents', description: 'View assigned client documents' },
  { key: 'documents.upload', module: 'documents', description: 'Upload documents' },
  { key: 'documents.verify', module: 'documents', description: 'Verify or reject documents' },
  { key: 'documents.delete', module: 'documents', description: 'Delete documents' },
  // Finance
  { key: 'finance.view_all', module: 'finance', description: 'View all finance records' },
  { key: 'finance.view_assigned', module: 'finance', description: 'View assigned client finance records' },
  { key: 'finance.create_invoice', module: 'finance', description: 'Create invoices' },
  { key: 'finance.record_payment', module: 'finance', description: 'Record payments' },
  { key: 'finance.verify_payment', module: 'finance', description: 'Verify payments' },
  { key: 'finance.refund', module: 'finance', description: 'Process refunds' },
  // Finance Handover
  { key: 'finance_handover.view_all', module: 'finance_handover', description: 'View all finance handovers' },
  { key: 'finance_handover.view_own', module: 'finance_handover', description: 'View own finance handovers' },
  { key: 'finance_handover.create', module: 'finance_handover', description: 'Create finance handovers' },
  { key: 'finance_handover.update_own', module: 'finance_handover', description: 'Update own finance handovers before review' },
  { key: 'finance_handover.review', module: 'finance_handover', description: 'Review and process finance handovers' },
  // Appointments
  { key: 'appointments.view_all', module: 'appointments', description: 'View all appointments' },
  { key: 'appointments.view_assigned', module: 'appointments', description: 'View own appointments' },
  { key: 'appointments.create', module: 'appointments', description: 'Create appointments' },
  { key: 'appointments.update', module: 'appointments', description: 'Update appointments' },
  { key: 'appointments.cancel', module: 'appointments', description: 'Cancel appointments' },
  // Communications
  { key: 'communications.view', module: 'communications', description: 'View messages' },
  { key: 'communications.send', module: 'communications', description: 'Send messages' },
  // Reports
  { key: 'reports.view', module: 'reports', description: 'View reports' },
  { key: 'reports.export', module: 'reports', description: 'Export reports' },
  // Audit
  { key: 'audit.view', module: 'audit', description: 'View audit logs' },
  // Settings
  { key: 'settings.manage', module: 'settings', description: 'Manage system settings' },
  // AI
  { key: 'ai.view_jobs', module: 'ai', description: 'View AI job outputs' },
  { key: 'ai.review_output', module: 'ai', description: 'Review and approve AI outputs' },
  // Partners
  { key: 'partners.view_all', module: 'partners', description: 'View all partners' },
  { key: 'partners.create', module: 'partners', description: 'Create partners' },
  { key: 'partners.update', module: 'partners', description: 'Update partners' },
  // Attendance
  { key: 'attendance.view_all', module: 'attendance', description: 'View all attendance' },
  { key: 'attendance.view_own', module: 'attendance', description: 'View own attendance' },
  { key: 'attendance.override', module: 'attendance', description: 'Override attendance manually' },
  // WhatsApp
  { key: 'whatsapp.view_inbox', module: 'whatsapp', description: 'View the WhatsApp inbox (own assigned threads)' },
  { key: 'whatsapp.view_all_inboxes', module: 'whatsapp', description: 'View all WhatsApp threads across agents (manager / admin)' },
  { key: 'whatsapp.view_finance_scope', module: 'whatsapp', description: 'View WhatsApp threads of leads with a non-draft agreement (Finance closed-loop comms; narrower than view_all_inboxes)' },
  { key: 'whatsapp.send_message', module: 'whatsapp', description: 'Send WhatsApp messages to assigned threads' },
  { key: 'whatsapp.view_processing_scope', module: 'whatsapp', description: 'View/reply WhatsApp threads of leads/clients that have a processing case (Processing closed-loop comms; narrower than view_all_inboxes)' },
  { key: 'whatsapp.reassign', module: 'whatsapp', description: 'Manually reassign WhatsApp threads to other agents' },
  { key: 'whatsapp.manage_channels', module: 'whatsapp', description: 'Connect / pause / rotate-token on WhatsApp Business numbers' },
  { key: 'whatsapp.manage_templates', module: 'whatsapp', description: 'Sync and review WhatsApp approved templates' },
  { key: 'whatsapp.send_campaign', module: 'whatsapp', description: 'Send WhatsApp template broadcasts (campaigns)' },
  { key: 'whatsapp.view_team_dashboard', module: 'whatsapp', description: 'View manager dashboard (agent load, presence, SLA breaches)' },
  { key: 'whatsapp.manage_settings', module: 'whatsapp', description: 'Configure working hours, SLA target, after-hours template' },
  // Processing (granular — used by ProcessingController)
  { key: 'processing.intake.view', module: 'processing', description: 'View the processing intake queue' },
  { key: 'processing.intake.acknowledge', module: 'processing', description: 'Acknowledge a finance handover into processing' },
  { key: 'processing.case.view_assigned', module: 'processing', description: 'View own assigned processing cases' },
  { key: 'processing.case.view_all', module: 'processing', description: 'View all processing cases (manager / admin)' },
  { key: 'processing.case.assign', module: 'processing', description: 'Assign / reassign processing cases to officers' },
  { key: 'processing.case.update_stage', module: 'processing', description: 'Advance a case through its processing stages' },
  { key: 'processing.document.request', module: 'processing', description: 'Request a document or document correction from the client' },
  { key: 'processing.document.review', module: 'processing', description: 'Review and accept / reject submitted documents' },
  { key: 'processing.document.upload', module: 'processing', description: 'Upload a document on the client\'s behalf' },
  { key: 'processing.document.waive', module: 'processing', description: 'Waive a document checklist item' },
  { key: 'processing.note.create', module: 'processing', description: 'Add a processing note (internal or client-facing)' },
  { key: 'processing.note.view_all', module: 'processing', description: 'View all processing notes including internal' },
  { key: 'processing.task.create', module: 'processing', description: 'Create a processing task' },
  { key: 'processing.communication.send', module: 'processing', description: 'Send a case communication to the client or officer' },
  { key: 'processing.checklist.manage', module: 'processing', description: 'Manage the document checklist templates' },
  { key: 'processing.report.view', module: 'processing', description: 'View processing reports + dashboards' },
  { key: 'processing.report.export', module: 'processing', description: 'Export processing reports as CSV' },
];

const SYSTEM_ROLES: {
  name: string;
  displayName: string;
  description: string;
  permissionKeys: string[];
}[] = [
  {
    name: 'super_admin',
    displayName: 'Super Admin',
    description: 'Full system access',
    permissionKeys: PERMISSIONS.map((p) => p.key),
  },
  {
    name: 'admin',
    displayName: 'Admin',
    description: 'Administrative access excluding system settings override',
    permissionKeys: PERMISSIONS.filter((p) => p.module !== 'audit').map((p) => p.key),
  },
  {
    name: 'sales_manager',
    displayName: 'Sales Manager',
    description: 'Oversee the sales team — see every lead, every agent, every pipeline metric',
    permissionKeys: [
      'leads.view_all', 'leads.create', 'leads.update', 'leads.assign', 'leads.convert',
      'follow_ups.view_all', 'follow_ups.create', 'follow_ups.update', 'follow_ups.complete',
      'finance_handover.view_all', 'finance_handover.create',
      'clients.view_all', 'clients.create', 'clients.update',
      'appointments.view_all', 'appointments.create', 'appointments.update', 'appointments.cancel',
      'communications.view', 'communications.send',
      'whatsapp.view_inbox', 'whatsapp.view_all_inboxes', 'whatsapp.send_message',
      'whatsapp.reassign', 'whatsapp.view_team_dashboard',
      'reports.view', 'reports.export',
      'employees.view_all',
    ],
  },
  {
    name: 'sales',
    displayName: 'Sales Agent',
    description: 'Lead and client management — own assigned book only',
    permissionKeys: [
      'leads.view_assigned', 'leads.create', 'leads.update', 'leads.assign',
      'follow_ups.view_assigned', 'follow_ups.create', 'follow_ups.update', 'follow_ups.complete',
      'finance_handover.view_own', 'finance_handover.create', 'finance_handover.update_own',
      'clients.view_assigned', 'clients.create', 'clients.update',
      'appointments.view_assigned', 'appointments.create', 'appointments.update',
      'communications.view', 'communications.send',
      'whatsapp.view_inbox', 'whatsapp.send_message',
    ],
  },
  {
    name: 'documentation',
    displayName: 'Documentation',
    description: 'Document collection and verification',
    permissionKeys: [
      'clients.view_assigned', 'cases.view_assigned',
      'documents.view_assigned', 'documents.upload', 'documents.verify',
      'appointments.view_assigned', 'appointments.create',
      'communications.view', 'communications.send',
      'whatsapp.view_inbox', 'whatsapp.send_message', 'whatsapp.view_processing_scope',
    ],
  },
  {
    name: 'processing_manager',
    displayName: 'Processing Manager',
    description: 'Oversee processing officers — assign cases, see team workload, manage checklists',
    permissionKeys: [
      'clients.view_all', 'cases.view_all', 'cases.update', 'cases.change_status', 'cases.handover',
      'documents.view_all', 'documents.upload', 'documents.verify',
      'appointments.view_all', 'appointments.create',
      'communications.view', 'communications.send',
      'processing.intake.view', 'processing.intake.acknowledge',
      'processing.case.view_all', 'processing.case.assign', 'processing.case.update_stage',
      'processing.document.request', 'processing.document.review', 'processing.document.upload', 'processing.document.waive',
      'processing.note.create', 'processing.note.view_all',
      'processing.task.create',
      'processing.communication.send',
      'processing.checklist.manage',
      'whatsapp.view_inbox', 'whatsapp.send_message', 'whatsapp.view_processing_scope',
      'processing.report.view', 'processing.report.export',
      'reports.view', 'reports.export',
      'employees.view_all',
    ],
  },
  {
    name: 'processing',
    displayName: 'Processing Officer',
    description: 'Case processing — work assigned cases through their stages',
    permissionKeys: [
      'clients.view_assigned', 'cases.view_assigned', 'cases.update', 'cases.change_status',
      'documents.view_assigned', 'documents.upload',
      'appointments.view_assigned',
      'communications.view',
      'processing.intake.view',
      'processing.case.view_assigned', 'processing.case.update_stage',
      'processing.document.request', 'processing.document.review', 'processing.document.upload',
      'processing.note.create',
      'processing.task.create',
      'processing.communication.send',
      'whatsapp.view_inbox', 'whatsapp.send_message', 'whatsapp.view_processing_scope',
    ],
  },
  {
    name: 'finance_manager',
    displayName: 'Finance Manager',
    description: 'Oversee the finance team — verify payments, run revenue reports',
    permissionKeys: [
      'clients.view_all',
      'finance_handover.view_all', 'finance_handover.review',
      'finance.view_all', 'finance.create_invoice', 'finance.record_payment',
      'finance.verify_payment', 'finance.refund',
      'reports.view', 'reports.export',
      'employees.view_all',
      // Closed-loop client comms — Finance sees the WhatsApp conversation
      // alongside the customer profile. Scoped to leads where Sales has
      // already sent an agreement (status != DRAFT); pre-agreement Sales
      // negotiations stay private. Finance is NOT a round-robin target.
      'whatsapp.view_inbox', 'whatsapp.view_finance_scope', 'whatsapp.send_message',
    ],
  },
  {
    name: 'finance',
    displayName: 'Finance Officer',
    description: 'Finance and payment management — verify own queue',
    permissionKeys: [
      'clients.view_assigned',
      'finance_handover.view_all', 'finance_handover.review',
      'finance.view_all', 'finance.create_invoice', 'finance.record_payment',
      'finance.verify_payment', 'finance.refund',
      // Closed-loop comms on the customer profile (see finance_manager).
      'whatsapp.view_inbox', 'whatsapp.view_finance_scope', 'whatsapp.send_message',
    ],
  },
  {
    name: 'support',
    displayName: 'Support',
    description: 'Client support and communications',
    permissionKeys: [
      'clients.view_assigned', 'cases.view_assigned',
      'communications.view', 'communications.send',
      'appointments.view_assigned', 'appointments.create',
    ],
  },
  {
    name: 'marketing',
    displayName: 'Marketing',
    description: 'Marketing and lead source tracking',
    permissionKeys: ['leads.view_all', 'reports.view'],
  },
  {
    name: 'client',
    displayName: 'Client',
    description: 'Client portal access',
    permissionKeys: [],
  },
  {
    name: 'partner',
    displayName: 'Partner',
    description: 'Partner/referral portal access',
    permissionKeys: ['leads.create'],
  },
];

async function main() {
  console.log('Seeding database...');

  // -----------------------------------------------------------------------
  // Clean up legacy "candidate" scaffolding.
  // Tashfeen's domain is Lead → Client only; there is no Candidate entity.
  // Earlier seeds created candidate_manager / candidate_officer roles and
  // a `candidates.*` permission set as a placeholder. Remove them so the
  // permission catalog and roles list stays accurate. Safe to run repeatedly.
  // -----------------------------------------------------------------------
  const legacyCandidateRoleNames = ['candidate_manager', 'candidate_officer'];
  const legacyCandidateRoles = await prisma.role.findMany({
    where: { name: { in: legacyCandidateRoleNames } },
    select: { id: true },
  });
  if (legacyCandidateRoles.length > 0) {
    await prisma.rolePermission.deleteMany({
      where: { roleId: { in: legacyCandidateRoles.map((r) => r.id) } },
    });
    await prisma.userRole.deleteMany({
      where: { roleId: { in: legacyCandidateRoles.map((r) => r.id) } },
    });
    await prisma.role.deleteMany({
      where: { id: { in: legacyCandidateRoles.map((r) => r.id) } },
    });
    console.log(`Removed ${legacyCandidateRoles.length} legacy candidate role(s)`);
  }
  const legacyCandidatePerms = await prisma.permission.findMany({
    where: { module: 'candidates' },
    select: { id: true },
  });
  if (legacyCandidatePerms.length > 0) {
    await prisma.rolePermission.deleteMany({
      where: { permissionId: { in: legacyCandidatePerms.map((p) => p.id) } },
    });
    await prisma.permission.deleteMany({
      where: { id: { in: legacyCandidatePerms.map((p) => p.id) } },
    });
    console.log(`Removed ${legacyCandidatePerms.length} legacy candidate permission(s)`);
  }

  // Upsert permissions
  for (const perm of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: perm.key },
      update: { description: perm.description, module: perm.module },
      create: perm,
    });
  }
  console.log(`Seeded ${PERMISSIONS.length} permissions`);

  // Upsert roles with permissions
  for (const roleData of SYSTEM_ROLES) {
    const permissionRecords = await prisma.permission.findMany({
      where: { key: { in: roleData.permissionKeys } },
    });

    const existing = await prisma.role.findUnique({ where: { name: roleData.name } });

    if (existing) {
      await prisma.rolePermission.deleteMany({ where: { roleId: existing.id } });
      await prisma.role.update({
        where: { id: existing.id },
        data: {
          displayName: roleData.displayName,
          description: roleData.description,
          isSystem: true,
          rolePermissions: {
            create: permissionRecords.map((p) => ({ permissionId: p.id })),
          },
        },
      });
    } else {
      await prisma.role.create({
        data: {
          name: roleData.name,
          displayName: roleData.displayName,
          description: roleData.description,
          isSystem: true,
          rolePermissions: {
            create: permissionRecords.map((p) => ({ permissionId: p.id })),
          },
        },
      });
    }
  }
  console.log(`Seeded ${SYSTEM_ROLES.length} system roles`);

  // Create default organization
  let org = await prisma.organization.findFirst();
  if (!org) {
    org = await prisma.organization.create({
      data: { name: 'Tashfeen Immigration Solutions' },
    });
    console.log('Created default organization');
  }

  const existingBranch = await prisma.branch.findFirst({
    where: { organizationId: org.id },
  });
  if (!existingBranch) {
    await prisma.branch.create({
      data: {
        organizationId: org.id,
        name: 'Main Branch',
        city: 'Toronto',
        country: 'Canada',
      },
    });
    console.log('Created default branch');
  }

  const mainBranch = await prisma.branch.findFirst({
    where: { organizationId: org.id },
    orderBy: { createdAt: 'asc' },
  });

  let salesDepartment = await prisma.department.findFirst({
    where: { organizationId: org.id, name: 'Sales' },
  });

  if (!salesDepartment) {
    salesDepartment = await prisma.department.create({
      data: {
        organizationId: org.id,
        name: 'Sales',
        description: 'Sales consultants and lead follow-up workspace',
      },
    });
  } else {
    salesDepartment = await prisma.department.update({
      where: { id: salesDepartment.id },
      data: { description: 'Sales consultants and lead follow-up workspace' },
    });
  }

  let salesConsultantDesignation = await prisma.designation.findFirst({
    where: { name: 'Sales Consultant' },
  });

  if (!salesConsultantDesignation) {
    salesConsultantDesignation = await prisma.designation.create({
      data: {
        name: 'Sales Consultant',
        description: 'Lead intake, follow-up, and finance handover consultant',
      },
    });
  } else {
    salesConsultantDesignation = await prisma.designation.update({
      where: { id: salesConsultantDesignation.id },
      data: { description: 'Lead intake, follow-up, and finance handover consultant' },
    });
  }

  const defaultServices = [
    {
      name: 'Work Permit',
      code: 'WORK_PERMIT',
      description: 'Work permit consulting and processing service',
      sortOrder: 1,
    },
    {
      name: 'Study Visa',
      code: 'STUDY_VISA',
      description: 'Study visa consulting and processing service',
      sortOrder: 2,
    },
    {
      name: 'Visit Visa',
      code: 'VISIT_VISA',
      description: 'Visit visa consulting and processing service',
      sortOrder: 3,
    },
  ];

  for (const service of defaultServices) {
    await prisma.service.upsert({
      where: { code: service.code },
      update: service,
      create: service,
    });
  }

  const defaultCountries = [
    {
      name: 'Canada',
      code: 'CANADA',
      isoCode: 'CA',
      sortOrder: 1,
    },
    {
      name: 'Australia',
      code: 'AUSTRALIA',
      isoCode: 'AU',
      sortOrder: 2,
    },
    {
      name: 'United Kingdom',
      code: 'UNITED_KINGDOM',
      isoCode: 'GB',
      sortOrder: 3,
    },
  ];

  for (const country of defaultCountries) {
    await prisma.country.upsert({
      where: { code: country.code },
      update: country,
      create: country,
    });
  }

  // Create super admin user if not exists
  const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'admin@tashfeen.com';
  const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? 'Admin@123456';

  const existingAdmin = await prisma.userAccount.findUnique({
    where: { email: SUPER_ADMIN_EMAIL },
  });

  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 12);
    const superAdminRole = await prisma.role.findUnique({
      where: { name: 'super_admin' },
    });

    if (superAdminRole) {
      await prisma.userAccount.create({
        data: {
          email: SUPER_ADMIN_EMAIL,
          passwordHash,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          mustChangePassword: true,
          userRoles: { create: [{ roleId: superAdminRole.id }] },
        },
      });
      console.log(`Created super admin: ${SUPER_ADMIN_EMAIL}`);
      console.log('IMPORTANT: Change the super admin password after first login');
    }
  }

  const SALES_CONSULTANT_EMAIL = process.env.SALES_CONSULTANT_EMAIL ?? 'sales@tashfeen.com';
  const SALES_CONSULTANT_PASSWORD = process.env.SALES_CONSULTANT_PASSWORD ?? 'Sales@123456';

  let salesUser = await prisma.userAccount.findUnique({
    where: { email: SALES_CONSULTANT_EMAIL },
  });

  const salesRole = await prisma.role.findUnique({ where: { name: 'sales' } });
  if (!salesRole) {
    throw new Error('Sales role missing during seed');
  }

  if (!salesUser) {
    const passwordHash = await bcrypt.hash(SALES_CONSULTANT_PASSWORD, 12);
    salesUser = await prisma.userAccount.create({
      data: {
        email: SALES_CONSULTANT_EMAIL,
        passwordHash,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        mustChangePassword: true,
        userRoles: { create: [{ roleId: salesRole.id }] },
      },
    });
    console.log(`Created sales consultant user: ${SALES_CONSULTANT_EMAIL}`);
  } else {
    const existingSalesRole = await prisma.userRole.findFirst({
      where: { userId: salesUser.id, roleId: salesRole.id },
    });
    if (!existingSalesRole) {
      await prisma.userRole.create({
        data: { userId: salesUser.id, roleId: salesRole.id },
      });
    }
  }

  let salesEmployee = await prisma.employee.findUnique({
    where: { userId: salesUser.id },
  });

  if (!salesEmployee) {
    salesEmployee = await prisma.employee.create({
      data: {
        userId: salesUser.id,
        departmentId: salesDepartment.id,
        branchId: mainBranch?.id,
        designationId: salesConsultantDesignation.id,
        employeeCode: 'SAL-001',
        firstName: 'Sales',
        lastName: 'Consultant',
        nationality: 'Canada',
        joiningDate: new Date(),
        isActive: true,
      },
    });
    console.log('Created sales consultant employee profile');
  }

  let walkthroughLead = await prisma.lead.findFirst({
    where: {
      phone: '+14165550111',
      deletedAt: null,
    },
  });

  const walkthroughVerifiedHandover = walkthroughLead
    ? await prisma.financeHandover.findFirst({
        where: {
          leadId: walkthroughLead.id,
          status: FinanceHandoverStatus.PAYMENT_VERIFIED,
        },
        select: { id: true },
      })
    : null;

  const walkthroughLeadStatus = walkthroughVerifiedHandover ? LeadStatus.CONVERTED : LeadStatus.FOLLOW_UP;

  if (!walkthroughLead) {
    walkthroughLead = await prisma.lead.create({
      data: {
        assignedEmployeeId: salesEmployee.id,
        createdByUserId: salesUser.id,
        branchId: mainBranch?.id,
        firstName: 'Walkthrough',
        lastName: 'Lead',
        email: 'walkthrough.lead@tashfeen.local',
        phone: '+14165550111',
        nationality: 'Pakistan',
        targetCountry: 'Canada',
        serviceInterest: 'Study Visa',
        sourceChannel: 'Walkthrough Seed',
        status: walkthroughLeadStatus,
        notes: 'Seeded lead for the Sales portal walkthrough. Use this record to test follow-up creation and finance handover submission.',
      },
    });
  } else {
    walkthroughLead = await prisma.lead.update({
      where: { id: walkthroughLead.id },
      data: {
        assignedEmployeeId: salesEmployee.id,
        createdByUserId: salesUser.id,
        firstName: 'Walkthrough',
        lastName: 'Lead',
        email: 'walkthrough.lead@tashfeen.local',
        nationality: 'Pakistan',
        targetCountry: 'Canada',
        serviceInterest: 'Study Visa',
        sourceChannel: 'Walkthrough Seed',
        status: walkthroughLeadStatus,
        notes: 'Seeded lead for the Sales portal walkthrough. Use this record to test follow-up creation and finance handover submission.',
      },
    });
  }

  const walkthroughFollowUp = await prisma.followUp.findFirst({
    where: {
      leadId: walkthroughLead.id,
      title: 'Confirm the client document list',
    },
  });

  if (!walkthroughVerifiedHandover && !walkthroughFollowUp) {
    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() + 1);
    dueAt.setHours(10, 0, 0, 0);

    await prisma.followUp.create({
      data: {
        leadId: walkthroughLead.id,
        assignedEmployeeId: salesEmployee.id,
        createdByUserId: salesUser.id,
        title: 'Confirm the client document list',
        description: 'Call the client, confirm the required study visa documents, and prepare the record for finance handover once payment proof is received.',
        contactMethod: 'Call',
        dueAt,
        priority: FollowUpPriority.HIGH,
      },
    });
  }

  if (walkthroughVerifiedHandover) {
    await prisma.followUp.updateMany({
      where: {
        leadId: walkthroughLead.id,
        title: 'Confirm the client document list',
        status: FollowUpStatus.OPEN,
      },
      data: {
        status: FollowUpStatus.CANCELLED,
        outcomeNotes: 'Closed automatically after the verified finance walkthrough completed.',
      },
    });
  }

  let queueDemoLead = await prisma.lead.findFirst({
    where: {
      phone: '+14165550112',
      deletedAt: null,
    },
  });

  if (!queueDemoLead) {
    queueDemoLead = await prisma.lead.create({
      data: {
        assignedEmployeeId: salesEmployee.id,
        createdByUserId: salesUser.id,
        branchId: mainBranch?.id,
        firstName: 'Queue',
        lastName: 'Demo',
        email: 'queue.demo@tashfeen.local',
        phone: '+14165550112',
        nationality: 'Pakistan',
        targetCountry: 'Australia',
        serviceInterest: 'Work Permit',
        sourceChannel: 'Walkthrough Seed',
        status: LeadStatus.FOLLOW_UP,
        notes: 'Open seeded lead for the Sales workspace. Use this one to explore the follow-up queue without affecting the verified walkthrough finance trail.',
      },
    });
  }

  const queueDemoFollowUp = await prisma.followUp.findFirst({
    where: {
      leadId: queueDemoLead.id,
      title: 'Send the next WhatsApp reminder',
      status: { not: 'COMPLETED' },
    },
  });

  if (!queueDemoFollowUp) {
    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() + 2);
    dueAt.setHours(11, 30, 0, 0);

    await prisma.followUp.create({
      data: {
        leadId: queueDemoLead.id,
        assignedEmployeeId: salesEmployee.id,
        createdByUserId: salesUser.id,
        title: 'Send the next WhatsApp reminder',
        description: 'Confirm the consultation timing and keep the lead active in the sales queue for the portal walkthrough.',
        contactMethod: 'WhatsApp',
        dueAt,
        priority: FollowUpPriority.MEDIUM,
      },
    });
  }

  // -----------------------------------------------------------------------
  // Client-portal demo: a converted lead → client with a processing case
  // -----------------------------------------------------------------------
  // Lets a developer log in as `ali.hassan@example.com / client123` and see
  // the four portal pages backed by real data. Re-runnable: every step is
  // guarded by a findUnique/findFirst check.

  const clientRole = await prisma.role.findUnique({ where: { name: 'client' } });
  if (clientRole && mainBranch) {
    const CLIENT_EMAIL = 'ali.hassan@example.com';
    const CLIENT_PASSWORD = 'client123';
    const CLIENT_PHONE = '+923001234567';

    let clientUser = await prisma.userAccount.findUnique({ where: { email: CLIENT_EMAIL } });
    if (!clientUser) {
      const hash = await bcrypt.hash(CLIENT_PASSWORD, 12);
      clientUser = await prisma.userAccount.create({
        data: {
          email: CLIENT_EMAIL,
          passwordHash: hash,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          userRoles: { create: [{ roleId: clientRole.id }] },
        },
      });
      console.log(`Created demo client user: ${CLIENT_EMAIL}`);
    }

    let demoLead = await prisma.lead.findFirst({
      where: { phone: CLIENT_PHONE, deletedAt: null },
    });
    if (!demoLead) {
      demoLead = await prisma.lead.create({
        data: {
          assignedEmployeeId: salesEmployee.id,
          createdByUserId: salesUser.id,
          branchId: mainBranch.id,
          firstName: 'Ali',
          lastName: 'Hassan',
          email: CLIENT_EMAIL,
          phone: CLIENT_PHONE,
          nationality: 'Pakistan',
          targetCountry: 'Canada',
          serviceInterest: 'Work Permit',
          sourceChannel: 'Client Portal Demo Seed',
          status: LeadStatus.CONVERTED,
          notes: 'Demo lead for the client-portal walkthrough.',
        },
      });
    }

    let demoClient = await prisma.client.findUnique({ where: { email: CLIENT_EMAIL } });
    if (!demoClient) {
      demoClient = await prisma.client.create({
        data: {
          branchId: mainBranch.id,
          createdByUserId: salesUser.id,
          firstName: 'Ali',
          lastName: 'Hassan',
          email: CLIENT_EMAIL,
          phone: CLIENT_PHONE,
          nationality: 'Pakistan',
          status: 'UNDER_PROCESSING',
          portalAccessEnabled: true,
          sourceLeadId: demoLead.id,
          assignedEmployeeId: salesEmployee.id,
          serviceType: 'Work Permit',
          targetCountry: 'Canada',
        },
      });
      console.log('Created demo client record (portal access enabled)');
    } else if (!demoClient.portalAccessEnabled) {
      await prisma.client.update({
        where: { id: demoClient.id },
        data: { portalAccessEnabled: true },
      });
    }

    // Make sure the lead → client backlink is set (so the converted-from-lead
    // flow stays consistent on re-runs).
    if (!demoLead.convertedClientId) {
      await prisma.lead.update({
        where: { id: demoLead.id },
        data: { convertedClientId: demoClient.id, convertedAt: new Date() },
      });
    }

    // FinanceHandover requires a verified-style status to link to ProcessingCase.
    let demoHandover = await prisma.financeHandover.findFirst({
      where: { leadId: demoLead.id },
    });
    if (!demoHandover) {
      demoHandover = await prisma.financeHandover.create({
        data: {
          leadId: demoLead.id,
          createdByUserId: salesUser.id,
          status: FinanceHandoverStatus.SENT_TO_PROCESSING,
          submittedAmount: '5000.00',
          currency: 'CAD',
          paymentMethod: 'BANK_TRANSFER',
          transactionRef: 'PORTAL-DEMO-001',
          receiptKey: 'demo/receipts/portal-demo-001.pdf',
          receiptFileName: 'receipt.pdf',
          receiptMimeType: 'application/pdf',
          notes: 'Seeded for the client portal walkthrough.',
        },
      });
    }

    // ProcessingCase is the heart of the portal — link it to client + handover.
    let demoCase = await prisma.processingCase.findUnique({
      where: { financeHandoverId: demoHandover.id },
    });
    if (!demoCase) {
      demoCase = await prisma.processingCase.create({
        data: {
          financeHandoverId: demoHandover.id,
          leadId: demoLead.id,
          clientId: demoClient.id,
          branchId: mainBranch.id,
          createdByUserId: salesUser.id,
          assignedOfficerId: salesUser.id, // re-use sales as the assigned officer for demo
          stage: ProcessingCaseStage.DOCUMENTS_UNDER_REVIEW,
          service: 'Work Permit',
          targetCountry: 'Canada',
        },
      });
      console.log('Created demo processing case');
    }

    // Document checklist for the case.
    const existingDocs = await prisma.caseDocumentItem.count({ where: { caseId: demoCase.id } });
    if (existingDocs === 0) {
      const docs: Array<{
        name: string;
        description: string;
        criticality: DocumentCriticality;
        status: DocumentItemStatus;
      }> = [
        {
          name: 'Valid Passport',
          description: 'Must have minimum 6 months validity remaining',
          criticality: DocumentCriticality.CRITICAL,
          status: DocumentItemStatus.ACCEPTED,
        },
        {
          name: 'IELTS Certificate',
          description: 'English proficiency test — Band 6.0 or higher',
          criticality: DocumentCriticality.CRITICAL,
          status: DocumentItemStatus.UNDER_REVIEW,
        },
        {
          name: 'Educational Degree',
          description: 'HEC-attested copy required',
          criticality: DocumentCriticality.REQUIRED,
          status: DocumentItemStatus.REJECTED,
        },
        {
          name: 'Police Clearance Certificate',
          description: 'From your country of residence, within the last 6 months',
          criticality: DocumentCriticality.REQUIRED,
          status: DocumentItemStatus.NOT_SUBMITTED,
        },
        {
          name: 'Medical Certificate',
          description: 'From an approved physician — immigration medical exam',
          criticality: DocumentCriticality.REQUIRED,
          status: DocumentItemStatus.NOT_SUBMITTED,
        },
      ];
      for (const [i, d] of docs.entries()) {
        await prisma.caseDocumentItem.create({
          data: {
            caseId: demoCase.id,
            documentName: d.name,
            description: d.description,
            criticality: d.criticality,
            status: d.status,
            sortOrder: i,
            expectedFormats: ['PDF'],
          },
        });
      }
      console.log(`Created ${docs.length} demo document checklist items`);
    }

    // One officer-to-client message so the messages tab is not empty.
    const existingMsg = await prisma.caseCommunication.count({ where: { caseId: demoCase.id } });
    if (existingMsg === 0) {
      await prisma.caseCommunication.create({
        data: {
          caseId: demoCase.id,
          direction: CommunicationDirection.OFFICER_TO_CLIENT,
          messageType: CommunicationMessageType.DOCS_REQUEST,
          subject: 'Documents required — please upload',
          content:
            'Dear Ali, please upload your Police Clearance Certificate and Medical Certificate at your earliest convenience. For your Educational Degree, we need the HEC-attested copy — a plain photocopy is not accepted.',
          channelsSent: ['PORTAL'],
          sentByUserId: salesUser.id,
        },
      });
    }
  } else if (!clientRole) {
    console.warn('No `client` role found — skipping client-portal demo seed.');
  }

  // -----------------------------------------------------------------------
  // CRM admin demo dataset
  // -----------------------------------------------------------------------
  // Populates /admin/sales, /admin/leads, /admin/clients, /admin/appointments,
  // /admin/finance with enough variety that the premium UI has something to
  // render. Idempotent — every record is guarded by a uniqueness check.
  if (mainBranch && salesRole) {
    // 3 extra sales employees so the team table on /admin/sales isn't a
    // single row. Each becomes a WhatsApp inbox member with rotating skills.
    const DEMO_AGENTS: Array<{
      email: string;
      firstName: string;
      lastName: string;
      employeeCode: string;
      skills: string[];
    }> = [
      { email: 'fatima.r@tashfeen.com', firstName: 'Fatima', lastName: 'Raza', employeeCode: 'SAL-002', skills: ['Canada', 'Student'] },
      { email: 'omar.k@tashfeen.com', firstName: 'Omar', lastName: 'Khan', employeeCode: 'SAL-003', skills: ['UK', 'Work permit'] },
      { email: 'zainab.a@tashfeen.com', firstName: 'Zainab', lastName: 'Ali', employeeCode: 'SAL-004', skills: ['Australia', 'Family visa'] },
    ];
    const agentEmployees: Array<{ id: string; firstName: string; lastName: string }> = [
      { id: salesEmployee.id, firstName: salesEmployee.firstName, lastName: salesEmployee.lastName },
    ];
    for (const a of DEMO_AGENTS) {
      let u = await prisma.userAccount.findUnique({ where: { email: a.email } });
      if (!u) {
        const hash = await bcrypt.hash('demo123!', 12);
        u = await prisma.userAccount.create({
          data: {
            email: a.email,
            passwordHash: hash,
            status: 'ACTIVE',
            emailVerifiedAt: new Date(),
            userRoles: { create: [{ roleId: salesRole.id }] },
          },
        });
      }
      let emp = await prisma.employee.findUnique({ where: { userId: u.id } });
      if (!emp) {
        emp = await prisma.employee.create({
          data: {
            userId: u.id,
            departmentId: salesDepartment.id,
            branchId: mainBranch.id,
            designationId: salesConsultantDesignation.id,
            employeeCode: a.employeeCode,
            firstName: a.firstName,
            lastName: a.lastName,
            nationality: 'Pakistan',
            joiningDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
            isActive: true,
            whatsappInboxMember: true,
            skills: a.skills,
            presenceStatus: 'ONLINE',
            lastActivityAt: new Date(),
          },
        });
      }
      agentEmployees.push({ id: emp.id, firstName: emp.firstName, lastName: emp.lastName });
    }

    // 18 demo leads spread across statuses + agents + sources. Phone is the
    // uniqueness key so re-runs find existing rows.
    const DEMO_LEADS: Array<{
      first: string; last: string; phone: string; country: string; service: string; status: LeadStatus; source: string; agentIdx: number;
    }> = [
      { first: 'Hassan',  last: 'Iqbal',  phone: '+923331100201', country: 'Canada',    service: 'Study Visa',    status: LeadStatus.NEW,           source: 'WhatsApp',     agentIdx: 0 },
      { first: 'Ayesha',  last: 'Sheikh', phone: '+923331100202', country: 'Australia', service: 'Work Permit',   status: LeadStatus.NEW,           source: 'Facebook',     agentIdx: 1 },
      { first: 'Bilal',   last: 'Mahmood',phone: '+923331100203', country: 'UK',        service: 'Student Visa',  status: LeadStatus.CONTACTED,     source: 'Website',      agentIdx: 2 },
      { first: 'Sana',    last: 'Khan',   phone: '+923331100204', country: 'Canada',    service: 'Work Permit',   status: LeadStatus.CONTACTED,     source: 'WhatsApp',     agentIdx: 3 },
      { first: 'Imran',   last: 'Ahmad',  phone: '+923331100205', country: 'UK',        service: 'Family Visa',   status: LeadStatus.QUALIFIED,     source: 'Referral',     agentIdx: 0 },
      { first: 'Kashif',  last: 'Hussain',phone: '+923331100206', country: 'Australia', service: 'Student Visa',  status: LeadStatus.QUALIFIED,     source: 'WhatsApp',     agentIdx: 1 },
      { first: 'Maria',   last: 'Tariq',  phone: '+923331100207', country: 'Canada',    service: 'Visit Visa',    status: LeadStatus.PROPOSAL_SENT, source: 'Walk-in',      agentIdx: 2 },
      { first: 'Usman',   last: 'Rashid', phone: '+923331100208', country: 'USA',       service: 'Work Permit',   status: LeadStatus.PROPOSAL_SENT, source: 'Website',      agentIdx: 3 },
      { first: 'Nida',    last: 'Saeed',  phone: '+923331100209', country: 'UK',        service: 'Student Visa',  status: LeadStatus.FOLLOW_UP,     source: 'WhatsApp',     agentIdx: 0 },
      { first: 'Adeel',   last: 'Naveed', phone: '+923331100210', country: 'Canada',    service: 'Work Permit',   status: LeadStatus.FOLLOW_UP,     source: 'Facebook',     agentIdx: 1 },
      { first: 'Hira',    last: 'Mirza',  phone: '+923331100211', country: 'Australia', service: 'Family Visa',   status: LeadStatus.FOLLOW_UP,     source: 'Referral',     agentIdx: 2 },
      { first: 'Saad',    last: 'Aslam',  phone: '+923331100212', country: 'Canada',    service: 'Student Visa',  status: LeadStatus.CONVERTED,     source: 'WhatsApp',     agentIdx: 0 },
      { first: 'Hina',    last: 'Akbar',  phone: '+923331100213', country: 'UK',        service: 'Work Permit',   status: LeadStatus.CONVERTED,     source: 'Website',      agentIdx: 1 },
      { first: 'Yasir',   last: 'Mustafa',phone: '+923331100214', country: 'Australia', service: 'Visit Visa',    status: LeadStatus.CONVERTED,     source: 'Walk-in',      agentIdx: 2 },
      { first: 'Sara',    last: 'Hameed', phone: '+923331100215', country: 'USA',       service: 'Student Visa',  status: LeadStatus.LOST,          source: 'Facebook',     agentIdx: 3 },
      { first: 'Asad',    last: 'Bashir', phone: '+923331100216', country: 'Canada',    service: 'Work Permit',   status: LeadStatus.LOST,          source: 'WhatsApp',     agentIdx: 0 },
      { first: 'Komal',   last: 'Javed',  phone: '+923331100217', country: 'UK',        service: 'Family Visa',   status: LeadStatus.UNQUALIFIED,   source: 'Walk-in',      agentIdx: 1 },
      { first: 'Faisal',  last: 'Anwar',  phone: '+923331100218', country: 'Canada',    service: 'Student Visa',  status: LeadStatus.NEW,           source: 'Website',      agentIdx: 2 },
    ];

    const createdLeads: Array<{ id: string; first: string; last: string; phone: string; country: string; service: string; status: LeadStatus; assignedEmployeeId: string }> = [];
    for (const [i, d] of DEMO_LEADS.entries()) {
      const existing = await prisma.lead.findFirst({ where: { phone: d.phone, deletedAt: null } });
      const agent = agentEmployees[d.agentIdx % agentEmployees.length]!;
      // Spread createdAt over the last 45 days so the dashboard "new today"
      // and "30d" counts have variety.
      const daysAgo = Math.floor((i * 45) / DEMO_LEADS.length);
      const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
      let leadId: string;
      if (existing) {
        leadId = existing.id;
      } else {
        const lead = await prisma.lead.create({
          data: {
            assignedEmployeeId: agent.id,
            createdByUserId: salesUser.id,
            branchId: mainBranch.id,
            firstName: d.first,
            lastName: d.last,
            email: `${d.first.toLowerCase()}.${d.last.toLowerCase()}@example.com`,
            phone: d.phone,
            nationality: 'Pakistan',
            targetCountry: d.country,
            serviceInterest: d.service,
            sourceChannel: d.source,
            status: d.status,
            createdAt,
            convertedAt: d.status === LeadStatus.CONVERTED ? createdAt : null,
          },
        });
        leadId = lead.id;
      }
      createdLeads.push({
        id: leadId,
        first: d.first,
        last: d.last,
        phone: d.phone,
        country: d.country,
        service: d.service,
        status: d.status,
        assignedEmployeeId: agent.id,
      });
    }

    // 6 follow-ups, some overdue (the dashboard "overdue follow-ups" widget
    // will pick these up).
    const followUpTargets = createdLeads.filter((l) => l.status === LeadStatus.FOLLOW_UP || l.status === LeadStatus.QUALIFIED).slice(0, 6);
    for (const [i, l] of followUpTargets.entries()) {
      const existing = await prisma.followUp.findFirst({
        where: { leadId: l.id, title: `Demo follow-up #${i + 1}` },
      });
      if (existing) continue;
      const overdue = i < 3;
      const dueAt = overdue
        ? new Date(Date.now() - (i + 1) * 24 * 60 * 60 * 1000)
        : new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000);
      await prisma.followUp.create({
        data: {
          leadId: l.id,
          assignedEmployeeId: l.assignedEmployeeId,
          createdByUserId: salesUser.id,
          title: `Demo follow-up #${i + 1}`,
          description: overdue ? 'Past-due demo task.' : 'Upcoming touchpoint.',
          contactMethod: 'WhatsApp',
          dueAt,
          priority: FollowUpPriority.MEDIUM,
          status: FollowUpStatus.OPEN,
        },
      });
    }

    // 6 appointments — 2 today, 4 over the next week. Mix of types.
    const today = new Date();
    today.setHours(10, 0, 0, 0);
    const appointmentSpecs: Array<{ offsetDays: number; hour: number; title: string; type: string; leadIdx: number }> = [
      { offsetDays: 0, hour: 10, title: 'Initial consultation', type: 'CONSULTATION', leadIdx: 0 },
      { offsetDays: 0, hour: 14, title: 'Document review', type: 'DOCUMENT_REVIEW', leadIdx: 4 },
      { offsetDays: 1, hour: 11, title: 'Visit visa briefing', type: 'CONSULTATION', leadIdx: 6 },
      { offsetDays: 2, hour: 15, title: 'Biometrics walkthrough', type: 'BIOMETRICS', leadIdx: 5 },
      { offsetDays: 3, hour: 12, title: 'IELTS prep meeting', type: 'IN_PERSON', leadIdx: 8 },
      { offsetDays: 5, hour: 16, title: 'Embassy follow-up', type: 'OFFICE_VISIT', leadIdx: 10 },
    ];
    for (const spec of appointmentSpecs) {
      const lead = createdLeads[spec.leadIdx];
      if (!lead) continue;
      const scheduledAt = new Date(today);
      scheduledAt.setDate(scheduledAt.getDate() + spec.offsetDays);
      scheduledAt.setHours(spec.hour, 0, 0, 0);
      const existing = await prisma.appointment.findFirst({
        where: { leadId: lead.id, scheduledAt },
      });
      if (existing) continue;
      await prisma.appointment.create({
        data: {
          leadId: lead.id,
          assignedEmployeeId: lead.assignedEmployeeId,
          createdByUserId: salesUser.id,
          title: spec.title,
          appointmentType: spec.type,
          scheduledAt,
          durationMinutes: 30,
          status: 'SCHEDULED',
        },
      });
    }

    // 5 invoices with verified payments — feeds the revenue rollup on
    // /admin/finance. Amounts vary so the per-service breakdown is meaningful.
    const invoiceSpecs: Array<{ leadIdx: number; amount: number; offsetDays: number }> = [
      { leadIdx: 11, amount: 4500, offsetDays: 2 },
      { leadIdx: 12, amount: 3200, offsetDays: 8 },
      { leadIdx: 13, amount: 6800, offsetDays: 14 },
      { leadIdx: 0,  amount: 2200, offsetDays: 1 },
      { leadIdx: 4,  amount: 5100, offsetDays: 20 },
    ];
    let invoiceCounter = 1000;
    for (const spec of invoiceSpecs) {
      const lead = createdLeads[spec.leadIdx];
      if (!lead) continue;
      invoiceCounter += 1;
      const invoiceNumber = `INV-DEMO-${invoiceCounter}`;
      const existing = await prisma.invoice.findFirst({ where: { invoiceNumber } });
      if (existing) continue;
      const createdAt = new Date(Date.now() - spec.offsetDays * 24 * 60 * 60 * 1000);
      const invoice = await prisma.invoice.create({
        data: {
          leadId: lead.id,
          createdByUserId: salesUser.id,
          invoiceNumber,
          status: 'PAID',
          currency: 'CAD',
          subtotal: spec.amount.toString(),
          taxAmount: '0',
          discountAmount: '0',
          totalAmount: spec.amount.toString(),
          paidAmount: spec.amount.toString(),
          createdAt,
          notes: 'Demo seed invoice for the finance admin views.',
        },
      });
      await prisma.payment.create({
        data: {
          invoiceId: invoice.id,
          amount: spec.amount.toString(),
          currency: 'CAD',
          paymentMethod: 'BANK_TRANSFER',
          transactionRef: `DEMO-PAY-${invoiceCounter}`,
          status: 'PAID',
          verifiedByUserId: salesUser.id,
          verifiedAt: createdAt,
          notes: 'Demo seed payment.',
        },
      });
    }
    console.log(
      `CRM demo data: ${agentEmployees.length} agents, ${createdLeads.length} leads, ${followUpTargets.length} follow-ups, ${appointmentSpecs.length} appointments, ${invoiceSpecs.length} invoices.`,
    );
  }

  console.log('Seed complete');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
