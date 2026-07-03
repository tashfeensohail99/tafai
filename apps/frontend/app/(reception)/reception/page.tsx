'use client';

import { useReceptionSession } from '@/components/layout/ReceptionShell';
import { FrontDesk } from '@/components/reception/FrontDesk';

export default function ReceptionHomePage() {
  const { user } = useReceptionSession();
  const canCheckIn = user.permissions.includes('reception.check_in');
  return <FrontDesk canCheckIn={canCheckIn} />;
}
