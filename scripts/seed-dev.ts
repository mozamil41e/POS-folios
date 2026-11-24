// Loads the demo workspace into an EMPTY development database (R1.7, H4).
//
//   npm run seed:dev
//
// Production always starts empty and never runs this: the script refuses when
// NODE_ENV=production, and on any database that already holds business data
// (products, invoices, customers, ...). It uses the same database as the
// server: MIZAN_DB_PATH, or ./data/mizan-pos.db.
if (process.env.NODE_ENV === 'production') {
  console.error('seed:dev: refusing to load demo data with NODE_ENV=production.');
  process.exit(1);
}

// Imported only after the check: opening db.ts creates the database file.
const { db, initDatabase } = await import('../src/server/db.ts');
const { seedDemoData } = await import('../src/server/demo-data.ts');

initDatabase();
const seeded = seedDemoData();
db.close();

if (!seeded) {
  console.error('seed:dev: this database already has business data; nothing was added.');
  process.exit(1);
}
console.log('seed:dev: demo data loaded (products, customers, suppliers, purchases, invoices, vouchers).');
