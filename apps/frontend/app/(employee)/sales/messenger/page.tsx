// The Messenger inbox is the same inbox component as WhatsApp — it detects the
// /sales/messenger route via usePathname() and scopes the whole page (chat list,
// counts, sends) to platform=MESSENGER. Re-export keeps a single source of truth.
export { default } from '../inbox/page';
