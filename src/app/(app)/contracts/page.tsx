import type { Metadata } from 'next';
import { ContractsView } from './ContractsView';

export const metadata: Metadata = { title: 'العقود' };

export default function ContractsPage() {
  return <ContractsView />;
}
