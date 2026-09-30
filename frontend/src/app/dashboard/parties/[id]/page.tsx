'use client';

import { useParams } from 'next/navigation';
import PersonDetail from '@/components/PersonDetail';

export default function PartyDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <PersonDetail id={id} kind="party" />;
}
