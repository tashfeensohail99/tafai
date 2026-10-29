/**
 * Fixed ids for the demo-only rows the seed creates. Known ids let the sync's
 * prune pass protect them (they never exist in production) and let the
 * access-link service map "admin" / "agent" links onto the right account.
 */
export const DEMO_ADMIN_USER_ID = '00000000-0000-4000-8000-0000000d3a01';
export const DEMO_AGENT_USER_ID = '00000000-0000-4000-8000-0000000d3a02';
export const DEMO_ADMIN_EMPLOYEE_ID = '00000000-0000-4000-8000-0000000d3e01';
export const DEMO_AGENT_EMPLOYEE_ID = '00000000-0000-4000-8000-0000000d3e02';

export const DEMO_PROTECTED_USER_IDS = [DEMO_ADMIN_USER_ID, DEMO_AGENT_USER_ID];

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
