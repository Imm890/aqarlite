import type { Metadata } from 'next';
import { ContractDetail } from './ContractDetail';

export const metadata: Metadata = { title: 'تفاصيل العقد' };

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ContractDetail id={id} />;
}
