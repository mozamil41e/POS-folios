import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type {
  AuthUser,
  Customer,
  HeldCart,
  Invoice,
  InvoiceItem,
  OrganizationSettings,
  Product,
  Purchase,
  PurchaseItem,
  StockMovement,
  Supplier,
  UserRole,
} from '../types.ts';
import {
  GENESIS_PIH,
  buildUbl21Xml,
  generateEgsKeyPair,
  signXmlAndBuildQr,
} from './zatca.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'mizan-pos.db');
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS organization_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      vat_number TEXT NOT NULL,
      cr_number TEXT NOT NULL,
      street_ar TEXT NOT NULL,
      building_no TEXT NOT NULL,
      city_ar TEXT NOT NULL,
      postal_code TEXT NOT NULL,
      country_code TEXT NOT NULL DEFAULT 'SA',
      egs_serial TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'simulator',
      zatca_enabled INTEGER NOT NULL DEFAULT 0,
      public_base_url TEXT NOT NULL DEFAULT '',
      thermal_width_mm INTEGER NOT NULL DEFAULT 80,
      auto_print_receipt INTEGER NOT NULL DEFAULT 0,
      font_size TEXT NOT NULL DEFAULT 'medium',
      ccsid_token TEXT NOT NULL DEFAULT '',
      ccsid_secret TEXT NOT NULL DEFAULT '',
      ccsid_request_id TEXT NOT NULL DEFAULT '',
      pcsid_token TEXT NOT NULL DEFAULT '',
      pcsid_secret TEXT NOT NULL DEFAULT '',
      private_key_pem TEXT NOT NULL DEFAULT '',
      public_key_base64 TEXT NOT NULL DEFAULT '',
      csr_pem TEXT NOT NULL DEFAULT '',
      onboarding_step INTEGER NOT NULL DEFAULT 1,
      last_icv INTEGER NOT NULL DEFAULT 0,
      last_pih TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL UNIQUE,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      category_ar TEXT NOT NULL,
      category_en TEXT NOT NULL,
      unit_ar TEXT NOT NULL,
      unit_en TEXT NOT NULL,
      cost_price REAL NOT NULL,
      sell_price REAL NOT NULL,
      tax_rate REAL NOT NULL DEFAULT 15,
      tax_category TEXT NOT NULL DEFAULT 'S',
      stock_qty INTEGER NOT NULL DEFAULT 0,
      min_stock_alert INTEGER NOT NULL DEFAULT 10,
      expiry_date TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      qty_delta INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      reference_no TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      vat_number TEXT NOT NULL DEFAULT '',
      cr_number TEXT NOT NULL DEFAULT '',
      address_ar TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      invoice_number TEXT NOT NULL UNIQUE,
      icv INTEGER NOT NULL UNIQUE,
      invoice_type_code TEXT NOT NULL DEFAULT '388',
      invoice_subtype TEXT NOT NULL DEFAULT '0200000',
      payment_method TEXT NOT NULL DEFAULT 'cash',
      cash_amount REAL NOT NULL DEFAULT 0,
      card_amount REAL NOT NULL DEFAULT 0,
      customer_id INTEGER,
      customer_name TEXT NOT NULL DEFAULT '',
      customer_vat TEXT NOT NULL DEFAULT '',
      subtotal REAL NOT NULL,
      discount_total REAL NOT NULL DEFAULT 0,
      vat_total REAL NOT NULL,
      grand_total REAL NOT NULL,
      invoice_hash TEXT NOT NULL,
      previous_hash TEXT NOT NULL,
      qr_tlv_base64 TEXT NOT NULL,
      xml_content TEXT NOT NULL,
      zatca_status TEXT NOT NULL,
      zatca_mode TEXT NOT NULL,
      zatca_response_json TEXT NOT NULL,
      related_invoice_number TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      sku TEXT NOT NULL,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      unit_ar TEXT NOT NULL,
      qty INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      discount REAL NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL,
      tax_category TEXT NOT NULL DEFAULT 'S',
      line_subtotal REAL NOT NULL,
      line_vat REAL NOT NULL,
      line_total REAL NOT NULL,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS held_carts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      items_json TEXT NOT NULL,
      discount REAL NOT NULL DEFAULT 0,
      customer_id INTEGER,
      invoice_subtype TEXT NOT NULL DEFAULT '0200000',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      vat_number TEXT NOT NULL DEFAULT '',
      cr_number TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      address_ar TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_number TEXT NOT NULL UNIQUE,
      supplier_id INTEGER NOT NULL,
      supplier_name TEXT NOT NULL,
      supplier_vat TEXT NOT NULL DEFAULT '',
      supplier_invoice_no TEXT NOT NULL DEFAULT '',
      payment_status TEXT NOT NULL DEFAULT 'paid',
      paid_amount REAL NOT NULL DEFAULT 0,
      subtotal REAL NOT NULL,
      vat_total REAL NOT NULL,
      grand_total REAL NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      received_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      sku TEXT NOT NULL,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      qty INTEGER NOT NULL,
      unit_cost REAL NOT NULL,
      tax_rate REAL NOT NULL DEFAULT 15,
      line_subtotal REAL NOT NULL,
      line_vat REAL NOT NULL,
      line_total REAL NOT NULL,
      FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'cashier',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  const orgCols = db
    .prepare('PRAGMA table_info(organization_settings)')
    .all() as Array<{ name: string }>;
  const colNames = new Set(orgCols.map((c) => c.name));

  if (!colNames.has('zatca_enabled')) {
    db.exec('ALTER TABLE organization_settings ADD COLUMN zatca_enabled INTEGER NOT NULL DEFAULT 0');
  }
  if (!colNames.has('public_base_url')) {
    db.exec("ALTER TABLE organization_settings ADD COLUMN public_base_url TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.has('thermal_width_mm')) {
    db.exec('ALTER TABLE organization_settings ADD COLUMN thermal_width_mm INTEGER NOT NULL DEFAULT 80');
  }
  if (!colNames.has('auto_print_receipt')) {
    db.exec('ALTER TABLE organization_settings ADD COLUMN auto_print_receipt INTEGER NOT NULL DEFAULT 0');
  }
  if (!colNames.has('font_size')) {
    db.exec("ALTER TABLE organization_settings ADD COLUMN font_size TEXT NOT NULL DEFAULT 'medium'");
  }

  const existingOrg = db
    .prepare('SELECT id FROM organization_settings WHERE id = 1')
    .get();

  if (!existingOrg) {
    const defaultOrgMeta = {
      name_en: 'Al-Mizan Modern Retail Mart',
      vat_number: '310122393500003',
      egs_serial: '1-MZN|2-POS01|3-9f8a12b4',
      city_ar: 'الرياض',
    };
    const keys = generateEgsKeyPair(defaultOrgMeta);

    db.prepare(`
      INSERT INTO organization_settings (
        id, name_ar, name_en, vat_number, cr_number, street_ar, building_no,
        city_ar, postal_code, country_code, egs_serial, mode,
        zatca_enabled, public_base_url, thermal_width_mm, auto_print_receipt, font_size,
        ccsid_token, ccsid_secret, ccsid_request_id,
        pcsid_token, pcsid_secret,
        private_key_pem, public_key_base64, csr_pem,
        onboarding_step, last_icv, last_pih
      ) VALUES (
        1, ?, ?, ?, ?, ?, ?, ?, ?, 'SA', ?, 'simulator',
        0, '', 80, 0, 'medium',
        'CCSID-DEMO-884102', 'sec-demo-ccsid', '100049218',
        'PCSID-MZN-994120', 'sec-demo-pcsid',
        ?, ?, ?, 4, 0, ?
      )
    `).run(
      'أسواق الميزان الحديثة للتجزئة',
      defaultOrgMeta.name_en,
      defaultOrgMeta.vat_number,
      '1010648291',
      'طريق الملك فهد - حي العليا',
      '4218',
      defaultOrgMeta.city_ar,
      '12214',
      defaultOrgMeta.egs_serial,
      keys.privateKeyPem,
      keys.publicKeyBase64,
      keys.csrPem,
      GENESIS_PIH
    );
  }

  const productCountRow = db
    .prepare('SELECT COUNT(*) as cnt FROM products')
    .get() as { cnt: number };

  if (productCountRow.cnt === 0) {
    const now = new Date().toISOString();
    const seedProducts = [
      ['6281007001014', 'حليب طازج كامل الدسم 2 لتر', 'Fresh Whole Milk 2L', 'الألبان والمشروبات', 'Dairy & Beverages', 'عبوة', 'Bottle', 9.5, 11.74, 15, 'S', 64, 15, '2026-12-05'],
      ['6281007002028', 'أرز بسمتي هندي فاخر 5 كجم', 'Premium Basmati Rice 5kg', 'المواد الغذائية', 'Groceries', 'كيس', 'Bag', 36.0, 42.61, 15, 'S', 32, 10, '2027-08-15'],
      ['6281007003035', 'زيت زيتون الجوف بكر ممتاز 500 مل', 'Al-Jawf Extra Virgin Olive Oil 500ml', 'الزيوت والتوابل', 'Oils & Spices', 'زجاجة', 'Bottle', 24.0, 30.43, 15, 'S', 18, 8, '2027-05-20'],
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

  const custCountRow = db
    .prepare('SELECT COUNT(*) as cnt FROM customers')
    .get() as { cnt: number };

  if (custCountRow.cnt === 0) {
    const now = new Date().toISOString();
    const insertCust = db.prepare(`
      INSERT INTO customers (name_ar, name_en, vat_number, cr_number, address_ar, phone, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertCust.run(
      'شركة أطياف الضيافة المحدودة',
      'Atyaf Hospitality Co. Ltd',
      '310488291000003',
      '1010554321',
      'الرياض - حي الملقا',
      '0551234567',
      now
    );
    insertCust.run(
      'مؤسسة روابي النخيل التجارية',
      'Rawabi Al-Nakheel Trading Est.',
      '300912847500003',
      '4030228811',
      'جدة - حي الروضة',
      '0509876543',
      now
    );
    insertCust.run(
      'مخابز ومطاعم الواحة',
      'Al-Waha Bakeries & Restaurants',
      '311200495800003',
      '2050119933',
      'الدمام - حي الشاطئ',
      '0543219876',
      now
    );
  }

  const invCountRow = db
    .prepare('SELECT COUNT(*) as cnt FROM invoices')
    .get() as { cnt: number };

  if (invCountRow.cnt === 0) {
    seedInitialInvoices();
  }

  const supCountRow = db
    .prepare('SELECT COUNT(*) as cnt FROM suppliers')
    .get() as { cnt: number };

  if (supCountRow.cnt === 0) {
    seedInitialSuppliersAndPurchases();
  }
}

function seedInitialInvoices(): void {
  const org = getOrganizationSettings();
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

  let currentPih = org.last_pih || GENESIS_PIH;
  let currentIcv = org.last_icv || 0;

  for (const s of samples) {
    currentIcv += 1;
    const uuid = crypto.randomUUID();
    const createdAtDate = new Date(Date.now() - s.offsetMinutes * 60_000);
    const createdAt = createdAtDate.toISOString();
    const issueDate = createdAt.slice(0, 10);
    const issueTime = createdAt.slice(11, 19);
    const invoiceNumber = `INV-2026-${String(currentIcv).padStart(5, '0')}`;

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

    const xml = buildUbl21Xml({
      uuid,
      invoiceNumber,
      icv: currentIcv,
      previousHash: currentPih,
      issueDate,
      issueTime,
      invoiceTypeCode: '388',
      invoiceSubtype: s.subtype,
      org,
      customerName,
      customerVat,
      items,
      subtotal,
      discountTotal: 0,
      vatTotal,
      grandTotal,
    });

    const signed = signXmlAndBuildQr({
      xml,
      org,
      timestampIso: createdAt,
      grandTotal,
      vatTotal,
    });

    const zatcaStatus = s.subtype === '0100000' ? 'CLEARED' : 'REPORTED';
    const responseJson = JSON.stringify({
      validationResults: {
        infoMessages: [
          {
            type: 'INFO',
            code: 'XSD_ZATCA_VALID',
            category: 'XSD validation',
            message: 'Complied with UBL 2.1 XSD and KSA-EN 16931 schematron rules.',
            status: 'PASS',
          },
        ],
        warningMessages: [],
        errorMessages: [],
        status: 'PASS',
      },
      reportingStatus: zatcaStatus === 'REPORTED' ? 'REPORTED' : undefined,
      clearanceStatus: zatcaStatus === 'CLEARED' ? 'CLEARED' : undefined,
    });

    const invInfo = db
      .prepare(`
        INSERT INTO invoices (
          uuid, invoice_number, icv, invoice_type_code, invoice_subtype,
          payment_method, cash_amount, card_amount, customer_id, customer_name, customer_vat,
          subtotal, discount_total, vat_total, grand_total,
          invoice_hash, previous_hash, qr_tlv_base64, xml_content,
          zatca_status, zatca_mode, zatca_response_json, related_invoice_number, created_at
        ) VALUES (?, ?, ?, '388', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 'simulator', ?, NULL, ?)
      `)
      .run(
        uuid,
        invoiceNumber,
        currentIcv,
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
        signed.invoiceHashBase64,
        currentPih,
        signed.qrTlvBase64,
        xml,
        zatcaStatus,
        responseJson,
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

    currentPih = signed.invoiceHashBase64;
  }

  db.prepare(
    'UPDATE organization_settings SET last_icv = ?, last_pih = ? WHERE id = 1'
  ).run(currentIcv, currentPih);
}

function seedInitialSuppliersAndPurchases(): void {
  const now = new Date().toISOString();
  const insertSup = db.prepare(`
    INSERT INTO suppliers (name_ar, name_en, vat_number, cr_number, phone, email, address_ar, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const sup1 = insertSup.run(
    'شركة المراعي للتوريد الغذائي',
    'Almarai Wholesale Supply Co.',
    '300051472900003',
    '1010084221',
    '0114700005',
    'supply@almarai-dist.sa',
    'الرياض - المدينة الصناعية الثانية',
    now
  );
  const sup2 = insertSup.run(
    'مؤسسة النخبة للسلع الاستهلاكية',
    'Al-Nokhba FMCG Trading Est.',
    '310294857100003',
    '4030118944',
    '0503349911',
    'orders@nokhba-fmcg.sa',
    'جدة - طريق الملك عبدالعزيز',
    now
  );
  insertSup.run(
    'شركة الجوف الزراعية للتجارة',
    'Al-Jouf Agricultural Trading',
    '300772194400003',
    '3400005112',
    '0558812200',
    'sales@aljouf-agri.sa',
    'سكاكا - منطقة الجوف',
    now
  );

  const products = getAllProducts();
  if (products.length >= 4) {
    const p1Date = new Date(Date.now() - 86_400_000 * 2).toISOString();
    const p1Items = [
      { prod: products[0], qty: 24, cost: products[0].cost_price },
      { prod: products[7], qty: 18, cost: products[7].cost_price },
    ];
    const p1Sub = Number(p1Items.reduce((s, i) => s + i.qty * i.cost, 0).toFixed(2));
    const p1Vat = Number((p1Sub * 0.15).toFixed(2));
    const p1Grand = Number((p1Sub + p1Vat).toFixed(2));

    const po1 = db
      .prepare(`
        INSERT INTO purchases (
          purchase_number, supplier_id, supplier_name, supplier_vat, supplier_invoice_no,
          payment_status, paid_amount, subtotal, vat_total, grand_total, notes, received_at, created_at
        ) VALUES ('PO-2026-00001', ?, 'شركة المراعي للتوريد الغذائي', '300051472900003', 'SUP-INV-9921', 'paid', ?, ?, ?, ?, 'توريد ألبان أسبوعي', ?, ?)
      `)
      .run(sup1.lastInsertRowid, p1Grand, p1Sub, p1Vat, p1Grand, p1Date, p1Date);

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
      { prod: products[1], qty: 20, cost: products[1].cost_price },
      { prod: products[10], qty: 30, cost: products[10].cost_price },
    ];
    const p2Sub = Number(p2Items.reduce((s, i) => s + i.qty * i.cost, 0).toFixed(2));
    const p2Vat = Number((p2Sub * 0.15).toFixed(2));
    const p2Grand = Number((p2Sub + p2Vat).toFixed(2));

    const po2 = db
      .prepare(`
        INSERT INTO purchases (
          purchase_number, supplier_id, supplier_name, supplier_vat, supplier_invoice_no,
          payment_status, paid_amount, subtotal, vat_total, grand_total, notes, received_at, created_at
        ) VALUES ('PO-2026-00002', ?, 'مؤسسة النخبة للسلع الاستهلاكية', '310294857100003', 'NK-2026-441', 'credit', 0, ?, ?, ?, 'فاتورة مشتريات آجلة لمدة 30 يوماً', ?, ?)
      `)
      .run(sup2.lastInsertRowid, p2Sub, p2Vat, p2Grand, p2Date, p2Date);

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

export function getOrganizationSettings(): OrganizationSettings {
  return db
    .prepare('SELECT * FROM organization_settings WHERE id = 1')
    .get() as OrganizationSettings;
}

export function getAllProducts(): Product[] {
  return db
    .prepare('SELECT * FROM products WHERE active = 1 ORDER BY id ASC')
    .all() as Product[];
}

export function getAllCustomers(): Customer[] {
  return db
    .prepare('SELECT * FROM customers ORDER BY id ASC')
    .all() as Customer[];
}

export function getAllSuppliers(): Supplier[] {
  return db
    .prepare('SELECT * FROM suppliers ORDER BY id DESC')
    .all() as Supplier[];
}

export function getAllPurchases(): Purchase[] {
  const purchases = db
    .prepare('SELECT * FROM purchases ORDER BY id DESC LIMIT 100')
    .all() as Purchase[];
  const itemsStmt = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?');
  return purchases.map((p) => ({
    ...p,
    items: itemsStmt.all(p.id) as PurchaseItem[],
  }));
}

export function getRecentMovements(limit = 50): StockMovement[] {
  return db
    .prepare(`
      SELECT sm.*, p.name_ar as product_name_ar, p.name_en as product_name_en, p.sku as sku
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id
      ORDER BY sm.id DESC
      LIMIT ?
    `)
    .all(limit) as StockMovement[];
}

export function getAllInvoices(): Invoice[] {
  const invoices = db
    .prepare('SELECT * FROM invoices ORDER BY id DESC LIMIT 100')
    .all() as Invoice[];
  const itemsStmt = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?');
  return invoices.map((inv) => ({
    ...inv,
    items: itemsStmt.all(inv.id) as InvoiceItem[],
  }));
}

export function getHeldCarts(): HeldCart[] {
  return db
    .prepare('SELECT * FROM held_carts ORDER BY id DESC')
    .all() as HeldCart[];
}

export function getPublicInvoiceByUuid(uuid: string): {
  invoice: {
    uuid: string;
    invoice_number: string;
    invoice_type_code: string;
    invoice_subtype: string;
    payment_method: string;
    cash_amount: number;
    card_amount: number;
    customer_name: string;
    customer_vat: string;
    subtotal: number;
    discount_total: number;
    vat_total: number;
    grand_total: number;
    related_invoice_number: string | null;
    created_at: string;
    items: InvoiceItem[];
  };
  store: {
    name_ar: string;
    name_en: string;
    vat_number: string;
    cr_number: string;
    street_ar: string;
    building_no: string;
    city_ar: string;
    postal_code: string;
    public_base_url: string;
  };
} | null {
  const inv = db
    .prepare(`
      SELECT id, uuid, invoice_number, invoice_type_code, invoice_subtype,
             payment_method, cash_amount, card_amount, customer_name, customer_vat,
             subtotal, discount_total, vat_total, grand_total, related_invoice_number, created_at
      FROM invoices
      WHERE uuid = ?
    `)
    .get(uuid) as
    | {
        id: number;
        uuid: string;
        invoice_number: string;
        invoice_type_code: string;
        invoice_subtype: string;
        payment_method: string;
        cash_amount: number;
        card_amount: number;
        customer_name: string;
        customer_vat: string;
        subtotal: number;
        discount_total: number;
        vat_total: number;
        grand_total: number;
        related_invoice_number: string | null;
        created_at: string;
      }
    | undefined;

  if (!inv) return null;

  const items = db
    .prepare('SELECT * FROM invoice_items WHERE invoice_id = ?')
    .all(inv.id) as InvoiceItem[];
  const org = getOrganizationSettings();

  const { id: _internalId, ...publicInvoice } = inv;
  return {
    invoice: {
      ...publicInvoice,
      items,
    },
    store: {
      name_ar: org.name_ar,
      name_en: org.name_en,
      vat_number: org.vat_number,
      cr_number: org.cr_number,
      street_ar: org.street_ar,
      building_no: org.building_no,
      city_ar: org.city_ar,
      postal_code: org.postal_code,
      public_base_url: org.public_base_url,
    },
  };
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, hexHash] = parts;
  if (!salt || !hexHash) return false;
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hexHash, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function hasAnyUsers(): boolean {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
  return row.cnt > 0;
}

export function createSessionForUser(userId: number): { token: string; expiresAt: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  db.prepare('DELETE FROM user_sessions WHERE user_id = ? AND expires_at <= ?').run(
    userId,
    now.toISOString()
  );

  db.prepare(`
    INSERT INTO user_sessions (user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).run(userId, tokenHash, expiresAt, now.toISOString());

  return { token, expiresAt };
}

export function getUserBySessionToken(token: string): AuthUser | null {
  if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const nowIso = new Date().toISOString();

  const row = db
    .prepare(`
      SELECT u.id, u.full_name, u.email, u.role, u.created_at
      FROM user_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `)
    .get(tokenHash, nowIso) as
    | {
        id: number;
        full_name: string;
        email: string;
        role: string;
        created_at: string;
      }
    | undefined;

  if (!row) return null;
  const role: UserRole = row.role === 'admin' ? 'admin' : 'cashier';
  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    role,
    created_at: row.created_at,
  };
}

export function revokeSessionToken(token: string): void {
  if (!token) return;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(tokenHash);
}
