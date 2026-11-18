'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** The Perpl key now lives in Account Settings. Old links (and `?next=`) land there. */
export default function Connect() {
  const router = useRouter();
  useEffect(() => router.replace(`/app/account${location.search}`), [router]);
  return null;
}
