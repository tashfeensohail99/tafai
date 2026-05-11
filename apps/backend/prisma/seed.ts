import {
  FinanceHandoverStatus,
  FollowUpPriority,
  FollowUpStatus,
  LeadStatus,
  PrismaClient,
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
    name: 'sales',
    displayName: 'Sales',
    description: 'Lead and client management',
    permissionKeys: [
      'leads.view_assigned', 'leads.create', 'leads.update', 'leads.assign',
      'follow_ups.view_assigned', 'follow_ups.create', 'follow_ups.update', 'follow_ups.complete',
      'finance_handover.view_own', 'finance_handover.create', 'finance_handover.update_own',
      'clients.view_assigned', 'clients.create', 'clients.update',
      'appointments.view_assigned', 'appointments.create', 'appointments.update',
      'communications.view', 'communications.send',
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
    ],
  },
  {
    name: 'processing',
    displayName: 'Processing',
    description: 'Case processing and submission',
    permissionKeys: [
      'clients.view_assigned', 'cases.view_assigned', 'cases.update', 'cases.change_status',
      'documents.view_assigned', 'documents.upload',
      'appointments.view_assigned',
      'communications.view',
    ],
  },
  {
    name: 'finance',
    displayName: 'Finance',
    description: 'Finance and payment management',
    permissionKeys: [
      'clients.view_assigned',
      'finance_handover.view_all', 'finance_handover.review',
      'finance.view_all', 'finance.create_invoice', 'finance.record_payment',
      'finance.verify_payment', 'finance.refund',
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
