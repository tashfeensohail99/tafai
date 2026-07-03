'use client';

import { useReceptionSession } from '@/components/layout/ReceptionShell';
import { ReceptionConsole } from '@/components/reception/ReceptionConsole';

export default function ReceptionHomePage() {
  const { user } = useReceptionSession();
  const canCheckIn = user.permissions.includes('reception.check_in');
  return <ReceptionConsole canCheckIn={canCheckIn} />;
}
