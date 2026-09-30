'use client';

import { useParams } from 'next/navigation';
import PersonDetail from '@/components/PersonDetail';

export default function WorkerDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <PersonDetail id={id} kind="worker" />;
}
