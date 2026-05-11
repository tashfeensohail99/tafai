import { redirect } from 'next/navigation';

// /portal → redirect to case overview
export default function PortalPage() {
  redirect('/portal/case');
}
