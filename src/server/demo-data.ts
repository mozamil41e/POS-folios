import crypto from 'node:crypto';
import type { InvoiceItem } from '../types.ts';
import { db, getAllCustomers, getAllProducts } from './db.ts';
import { nextDocumentNumber } from './sequences.ts';

/**
 * Demo data for local development and the automated tests only (R1.7, H4).
 * Production starts empty: initDatabase() never calls this. Run it on an empty
 * development database with `npm run seed:dev`. Names are fictional; amounts
 * and ids are fixed because the tests rely on them (tests/helpers/app.ts SEED).
 * Restaurant-style demo data comes with the recipe inventory (R5).
 */

/** Tables that hold the restaurant's own records. Roles, settings and users are not demo data. */
const BUSINESS_TABLES = [
  'products',
  'stock_movements',
  'customers',
  'suppliers',
  'purchases',
  'invoices',
  'vouchers',
  'held_carts',
] as const;

export function hasBusinessData(): boolean {
  return BUSINESS_TABLES.some(
    (table) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n > 0
  );
}

/**
 * Fills an empty database with the demo workspace in one transaction.
 * Returns false (and changes nothing) when any business data already exists.
 * Throws in production so demo records can never reach a real restaurant.
 */
export function seedDemoData(): boolean {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DEMO_DATA_IN_PRODUCTION');
  }
  if (hasBusinessData()) return false;
  db.transaction(() => {
    seedDemoSettings();
    seedDemoProducts();
    seedDemoCustomers();
    seedInitialInvoices();
    seedInitialSuppliersAndPurchases();
    seedInitialVouchers();
  })();
  return true;
}

/** Only replaces the neutral defaults, never values someone has already entered. */
function seedDemoSettings(): void {
  db.prepare(`
    UPDATE organization_settings
    SET name_ar = ?, name_en = ?, vat_number = ?, cr_number = ?, street_ar = ?, building_no = ?,
        city_ar = ?, postal_code = ?
    WHERE id = 1 AND vat_number = ''
  `).run(
    'مطعم ميزان التجريبي',
    'Mizan Demo Restaurant',
    '300000000000003',
    '1010648291',
    'طريق تجريبي - حي تجريبي',
    '4218',
    'الرياض',
    '12214'
  );
}

