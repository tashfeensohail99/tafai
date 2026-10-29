'use client';

import { useBrand } from '@/lib/runtime-config';

/**
 * The tenant brand as text. Production renders "Tashfeen"; the sales demo
 * renders the demo brand served by the backend's /config, so no shell, login
 * page or portal ever shows the real tenant name.
 */
export function BrandName({ variant = 'word' }: { variant?: 'word' | 'short' | 'full' }) {
  const b = useBrand();
  if (variant === 'full') return <>{b.name}</>;
  if (variant === 'short') return <>{b.shortName}</>;
  return <>{b.word}</>;
}
