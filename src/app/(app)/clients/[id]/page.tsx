import type { Metadata } from 'next';
import { ClientDetail } from './ClientDetail';

export const metadata: Metadata = { title: 'بيانات العميل' };

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClientDetail id={id} />;
}
