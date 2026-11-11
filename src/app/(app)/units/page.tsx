import type { Metadata } from 'next';
import { UnitsView } from './UnitsView';

export const metadata: Metadata = { title: 'الوحدات' };

export default function UnitsPage() {
  return <UnitsView />;
}
