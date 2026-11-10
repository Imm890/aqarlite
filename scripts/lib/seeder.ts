import { Client } from 'pg';
import { hashPassword } from '../../src/server/auth/password';

export interface SeedAccount {
  company: string;
  role: 'company_admin' | 'accountant' | 'sales_rep';
  email: string;
}

/** معرّفات ثابتة تجعل الـ seed قابلاً للتكرار (idempotent) ويسهّل كتابة الاختبارات. */
export const seedId = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

interface CompanySeed {
  key: 'ofuq' | 'nokhba';
  idNum: number;
  name: string;
  currency: string;
  timezone: string;
  phonePrefix: string;
  projects: [string, string];
}

const COMPANIES: CompanySeed[] = [
  {
    key: 'ofuq',
    idNum: 1,
    name: 'شركة الأفق العقارية',
    currency: 'SAR',
    timezone: 'Asia/Riyadh',
    phonePrefix: '+96655',
    projects: ['برج الأفق', 'مجمع الواحة السكني'],
  },
  {
    key: 'nokhba',
    idNum: 2,
    name: 'شركة النخبة للوساطة',
    currency: 'AED',
    timezone: 'Asia/Dubai',
    phonePrefix: '+97150',
    projects: ['أبراج النخبة', 'ريزيدنس الخليج'],
  },
];

const UNIT_TYPES = ['apartment', 'apartment', 'duplex', 'villa', 'townhouse', 'office', 'shop'] as const;
const CLIENT_NAMES = [
  'أحمد العتيبي',
  'سارة القحطاني',
  'محمد الشمري',
  'نورة الدوسري',
  'خالد المطيري',
  'ليلى الحربي',
];

export async function seed(adminUrl: string, password: string): Promise<SeedAccount[]> {
  const accounts: SeedAccount[] = [];
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    for (const c of COMPANIES) {
      const companyId = seedId(c.idNum);
      await client.query(
        `INSERT INTO companies (id, name, currency_code, timezone) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [companyId, c.name, c.currency, c.timezone],
      );

      const users = [
        { n: 0x11, role: 'company_admin', local: 'admin', name: 'مدير الشركة' },
        { n: 0x12, role: 'accountant', local: 'accountant', name: 'المحاسب' },
        { n: 0x13, role: 'sales_rep', local: 'rep1', name: 'مندوب المبيعات الأول' },
        { n: 0x14, role: 'sales_rep', local: 'rep2', name: 'مندوب المبيعات الثاني' },
      ] as const;
      const repIds: string[] = [];
      for (const u of users) {
        const id = seedId(c.idNum * 0x100 + u.n);
        const email = `${u.local}@${c.key}.example`;
        await client.query(
          `INSERT INTO users (id, company_id, email, name, role, password_hash)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
          [id, companyId, email, u.name, u.role, await hashPassword(password)],
        );
        accounts.push({ company: c.name, role: u.role, email });
        if (u.role === 'sales_rep') repIds.push(id);
      }
      const adminId = seedId(c.idNum * 0x100 + 0x11);

      // 12 وحدة متنوعة (الأسعار بالهللات: المساحة × 5000 لكل م²)
      for (let i = 1; i <= 12; i += 1) {
        const project = i <= 6 ? c.projects[0] : c.projects[1];
        const areaTimes100 = 7_000 + i * 850; // 70.00 م² + 8.5 م² لكل وحدة
        const priceCents = areaTimes100 * 5_000;
        await client.query(
          `INSERT INTO units (company_id, project, number, type, area_sqm, rooms, price_cents, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (company_id, project, number) DO NOTHING`,
          [
            companyId,
            project,
            String(100 + i),
            UNIT_TYPES[i % UNIT_TYPES.length],
            (areaTimes100 / 100).toFixed(2),
            1 + (i % 5),
            priceCents,
            adminId,
          ],
        );
      }

      // 3 عملاء لكل مندوب
      let k = 0;
      for (const [repIndex, repId] of repIds.entries()) {
        for (let j = 0; j < 3; j += 1) {
          k += 1;
          await client.query(
            `INSERT INTO clients (id, company_id, owner_id, name, phone, notes)
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
            [
              seedId(c.idNum * 0x1000 + 0x100 + k),
              companyId,
              repId,
              CLIENT_NAMES[(repIndex * 3 + j) % CLIENT_NAMES.length],
              `${c.phonePrefix}${String(1_000_000 + k * 1111).slice(-7)}`,
              j === 0 ? 'يفضّل التواصل مساءً. مهتم بوحدات الأدوار العليا.' : '',
            ],
          );
        }
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
  return accounts;
}
