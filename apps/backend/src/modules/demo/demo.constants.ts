/**
 * Fixed ids for the demo-only rows the seed creates. Known ids let the sync's
 * prune pass protect them (they never exist in production) and let the
 * access-link service map "admin" / "agent" links onto the right account.
 */
export const DEMO_ADMIN_USER_ID = '00000000-0000-4000-8000-0000000d3a01';
export const DEMO_AGENT_USER_ID = '00000000-0000-4000-8000-0000000d3a02';
export const DEMO_ADMIN_EMPLOYEE_ID = '00000000-0000-4000-8000-0000000d3e01';
export const DEMO_AGENT_EMPLOYEE_ID = '00000000-0000-4000-8000-0000000d3e02';

/**
 * One demo login per role so a prospect can see every workspace. Ids are fixed
 * (protected from pruning); emails are `<local>@<DEMO_LOGIN_DOMAIN>`; the
 * password is DEMO_<KEY>_PASSWORD or, when unset, `Summit-<Label>-2026!`.
 */
export interface DemoAccountSpec {
  key: string;
  userId: string;
  employeeId: string;
  emailLocal: string;
  role: string;
  firstName: string;
  lastName: string;
  /** Joins the WhatsApp round-robin pool. */
  inbox: boolean;
  /** Department name to attach (matched case-insensitively), if it exists. */
  department: string | null;
  defaultPassword: string;
}

const uid = (n: string) => `00000000-0000-4000-8000-0000000d3a${n}`;
const eid = (n: string) => `00000000-0000-4000-8000-0000000d3e${n}`;

export const DEMO_ACCOUNTS: DemoAccountSpec[] = [
  { key: 'ADMIN', userId: DEMO_ADMIN_USER_ID, employeeId: DEMO_ADMIN_EMPLOYEE_ID, emailLocal: 'demo.admin', role: 'super_admin', firstName: 'Demo', lastName: 'Admin', inbox: true, department: 'Sales', defaultPassword: 'Summit-Demo-2026!' },
  { key: 'AGENT', userId: DEMO_AGENT_USER_ID, employeeId: DEMO_AGENT_EMPLOYEE_ID, emailLocal: 'demo.agent', role: 'sales', firstName: 'Demo', lastName: 'Agent', inbox: true, department: 'Sales', defaultPassword: 'Summit-Agent-2026!' },
  { key: 'MANAGER', userId: uid('03'), employeeId: eid('03'), emailLocal: 'demo.manager', role: 'admin', firstName: 'Demo', lastName: 'Manager', inbox: true, department: 'Sales', defaultPassword: 'Summit-Manager-2026!' },
  { key: 'FINANCE', userId: uid('04'), employeeId: eid('04'), emailLocal: 'demo.finance', role: 'finance', firstName: 'Demo', lastName: 'Finance', inbox: false, department: 'Finance', defaultPassword: 'Summit-Finance-2026!' },
  { key: 'PROCESSING', userId: uid('05'), employeeId: eid('05'), emailLocal: 'demo.processing', role: 'processing', firstName: 'Demo', lastName: 'Processing', inbox: false, department: 'Processing', defaultPassword: 'Summit-Processing-2026!' },
  { key: 'PROCESSING_MANAGER', userId: uid('06'), employeeId: eid('06'), emailLocal: 'demo.processing.manager', role: 'processing_manager', firstName: 'Demo', lastName: 'Processing Manager', inbox: false, department: 'Processing', defaultPassword: 'Summit-ProcessingManager-2026!' },
  { key: 'RECEPTION', userId: uid('07'), employeeId: eid('07'), emailLocal: 'demo.reception', role: 'reception', firstName: 'Demo', lastName: 'Reception', inbox: false, department: null, defaultPassword: 'Summit-Reception-2026!' },
  { key: 'MARKETING', userId: uid('08'), employeeId: eid('08'), emailLocal: 'demo.marketing', role: 'marketing', firstName: 'Demo', lastName: 'Marketing', inbox: false, department: 'Marketing', defaultPassword: 'Summit-Marketing-2026!' },
  { key: 'HR', userId: uid('09'), employeeId: eid('09'), emailLocal: 'demo.hr', role: 'hr', firstName: 'Demo', lastName: 'HR', inbox: false, department: 'HR', defaultPassword: 'Summit-HR-2026!' },
  { key: 'JR', userId: uid('0a'), employeeId: eid('0a'), emailLocal: 'demo.jr', role: 'jr_head', firstName: 'Demo', lastName: 'Legal', inbox: false, department: 'Legal', defaultPassword: 'Summit-Legal-2026!' },
  { key: 'DOCUMENTATION', userId: uid('0b'), employeeId: eid('0b'), emailLocal: 'demo.documentation', role: 'documentation', firstName: 'Demo', lastName: 'Documentation', inbox: false, department: 'Processing', defaultPassword: 'Summit-Documentation-2026!' },
];

export const DEMO_PROTECTED_USER_IDS = DEMO_ACCOUNTS.map((a) => a.userId);

export function demoLoginDomain(env: NodeJS.ProcessEnv = process.env): string {
  return env.DEMO_LOGIN_DOMAIN?.trim() || 'summit-demo.example';
}

export function demoAdminEmail(env: NodeJS.ProcessEnv = process.env): string {
  return `demo.admin@${demoLoginDomain(env)}`;
}

export function demoAgentEmail(env: NodeJS.ProcessEnv = process.env): string {
  return `demo.agent@${demoLoginDomain(env)}`;
}

/** Extra protected user ids from env (comma separated), merged with the fixed ones. */
export function protectedUserIds(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = String(env.DEMO_PROTECTED_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...DEMO_PROTECTED_USER_IDS, ...extra])];
}
