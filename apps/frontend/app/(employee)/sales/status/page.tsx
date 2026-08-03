import { WhatsAppStatusAdminPage } from '@/components/admin/WhatsAppStatusAdminPage';

/**
 * Sales-portal Status route. Reuses the admin Status page component with the
 * admin-only sub-nav hidden (its Chats/Calls links point at /admin routes
 * that sales reps don't have access to). The backend allowlist gate
 * (STATUS_FEATURE_EMAILS) is what actually controls who can use it.
 */
export default function SalesWhatsAppStatusRoute() {
  return <WhatsAppStatusAdminPage hideSubNav />;
}
