import { redirect } from 'next/navigation';

// Root redirect — in production this would check for an auth cookie and
// redirect to the appropriate portal. For now, send to login.
export default function RootPage() {
  redirect('/login');
}