function seedDemoProducts(): void {
  const now = new Date().toISOString();
  const seedProducts = [
    ['6281007001014', 'حليب طازج كامل الدسم 2 لتر', 'Fresh Whole Milk 2L', 'الألبان والمشروبات', 'Dairy & Beverages', 'عبوة', 'Bottle', 9.5, 11.74, 15, 'S', 64, 15, '2026-12-05'],
    ['6281007002028', 'أرز بسمتي هندي فاخر 5 كجم', 'Premium Basmati Rice 5kg', 'المواد الغذائية', 'Groceries', 'كيس', 'Bag', 36.0, 42.61, 15, 'S', 32, 10, '2027-08-15'],
    ['6281007003035', 'زيت زيتون بكر ممتاز 500 مل', 'Extra Virgin Olive Oil 500ml', 'الزيوت والتوابل', 'Oils & Spices', 'زجاجة', 'Bottle', 24.0, 30.43, 15, 'S', 18, 8, '2027-05-20'],
    ['6281007004042', 'تمور خضري ملكي فاخر 1 كجم', 'Royal Khudri Dates 1kg', 'التمور والمكسرات', 'Dates & Nuts', 'علبة', 'Box', 18.0, 24.35, 15, 'S', 27, 10, '2027-03-01'],
    ['6281007005059', 'قهوة عربية شقراء بالهيل 500 جم', 'Saudi Arabic Coffee Cardamom 500g', 'القهوة والشاي', 'Coffee & Tea', 'عبوة', 'Pack', 22.0, 29.57, 15, 'S', 9, 12, '2027-06-30'],
    ['6281007006066', 'مياه شرب نقية 24 × 330 مل', 'Pure Drinking Water 24x330ml', 'الألبان والمشروبات', 'Dairy & Beverages', 'كرتون', 'Carton', 10.5, 13.91, 15, 'S', 95, 20, '2027-11-10'],
    ['6281007007073', 'خبز توست أبيض شرائح', 'White Sliced Toast Bread', 'المخبوزات', 'Bakery', 'كيس', 'Pack', 3.5, 4.78, 15, 'S', 14, 15, '2026-11-28'],
    ['6281007008080', 'لبن طازج قليل الدسم 1 لتر', 'Fresh Low-Fat Laban 1L', 'الألبان والمشروبات', 'Dairy & Beverages', 'عبوة', 'Bottle', 5.2, 6.96, 15, 'S', 42, 12, '2026-12-03'],
    ['6281007009097', 'زبادي طازج عائلي 1 كجم', 'Family Fresh Yogurt 1kg', 'الألبان والمشروبات', 'Dairy & Beverages', 'عبوة', 'Tub', 6.8, 8.70, 15, 'S', 7, 10, '2026-12-02'],
    ['6281007010109', 'مسحوق غسيل أوتوماتيك 2.5 كجم', 'Automatic Laundry Detergent 2.5kg', 'المنظفات والعناية', 'Home Care', 'كيس', 'Bag', 25.0, 33.91, 15, 'S', 21, 8, null],
    ['6281007011116', 'معجون طماطم مركز 8 × 135 جم', 'Concentrated Tomato Paste 8x135g', 'المواد الغذائية', 'Groceries', 'شدة', 'Pack', 11.0, 14.78, 15, 'S', 48, 12, '2027-09-12'],
    ['6281007012123', 'طحينة سمسم نقية 500 جم', 'Pure Sesame Tahina 500g', 'المواد الغذائية', 'Groceries', 'برطمان', 'Jar', 14.5, 19.13, 15, 'S', 16, 8, '2027-04-18'],
    ['6281007013130', 'شاي أحمر خيط 100 كيس', 'Black Tea Bags 100ct', 'القهوة والشاي', 'Coffee & Tea', 'علبة', 'Box', 13.0, 16.52, 15, 'S', 35, 10, '2028-01-10'],
    ['6281007014147', 'عصير برتقال طبيعي طازج 1.5 لتر', 'Fresh Orange Juice 1.5L', 'الألبان والمشروبات', 'Dairy & Beverages', 'عبوة', 'Bottle', 8.0, 10.43, 15, 'S', 0, 10, '2026-11-30'],
  ] as const;

  const insertProduct = db.prepare(`
    INSERT INTO products (
      sku, name_ar, name_en, category_ar, category_en, unit_ar, unit_en,
      cost_price, sell_price, tax_rate, tax_category, stock_qty, min_stock_alert,
      expiry_date, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);

  const insertMove = db.prepare(`
    INSERT INTO stock_movements (product_id, type, qty_delta, balance_after, reference_no, notes, created_at)
    VALUES (?, 'purchase', ?, ?, 'INIT-OPENING', 'رصيد افتتاحي للمخزون', ?)
  `);

  for (const p of seedProducts) {
    const info = insertProduct.run(...p, now, now);
    insertMove.run(info.lastInsertRowid, p[11], p[11], now);
  }
}

function seedDemoCustomers(): void {
  const now = new Date().toISOString();
  const insertCust = db.prepare(`
    INSERT INTO customers (name_ar, name_en, vat_number, cr_number, address_ar, phone, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertCust.run(
    'شركة الضيافة التجريبية',
    'Demo Hospitality Co.',
    '300000000000013',
    '1010554321',
    'الرياض - حي الملقا',
    '0551234567',
    now
  );
  insertCust.run(
    'مؤسسة تجارية تجريبية',
    'Demo Trading Est.',
    '300000000000023',
    '4030228811',
    'جدة - حي الروضة',
    '0509876543',
    now
  );
  insertCust.run(
    'مخبز تجريبي',
    'Demo Bakery',
    '300000000000033',
    '2050119933',
    'الدمام - حي الشاطئ',
    '0543219876',
    now
  );
}

function seedInitialVouchers(): void {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const yesterdayStr = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const created = now.toISOString();

  const insert = db.prepare(`
    INSERT INTO vouchers (
      voucher_number, voucher_type, payment_channel, party_name, category,
      amount, notes, voucher_date, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(
    nextDocumentNumber(db, 'RCV'),
    'receipt',
    'cash',
    'عهدة الصندوق الافتتاحية',
    'تغذية درج الكاشير',
    1000,
    'رصيد افتتاحي نقدي لدرج نقطة البيع',
    yesterdayStr,
    created
  );
  insert.run(
    nextDocumentNumber(db, 'PAY'),
    'payment',
    'cash',
    'مزوّد خدمات الكهرباء',
    'مصروفات تشغيلية',
    280,
    'فاتورة خدمات ومستلزمات تغليف',
    todayStr,
    created
  );
  insert.run(
    nextDocumentNumber(db, 'PAY'),
    'payment',
    'bank',
    'خدمة توصيل تجريبية',
    'نقل وشحن',
    150,
    'تكلفة توصيل طلبات عملاء',
    todayStr,
    created
  );
}

function seedInitialInvoices(): void {
  const products = getAllProducts();
  const customers = getAllCustomers();

  const samples = [
    {
      offsetMinutes: 145,
      subtype: '0200000' as const,
      payment: 'card' as const,
      customer: null,
      lines: [
        { product: products[0], qty: 2 },
        { product: products[5], qty: 1 },
        { product: products[6], qty: 2 },
      ],
    },
    {
      offsetMinutes: 65,
      subtype: '0100000' as const,
      payment: 'card' as const,
      customer: customers[0],
      lines: [
        { product: products[1], qty: 4 },
        { product: products[2], qty: 3 },
        { product: products[10], qty: 5 },
      ],
    },
    {
      offsetMinutes: 18,
      subtype: '0200000' as const,
      payment: 'cash' as const,
      customer: null,
      lines: [
        { product: products[3], qty: 1 },
        { product: products[4], qty: 1 },
        { product: products[12], qty: 2 },
      ],
    },
  ];

  for (const s of samples) {
    const uuid = crypto.randomUUID();
    const createdAtDate = new Date(Date.now() - s.offsetMinutes * 60_000);
    const createdAt = createdAtDate.toISOString();
    const invoiceNumber = nextDocumentNumber(db, 'INV');

    const items: InvoiceItem[] = s.lines.map((l) => {
      const lineSub = Number((l.product.sell_price * l.qty).toFixed(2));
      const lineVat = Number((lineSub * (l.product.tax_rate / 100)).toFixed(2));
      const lineTotal = Number((lineSub + lineVat).toFixed(2));
      return {
        product_id: l.product.id,
        sku: l.product.sku,
        name_ar: l.product.name_ar,
        name_en: l.product.name_en,
        unit_ar: l.product.unit_ar,
        qty: l.qty,
        unit_price: l.product.sell_price,
        discount: 0,
        tax_rate: l.product.tax_rate,
        tax_category: l.product.tax_category,
        line_subtotal: lineSub,
        line_vat: lineVat,
        line_total: lineTotal,
      };
    });

    const subtotal = Number(items.reduce((a, b) => a + b.line_subtotal, 0).toFixed(2));
    const vatTotal = Number(items.reduce((a, b) => a + b.line_vat, 0).toFixed(2));
    const grandTotal = Number((subtotal + vatTotal).toFixed(2));

    const customerName = s.customer ? s.customer.name_ar : 'عميل نقدي / Cash Customer';
    const customerVat = s.customer ? s.customer.vat_number : '';

    const invInfo = db
      .prepare(`
        INSERT INTO invoices (
          uuid, invoice_number, invoice_type_code, invoice_subtype,
          payment_method, cash_amount, card_amount, customer_id, customer_name, customer_vat,
          subtotal, discount_total, vat_total, grand_total, related_invoice_number, created_at
        ) VALUES (?, ?, '388', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?)
      `)
      .run(
        uuid,
        invoiceNumber,
        s.subtype,
        s.payment,
        s.payment === 'cash' ? grandTotal : 0,
        s.payment === 'card' ? grandTotal : 0,
        s.customer?.id ?? null,
        customerName,
        customerVat,
        subtotal,
        vatTotal,
        grandTotal,
        createdAt
      );

    const insertItem = db.prepare(`
      INSERT INTO invoice_items (
        invoice_id, product_id, sku, name_ar, name_en, unit_ar,
        qty, unit_price, discount, tax_rate, tax_category,
        line_subtotal, line_vat, line_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
    `);

    for (const item of items) {
      insertItem.run(
        invInfo.lastInsertRowid,
        item.product_id,
        item.sku,
        item.name_ar,
        item.name_en,
        item.unit_ar,
        item.qty,
        item.unit_price,
        item.tax_rate,
        item.tax_category,
        item.line_subtotal,
        item.line_vat,
        item.line_total
      );
    }

  }
}

function seedInitialSuppliersAndPurchases(): void {
  const now = new Date().toISOString();
  const insertSup = db.prepare(`
    INSERT INTO suppliers (name_ar, name_en, vat_number, cr_number, phone, email, address_ar, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const sup1 = insertSup.run(
    'مورّد الألبان التجريبي',
    'Demo Dairy Supplier',
    '300000000000103',
    '1010084221',
    '0114700005',
    'dairy@supplier.example',
    'الرياض - المدينة الصناعية الثانية',
    now
  );
  const sup2 = insertSup.run(
    'مورّد المواد الغذائية التجريبي',
    'Demo Grocery Supplier',
    '300000000000203',
    '4030118944',
    '0503349911',
    'grocery@supplier.example',
    'جدة - طريق الملك عبدالعزيز',
    now
  );
  insertSup.run(
    'مورّد المنتجات الزراعية التجريبي',
    'Demo Farm Produce Supplier',
    '300000000000303',
    '3400005112',
    '0558812200',
    'farm@supplier.example',
    'سكاكا',
    now
  );

  const products = getAllProducts();
  if (products.length >= 4) {
    const p1Date = new Date(Date.now() - 86_400_000 * 2).toISOString();
    const p1Items = [
      { prod: products[0], qty: 24, cost: products[0].cost_price ?? 0 },
      { prod: products[7], qty: 18, cost: products[7].cost_price ?? 0 },
    ];
    const p1Sub = Number(p1Items.reduce((s, i) => s + i.qty * i.cost, 0).toFixed(2));
    const p1Vat = Number((p1Sub * 0.15).toFixed(2));
    const p1Grand = Number((p1Sub + p1Vat).toFixed(2));

    const po1 = db
      .prepare(`
        INSERT INTO purchases (
          purchase_number, supplier_id, supplier_name, supplier_vat, supplier_invoice_no,
          payment_status, paid_amount, subtotal, vat_total, grand_total, notes, received_at, created_at
        ) VALUES (?, ?, 'مورّد الألبان التجريبي', '300000000000103', 'SUP-INV-9921', 'paid', ?, ?, ?, ?, 'توريد ألبان أسبوعي', ?, ?)
      `)
      .run(nextDocumentNumber(db, 'PO'), sup1.lastInsertRowid, p1Grand, p1Sub, p1Vat, p1Grand, p1Date, p1Date);

    const insertPoItem = db.prepare(`
      INSERT INTO purchase_items (
        purchase_id, product_id, sku, name_ar, name_en, qty, unit_cost, tax_rate,
        line_subtotal, line_vat, line_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of p1Items) {
      const lSub = Number((item.qty * item.cost).toFixed(2));
      const lVat = Number((lSub * 0.15).toFixed(2));
      insertPoItem.run(
        po1.lastInsertRowid,
        item.prod.id,
        item.prod.sku,
        item.prod.name_ar,
        item.prod.name_en,
        item.qty,
        item.cost,
        15,
        lSub,
        lVat,
        Number((lSub + lVat).toFixed(2))
      );
    }

    const p2Date = new Date(Date.now() - 86_400_000).toISOString();
    const p2Items = [
      { prod: products[1], qty: 20, cost: products[1].cost_price ?? 0 },
      { prod: products[10], qty: 30, cost: products[10].cost_price ?? 0 },
    ];
    const p2Sub = Number(p2Items.reduce((s, i) => s + i.qty * i.cost, 0).toFixed(2));
    const p2Vat = Number((p2Sub * 0.15).toFixed(2));
    const p2Grand = Number((p2Sub + p2Vat).toFixed(2));

    const po2 = db
      .prepare(`
        INSERT INTO purchases (
          purchase_number, supplier_id, supplier_name, supplier_vat, supplier_invoice_no,
          payment_status, paid_amount, subtotal, vat_total, grand_total, notes, received_at, created_at
        ) VALUES (?, ?, 'مورّد المواد الغذائية التجريبي', '300000000000203', 'DEMO-441', 'credit', 0, ?, ?, ?, 'فاتورة مشتريات آجلة لمدة 30 يوماً', ?, ?)
      `)
      .run(nextDocumentNumber(db, 'PO'), sup2.lastInsertRowid, p2Sub, p2Vat, p2Grand, p2Date, p2Date);

    for (const item of p2Items) {
      const lSub = Number((item.qty * item.cost).toFixed(2));
      const lVat = Number((lSub * 0.15).toFixed(2));
      insertPoItem.run(
        po2.lastInsertRowid,
        item.prod.id,
        item.prod.sku,
        item.prod.name_ar,
        item.prod.name_en,
        item.qty,
        item.cost,
        15,
        lSub,
        lVat,
        Number((lSub + lVat).toFixed(2))
      );
    }
  }
}
