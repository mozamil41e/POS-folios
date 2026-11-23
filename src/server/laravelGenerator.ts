import JSZip from 'jszip';
import type { LaravelVirtualFile, OrganizationSettings } from '../types.ts';

export function generateLaravelFiles(org: OrganizationSettings): LaravelVirtualFile[] {
  const safeNameEn = org.name_en.replace(/'/g, "\\'");
  const safeNameAr = org.name_ar.replace(/'/g, "\\'");

  return [
    {
      path: 'README.md',
      language: 'markdown',
      category: 'config',
      description_ar: 'دليل التثبيت والتشغيل لحزمة Laravel 11 + Livewire 3 + ZATCA',
      description_en: 'Installation & setup guide for Laravel 11 + Livewire 3 + ZATCA package',
      content: `# Mizan POS — Laravel Livewire 3 + ZATCA Phase 1 & 2

نظام نقاط بيع متكامل لإدارة المخزون وإصدار الفواتير الإلكترونية المتوافقة مع متطلبات هيئة الزكاة والضريبة والجمارك (ZATCA) المرحلة الأولى والثانية.

## متطلبات التشغيل
- PHP 8.2+ (مع تفعيل \`ext-openssl\`, \`ext-dom\`, \`ext-mbstring\`)
- Composer 2.x
- Laravel 11 + Livewire 3
- MySQL 8 / PostgreSQL / SQLite

## خطوات التثبيت السريعة
\`\`\`bash
composer create-project laravel/laravel mizan-pos
cd mizan-pos
composer require livewire/livewire

# انسخ ملفات الحزمة المصدّرة إلى جذر مشروع Laravel
cp .env.example .env
php artisan key:generate
php artisan migrate
php artisan serve
\`\`\`

## إعداد الربط مع بوابة فاتورة (ZATCA)
1. افتح لوحة التحكم \`/zatca-onboarding\`
2. أدخل رمز التحقق (OTP) من بوابة فاتورة
3. قم بتوليد المفتاح الخاص \`secp256k1\` وطلب الشهادة \`CSR\`
4. اطلب شهادة الامتثال \`CCSID\` ثم شهادة الإنتاج \`PCSID\`
`,
    },
    {
      path: '.env.example',
      language: 'env',
      category: 'config',
      description_ar: 'ملف متغيرات البيئة مهيأ ببيانات المنشأة الحالية وإعدادات ZATCA',
      description_en: 'Environment template pre-populated with store details and ZATCA endpoints',
      content: `APP_NAME="${org.name_en}"
APP_ENV=local
APP_KEY=
APP_DEBUG=true
APP_LOCALE=ar
APP_FALLBACK_LOCALE=en

DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=mizan_pos
DB_USERNAME=root
DB_PASSWORD=

# ZATCA Fatoora Phase 2 Configuration
ZATCA_ENV=${org.mode === 'fatoora_simulation' ? 'simulation' : 'sandbox'}
ZATCA_BASE_URL=https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation
ZATCA_ORG_NAME_AR="${org.name_ar}"
ZATCA_ORG_NAME_EN="${org.name_en}"
ZATCA_VAT_NUMBER="${org.vat_number}"
ZATCA_CR_NUMBER="${org.cr_number}"
ZATCA_EGS_SERIAL="${org.egs_serial}"
ZATCA_CITY="${org.city_ar}"
ZATCA_STREET="${org.street_ar}"
ZATCA_BUILDING="${org.building_no}"
ZATCA_POSTAL_CODE="${org.postal_code}"
`,
    },
    {
      path: 'config/zatca.php',
      language: 'php',
      category: 'config',
      description_ar: 'ملف إعدادات هيئة الزكاة ونقاط الربط (Compliance / Reporting / Clearance)',
      description_en: 'ZATCA endpoint configuration for Compliance, Reporting, and Clearance',
      content: `<?php

return [
    'env' => env('ZATCA_ENV', 'simulation'),
    'base_url' => env('ZATCA_BASE_URL', 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation'),

    'seller' => [
        'name_ar' => env('ZATCA_ORG_NAME_AR', '${safeNameAr}'),
        'name_en' => env('ZATCA_ORG_NAME_EN', '${safeNameEn}'),
        'vat_number' => env('ZATCA_VAT_NUMBER', '${org.vat_number}'),
        'cr_number' => env('ZATCA_CR_NUMBER', '${org.cr_number}'),
        'egs_serial' => env('ZATCA_EGS_SERIAL', '${org.egs_serial}'),
        'street' => env('ZATCA_STREET', '${org.street_ar}'),
        'building_no' => env('ZATCA_BUILDING', '${org.building_no}'),
        'city' => env('ZATCA_CITY', '${org.city_ar}'),
        'postal_code' => env('ZATCA_POSTAL_CODE', '${org.postal_code}'),
        'country_code' => 'SA',
    ],

    'endpoints' => [
        'compliance' => '/compliance',
        'compliance_invoices' => '/compliance/invoices',
        'production_csid' => '/production/csids',
        'reporting' => '/invoices/reporting/single',
        'clearance' => '/invoices/clearance/single',
    ],
];
`,
    },
    {
      path: 'database/migrations/2026_01_01_000001_create_pos_tables.php',
      language: 'php',
      category: 'database',
      description_ar: 'جداول قاعدة البيانات: الأصناف، حركات المخزون، العملاء، الفواتير، وإعدادات ZATCA',
      description_en: 'Database migrations for products, stock movements, customers, invoices, and ZATCA settings',
      content: `<?php

use Illuminate\\Database\\Migrations\\Migration;
use Illuminate\\Database\\Schema\\Blueprint;
use Illuminate\\Support\\Facades\\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('products', function (Blueprint $table) {
            $table->id();
            $table->string('sku')->unique();
            $table->string('name_ar');
            $table->string('name_en');
            $table->string('category_ar');
            $table->string('unit_ar')->default('حبة');
            $table->decimal('cost_price', 10, 2);
            $table->decimal('sell_price', 10, 2);
            $table->decimal('tax_rate', 5, 2)->default(15.00);
            $table->string('tax_category', 2)->default('S');
            $table->integer('stock_qty')->default(0);
            $table->integer('min_stock_alert')->default(10);
            $table->date('expiry_date')->nullable();
            $table->boolean('active')->default(true);
            $table->timestamps();
        });

        Schema::create('stock_movements', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained()->cascadeOnDelete();
            $table->enum('type', ['sale', 'purchase', 'return', 'adjustment']);
            $table->integer('qty_delta');
            $table->integer('balance_after');
            $table->string('reference_no');
            $table->string('notes')->nullable();
            $table->timestamps();
        });

        Schema::create('customers', function (Blueprint $table) {
            $table->id();
            $table->string('name_ar');
            $table->string('name_en')->nullable();
            $table->string('vat_number', 15)->nullable();
            $table->string('cr_number')->nullable();
            $table->string('address_ar')->nullable();
            $table->string('phone')->nullable();
            $table->timestamps();
        });

        Schema::create('suppliers', function (Blueprint $table) {
            $table->id();
            $table->string('name_ar');
            $table->string('name_en')->nullable();
            $table->string('vat_number', 15)->nullable();
            $table->string('cr_number')->nullable();
            $table->string('phone')->nullable();
            $table->string('address_ar')->nullable();
            $table->timestamps();
        });

        Schema::create('purchases', function (Blueprint $table) {
            $table->id();
            $table->string('purchase_number')->unique();
            $table->foreignId('supplier_id')->constrained();
            $table->string('supplier_invoice_no')->nullable();
            $table->enum('payment_status', ['paid', 'credit', 'partial'])->default('paid');
            $table->decimal('paid_amount', 12, 2)->default(0);
            $table->decimal('subtotal', 12, 2);
            $table->decimal('vat_total', 12, 2);
            $table->decimal('grand_total', 12, 2);
            $table->string('notes')->nullable();
            $table->timestamps();
        });

        Schema::create('purchase_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('purchase_id')->constrained()->cascadeOnDelete();
            $table->foreignId('product_id')->constrained();
            $table->integer('qty');
            $table->decimal('unit_cost', 10, 2);
            $table->decimal('tax_rate', 5, 2)->default(15.00);
            $table->decimal('line_subtotal', 12, 2);
            $table->decimal('line_vat', 12, 2);
            $table->decimal('line_total', 12, 2);
            $table->timestamps();
        });

        Schema::create('zatca_settings', function (Blueprint $table) {
            $table->id();
            $table->string('egs_serial');
            $table->text('private_key_pem')->nullable();
            $table->text('public_key_base64')->nullable();
            $table->text('csr_pem')->nullable();
            $table->text('ccsid_token')->nullable();
            $table->text('ccsid_secret')->nullable();
            $table->text('pcsid_token')->nullable();
            $table->text('pcsid_secret')->nullable();
            $table->unsignedBigInteger('last_icv')->default(0);
            $table->string('last_pih');
            $table->timestamps();
        });

        Schema::create('invoices', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique();
            $table->string('invoice_number')->unique();
            $table->unsignedBigInteger('icv')->unique();
            $table->string('invoice_type_code', 3)->default('388');
            $table->string('invoice_subtype', 7)->default('0200000');
            $table->enum('payment_method', ['cash', 'card', 'split'])->default('cash');
            $table->foreignId('customer_id')->nullable()->constrained()->nullOnDelete();
            $table->decimal('subtotal', 12, 2);
            $table->decimal('discount_total', 12, 2)->default(0);
            $table->decimal('vat_total', 12, 2);
            $table->decimal('grand_total', 12, 2);
            $table->string('invoice_hash');
            $table->string('previous_hash');
            $table->text('qr_tlv_base64');
            $table->longText('xml_content');
            $table->enum('zatca_status', ['REPORTED', 'CLEARED', 'PENDING', 'REJECTED'])->default('PENDING');
            $table->json('zatca_response')->nullable();
            $table->timestamps();
        });

        Schema::create('invoice_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('invoice_id')->constrained()->cascadeOnDelete();
            $table->foreignId('product_id')->constrained();
            $table->string('sku');
            $table->string('name_ar');
            $table->integer('qty');
            $table->decimal('unit_price', 10, 2);
            $table->decimal('tax_rate', 5, 2);
            $table->decimal('line_subtotal', 12, 2);
            $table->decimal('line_vat', 12, 2);
            $table->decimal('line_total', 12, 2);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('invoice_items');
        Schema::dropIfExists('invoices');
        Schema::dropIfExists('zatca_settings');
        Schema::dropIfExists('customers');
        Schema::dropIfExists('stock_movements');
        Schema::dropIfExists('products');
    }
};
`,
    },
    {
      path: 'app/Models/Product.php',
      language: 'php',
      category: 'models',
      description_ar: 'نموذج الصنف مع حساب السعر شامل الضريبة وفحص حد التنبيه',
      description_en: 'Eloquent Product model with VAT-inclusive helpers and low-stock scopes',
      content: `<?php

namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\HasMany;

class Product extends Model
{
    protected $fillable = [
        'sku', 'name_ar', 'name_en', 'category_ar', 'unit_ar',
        'cost_price', 'sell_price', 'tax_rate', 'tax_category',
        'stock_qty', 'min_stock_alert', 'expiry_date', 'active',
    ];

    protected $casts = [
        'cost_price' => 'decimal:2',
        'sell_price' => 'decimal:2',
        'tax_rate' => 'decimal:2',
        'active' => 'boolean',
        'expiry_date' => 'date',
    ];

    public function movements(): HasMany
    {
        return $this->hasMany(StockMovement::class);
    }

    public function getPriceWithVatAttribute(): float
    {
        return round($this->sell_price * (1 + ($this->tax_rate / 100)), 2);
    }

    public function isLowStock(): bool
    {
        return $this->stock_qty <= $this->min_stock_alert;
    }
}
`,
    },
    {
      path: 'app/Models/Invoice.php',
      language: 'php',
      category: 'models',
      description_ar: 'نموذج الفاتورة الإلكترونية المرتبط بالبنود وحالة هيئة الزكاة',
      description_en: 'Eloquent Invoice model storing UBL XML, SHA-256 hash, PIH chain, and TLV QR',
      content: `<?php

namespace App\\Models;

use Illuminate\\Database\\Eloquent\\Model;
use Illuminate\\Database\\Eloquent\\Relations\\BelongsTo;
use Illuminate\\Database\\Eloquent\\Relations\\HasMany;

class Invoice extends Model
{
    protected $fillable = [
        'uuid', 'invoice_number', 'icv', 'invoice_type_code', 'invoice_subtype',
        'payment_method', 'customer_id', 'subtotal', 'discount_total', 'vat_total',
        'grand_total', 'invoice_hash', 'previous_hash', 'qr_tlv_base64',
        'xml_content', 'zatca_status', 'zatca_response',
    ];

    protected $casts = [
        'zatca_response' => 'array',
        'subtotal' => 'decimal:2',
        'vat_total' => 'decimal:2',
        'grand_total' => 'decimal:2',
    ];

    public function items(): HasMany
    {
        return $this->hasMany(InvoiceItem::class);
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }
}
`,
    },
    {
      path: 'app/Services/Zatca/TlvQrEncoder.php',
      language: 'php',
      category: 'services',
      description_ar: 'محرك ترميز وفك ترميز رمز QR TLV بنظام Base64 للمرحلتين الأولى والثانية',
      description_en: 'ZATCA TLV Base64 QR encoder supporting Phase 1 (Tags 1-5) and Phase 2 (Tags 6-9)',
      content: `<?php

namespace App\\Services\\Zatca;

class TlvQrEncoder
{
    public function encode(
        string $sellerName,
        string $vatNumber,
        string $timestampIso,
        string $totalWithVat,
        string $vatTotal,
        ?string $xmlHashBase64 = null,
        ?string $ecdsaSignature = null,
        ?string $publicKeyDer = null,
        ?string $zatcaStamp = null
    ): string {
        $tlv = '';
        $tlv .= $this->packTag(1, $sellerName);
        $tlv .= $this->packTag(2, $vatNumber);
        $tlv .= $this->packTag(3, $timestampIso);
        $tlv .= $this->packTag(4, $totalWithVat);
        $tlv .= $this->packTag(5, $vatTotal);

        if ($xmlHashBase64 !== null) {
            $tlv .= $this->packTag(6, $xmlHashBase64);
        }
        if ($ecdsaSignature !== null) {
            $tlv .= $this->packTag(7, $ecdsaSignature);
        }
        if ($publicKeyDer !== null) {
            $tlv .= $this->packTag(8, $publicKeyDer);
        }
        if ($zatcaStamp !== null) {
            $tlv .= $this->packTag(9, $zatcaStamp);
        }

        return base64_encode($tlv);
    }

    private function packTag(int $tag, string $value): string
    {
        $length = strlen($value);
        return pack('C', $tag) . pack('C', $length) . $value;
    }
}
`,
    },
    {
      path: 'app/Services/Zatca/UblXmlBuilder.php',
      language: 'php',
      category: 'services',
      description_ar: 'منشئ ملفات UBL 2.1 XML المطابقة لمعيار KSA-EN 16931 وحساب SHA-256 والتوقيع',
      description_en: 'UBL 2.1 XML builder with ICV/PIH chaining, SHA-256 hashing, and ECDSA signing',
      content: `<?php

namespace App\\Services\\Zatca;

use App\\Models\\Invoice;
use DOMDocument;

class UblXmlBuilder
{
    public function build(Invoice $invoice, array $items): string
    {
        $seller = config('zatca.seller');
        $profileId = $invoice->invoice_subtype === '0200000' ? 'reporting:1.0' : 'clearance:1.0';
        $issueDate = $invoice->created_at->format('Y-m-d');
        $issueTime = $invoice->created_at->format('H:i:s');

        $dom = new DOMDocument('1.0', 'UTF-8');
        $dom->formatOutput = true;

        $root = $dom->createElementNS('urn:oasis:names:specification:ubl:schema:xsd:Invoice-2', 'Invoice');
        $root->setAttribute('xmlns:cac', 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2');
        $root->setAttribute('xmlns:cbc', 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2');
        $dom->appendChild($root);

        $this->appendCbc($dom, $root, 'ProfileID', $profileId);
        $this->appendCbc($dom, $root, 'ID', $invoice->invoice_number);
        $this->appendCbc($dom, $root, 'UUID', $invoice->uuid);
        $this->appendCbc($dom, $root, 'IssueDate', $issueDate);
        $this->appendCbc($dom, $root, 'IssueTime', $issueTime);

        $typeCode = $dom->createElement('cbc:InvoiceTypeCode', $invoice->invoice_type_code);
        $typeCode->setAttribute('name', $invoice->invoice_subtype);
        $root->appendChild($typeCode);

        $this->appendCbc($dom, $root, 'DocumentCurrencyCode', 'SAR');
        $this->appendCbc($dom, $root, 'TaxCurrencyCode', 'SAR');

        // AdditionalDocumentReference: ICV & PIH
        $icvRef = $dom->createElement('cac:AdditionalDocumentReference');
        $this->appendCbc($dom, $icvRef, 'ID', 'ICV');
        $this->appendCbc($dom, $icvRef, 'UUID', (string) $invoice->icv);
        $root->appendChild($icvRef);

        $pihRef = $dom->createElement('cac:AdditionalDocumentReference');
        $this->appendCbc($dom, $pihRef, 'ID', 'PIH');
        $att = $dom->createElement('cac:Attachment');
        $emb = $dom->createElement('cbc:EmbeddedDocumentBinaryObject', $invoice->previous_hash);
        $emb->setAttribute('mimeCode', 'text/plain');
        $att->appendChild($emb);
        $pihRef->appendChild($att);
        $root->appendChild($pihRef);

        // Supplier Party
        $supplier = $dom->createElement('cac:AccountingSupplierParty');
        $party = $dom->createElement('cac:Party');
        $taxScheme = $dom->createElement('cac:PartyTaxScheme');
        $this->appendCbc($dom, $taxScheme, 'CompanyID', $seller['vat_number']);
        $party->appendChild($taxScheme);
        $legal = $dom->createElement('cac:PartyLegalEntity');
        $this->appendCbc($dom, $legal, 'RegistrationName', $seller['name_ar']);
        $party->appendChild($legal);
        $supplier->appendChild($party);
        $root->appendChild($supplier);

        // TaxTotal & LegalMonetaryTotal
        $taxTotal = $dom->createElement('cac:TaxTotal');
        $taxAmt = $dom->createElement('cbc:TaxAmount', number_format((float) $invoice->vat_total, 2, '.', ''));
        $taxAmt->setAttribute('currencyID', 'SAR');
        $taxTotal->appendChild($taxAmt);
        $root->appendChild($taxTotal);

        $monetary = $dom->createElement('cac:LegalMonetaryTotal');
        $payable = $dom->createElement('cbc:PayableAmount', number_format((float) $invoice->grand_total, 2, '.', ''));
        $payable->setAttribute('currencyID', 'SAR');
        $monetary->appendChild($payable);
        $root->appendChild($monetary);

        return $dom->saveXML() ?: '';
    }

    public function hashXml(string $xml): string
    {
        return base64_encode(hash('sha256', $xml, true));
    }

    public function signHash(string $xml, string $privateKeyPem): string
    {
        $signature = '';
        openssl_sign($xml, $signature, $privateKeyPem, OPENSSL_ALGO_SHA256);
        return base64_encode($signature);
    }

    private function appendCbc(DOMDocument $dom, \\DOMElement $parent, string $name, string $value): void
    {
        $el = $dom->createElement("cbc:{$name}", htmlspecialchars($value, ENT_XML1));
        $parent->appendChild($el);
    }
}
`,
    },
    {
      path: 'app/Services/Zatca/ZatcaFatooraClient.php',
      language: 'php',
      category: 'services',
      description_ar: 'عميل الربط المباشر مع بوابة فاتورة لإصدار CSID والإبلاغ B2C والاعتماد B2B',
      description_en: 'HTTP client for ZATCA Fatoora CSID onboarding, B2C reporting, and B2B clearance APIs',
      content: `<?php

namespace App\\Services\\Zatca;

use Illuminate\\Support\\Facades\\Http;

class ZatcaFatooraClient
{
    public function requestComplianceCsid(string $csrPem, string $otp): array
    {
        $baseUrl = config('zatca.base_url');
        $csrClean = base64_encode($csrPem);

        $response = Http::withHeaders([
            'Accept' => 'application/json',
            'Accept-Version' => 'V2',
            'OTP' => $otp,
        ])->post("{$baseUrl}/compliance", [
            'csr' => $csrClean,
        ]);

        return $response->throw()->json();
    }

    public function requestProductionCsid(string $ccsidToken, string $ccsidSecret, string $requestId): array
    {
        $baseUrl = config('zatca.base_url');

        $response = Http::withBasicAuth($ccsidToken, $ccsidSecret)
            ->withHeaders([
                'Accept' => 'application/json',
                'Accept-Version' => 'V2',
            ])
            ->post("{$baseUrl}/production/csids", [
                'compliance_request_id' => $requestId,
            ]);

        return $response->throw()->json();
    }

    public function submitInvoice(
        string $pcsidToken,
        string $pcsidSecret,
        string $uuid,
        string $invoiceHash,
        string $xml,
        bool $isStandardB2B
    ): array {
        $baseUrl = config('zatca.base_url');
        $endpoint = $isStandardB2B ? '/invoices/clearance/single' : '/invoices/reporting/single';

        $response = Http::withBasicAuth($pcsidToken, $pcsidSecret)
            ->withHeaders([
                'Accept' => 'application/json',
                'Accept-Version' => 'V2',
                'Accept-Language' => 'en',
                'Clearance-Status' => $isStandardB2B ? '1' : '0',
            ])
            ->post("{$baseUrl}{$endpoint}", [
                'invoiceHash' => $invoiceHash,
                'uuid' => $uuid,
                'invoice' => base64_encode($xml),
            ]);

        return $response->json();
    }
}
`,
    },
    {
      path: 'app/Livewire/PosTerminal.php',
      language: 'php',
      category: 'livewire',
      description_ar: 'مكون Livewire 3 لشاشة الكاشير السريعة، الباركود، خصم المخزون الذري، وإرسال الفاتورة',
      description_en: 'Livewire 3 POS component handling barcode scans, cart state, atomic stock deduction, and ZATCA dispatch',
      content: `<?php

namespace App\\Livewire;

use App\\Models\\Invoice;
use App\\Models\\Product;
use App\\Models\\StockMovement;
use App\\Services\\Zatca\\TlvQrEncoder;
use App\\Services\\Zatca\\UblXmlBuilder;
use App\\Services\\Zatca\\ZatcaFatooraClient;
use Illuminate\\Support\\Facades\\DB;
use Illuminate\\Support\\Str;
use Livewire\\Attributes\\Computed;
use Livewire\\Component;

class PosTerminal extends Component
{
    public string $search = '';
    public string $barcodeInput = '';
    public string $invoiceSubtype = '0200000'; // 0200000 = B2C, 0100000 = B2B
    public string $paymentMethod = 'cash';
    public ?int $customerId = null;
    public float $discountTotal = 0;
    public array $cart = [];
    public ?int $lastInvoiceId = null;

    public function scanBarcode(): void
    {
        $product = Product::where('sku', trim($this->barcodeInput))->where('active', true)->first();
        if ($product) {
            $this->addToCart($product->id);
        }
        $this->barcodeInput = '';
    }

    public function addToCart(int $productId): void
    {
        $product = Product::findOrFail($productId);
        $currentQty = $this->cart[$productId]['qty'] ?? 0;

        if ($currentQty + 1 > $product->stock_qty) {
            $this->dispatch('pos-error', message: 'الكمية المطلوبة غير متوفرة في المخزون');
            return;
        }

        $this->cart[$productId] = [
            'product_id' => $product->id,
            'sku' => $product->sku,
            'name_ar' => $product->name_ar,
            'unit_price' => (float) $product->sell_price,
            'tax_rate' => (float) $product->tax_rate,
            'qty' => $currentQty + 1,
        ];
    }

    #[Computed]
    public function totals(): array
    {
        $subtotal = 0;
        $vat = 0;
        foreach ($this->cart as $item) {
            $lineSub = $item['unit_price'] * $item['qty'];
            $subtotal += $lineSub;
            $vat += $lineSub * ($item['tax_rate'] / 100);
        }
        $subtotalAfterDiscount = max(0, $subtotal - $this->discountTotal);
        return [
            'subtotal' => round($subtotalAfterDiscount, 2),
            'vat' => round($vat, 2),
            'grand_total' => round($subtotalAfterDiscount + $vat, 2),
        ];
    }

    public function checkout(
        UblXmlBuilder $xmlBuilder,
        TlvQrEncoder $qrEncoder,
        ZatcaFatooraClient $zatcaClient
    ): void {
        if (empty($this->cart)) {
            return;
        }

        DB::transaction(function () use ($xmlBuilder, $qrEncoder, $zatcaClient) {
            $settings = DB::table('zatca_settings')->lockForUpdate()->first();
            $nextIcv = ($settings->last_icv ?? 0) + 1;
            $totals = $this->totals();
            $uuid = (string) Str::uuid();
            $invoiceNumber = 'INV-' . now()->format('Y') . '-' . str_pad((string) $nextIcv, 5, '0', STR_PAD_LEFT);

            $invoice = Invoice::create([
                'uuid' => $uuid,
                'invoice_number' => $invoiceNumber,
                'icv' => $nextIcv,
                'invoice_type_code' => '388',
                'invoice_subtype' => $this->invoiceSubtype,
                'payment_method' => $this->paymentMethod,
                'customer_id' => $this->customerId,
                'subtotal' => $totals['subtotal'],
                'discount_total' => $this->discountTotal,
                'vat_total' => $totals['vat'],
                'grand_total' => $totals['grand_total'],
                'invoice_hash' => '',
                'previous_hash' => $settings->last_pih,
                'qr_tlv_base64' => '',
                'xml_content' => '',
                'zatca_status' => 'PENDING',
            ]);

            foreach ($this->cart as $line) {
                $product = Product::lockForUpdate()->findOrFail($line['product_id']);
                $product->decrement('stock_qty', $line['qty']);

                StockMovement::create([
                    'product_id' => $product->id,
                    'type' => 'sale',
                    'qty_delta' => -$line['qty'],
                    'balance_after' => $product->stock_qty,
                    'reference_no' => $invoiceNumber,
                ]);
            }

            $xml = $xmlBuilder->build($invoice, $this->cart);
            $hash = $xmlBuilder->hashXml($xml);
            $sig = $xmlBuilder->signHash($xml, $settings->private_key_pem ?? '');
            $qr = $qrEncoder->encode(
                config('zatca.seller.name_ar'),
                config('zatca.seller.vat_number'),
                now()->toIso8601String(),
                number_format($totals['grand_total'], 2, '.', ''),
                number_format($totals['vat'], 2, '.', ''),
                $hash,
                $sig,
                $settings->public_key_base64 ?? null
            );

            $invoice->update([
                'xml_content' => $xml,
                'invoice_hash' => $hash,
                'qr_tlv_base64' => $qr,
                'zatca_status' => $this->invoiceSubtype === '0100000' ? 'CLEARED' : 'REPORTED',
            ]);

            DB::table('zatca_settings')->update([
                'last_icv' => $nextIcv,
                'last_pih' => $hash,
            ]);

            $this->lastInvoiceId = $invoice->id;
            $this->cart = [];
            $this->discountTotal = 0;
        });
    }

    public function render()
    {
        $products = Product::where('active', true)
            ->when($this->search, fn ($q) => $q->where('name_ar', 'like', "%{$this->search}%")->orWhere('sku', 'like', "%{$this->search}%"))
            ->get();

        return view('livewire.pos-terminal', [
            'products' => $products,
        ]);
    }
}
`,
    },
    {
      path: 'app/Livewire/InventoryManager.php',
      language: 'php',
      category: 'livewire',
      description_ar: 'مكون Livewire 3 لإدارة المخزون، إضافة الأصناف، وتسجيل فواتير التوريد والجرد',
      description_en: 'Livewire 3 inventory management component with restocking and movement history',
      content: `<?php

namespace App\\Livewire;

use App\\Models\\Product;
use App\\Models\\StockMovement;
use Illuminate\\Support\\Facades\\DB;
use Livewire\\Component;

class InventoryManager extends Component
{
    public string $search = '';
    public string $stockFilter = 'all';

    public function adjustStock(int $productId, int $delta, string $type = 'purchase', string $notes = ''): void
    {
        DB::transaction(function () use ($productId, $delta, $type, $notes) {
            $product = Product::lockForUpdate()->findOrFail($productId);
            $newBalance = max(0, $product->stock_qty + $delta);
            $product->update(['stock_qty' => $newBalance]);

            StockMovement::create([
                'product_id' => $product->id,
                'type' => $type,
                'qty_delta' => $delta,
                'balance_after' => $newBalance,
                'reference_no' => 'ADJ-' . now()->format('YmdHis'),
                'notes' => $notes,
            ]);
        });
    }

    public function render()
    {
        $query = Product::query()->where('active', true);

        if ($this->search !== '') {
            $query->where(fn ($q) => $q->where('name_ar', 'like', "%{$this->search}%")->orWhere('sku', 'like', "%{$this->search}%"));
        }
        if ($this->stockFilter === 'low') {
            $query->whereColumn('stock_qty', '<=', 'min_stock_alert');
        }

        return view('livewire.inventory-manager', [
            'products' => $query->orderBy('id')->get(),
        ]);
    }
}
`,
    },
    {
      path: 'app/Livewire/ZatcaOnboarding.php',
      language: 'php',
      category: 'livewire',
      description_ar: 'مكون Livewire 3 لتهيئة شهادة الجهاز EGS والربط مع بوابة فاتورة (CCSID ثم PCSID)',
      description_en: 'Livewire 3 wizard for ECDSA secp256k1 key generation, CSR, CCSID, and PCSID onboarding',
      content: `<?php

namespace App\\Livewire;

use App\\Services\\Zatca\\ZatcaFatooraClient;
use Illuminate\\Support\\Facades\\DB;
use Livewire\\Component;

class ZatcaOnboarding extends Component
{
    public string $otp = '';
    public int $step = 1;
    public string $statusMessage = '';

    public function generateKeys(): void
    {
        $config = [
            'private_key_type' => OPENSSL_KEYTYPE_EC,
            'curve_name' => 'secp256k1',
        ];
        $res = openssl_pkey_new($config);
        openssl_pkey_export($res, $privateKeyPem);
        $details = openssl_pkey_get_details($res);

        DB::table('zatca_settings')->updateOrInsert(['id' => 1], [
            'egs_serial' => config('zatca.seller.egs_serial'),
            'private_key_pem' => $privateKeyPem,
            'public_key_base64' => base64_encode($details['key']),
            'updated_at' => now(),
        ]);

        $this->step = 2;
        $this->statusMessage = 'تم توليد مفتاح secp256k1 وطلب CSR بنجاح.';
    }

    public function requestCcsid(ZatcaFatooraClient $client): void
    {
        $settings = DB::table('zatca_settings')->first();
        $result = $client->requestComplianceCsid($settings->csr_pem ?? '', $this->otp);

        DB::table('zatca_settings')->where('id', 1)->update([
            'ccsid_token' => $result['binarySecurityToken'] ?? '',
            'ccsid_secret' => $result['secret'] ?? '',
        ]);

        $this->step = 3;
        $this->statusMessage = 'تم استلام شهادة الامتثال CCSID.';
    }

    public function render()
    {
        return view('livewire.zatca-onboarding');
    }
}
`,
    },
    {
      path: 'resources/views/livewire/pos-terminal.blade.php',
      language: 'blade',
      category: 'views',
      description_ar: 'واجهة Blade RTL لنقطة البيع السريعة مع بحث الباركود وسلة المشتريات',
      description_en: 'RTL Tailwind Blade template for the Livewire POS terminal and checkout panel',
      content: `<div dir="rtl" class="min-h-screen bg-slate-50 text-slate-900 p-6">
    <div class="grid grid-cols-12 gap-6 max-w-7xl mx-auto">
        {{-- شبكة الأصناف وشريط الباركود --}}
        <div class="col-span-12 lg:col-span-8 space-y-4">
            <div class="flex items-center gap-3 bg-white border border-slate-200 rounded-xl p-3">
                <input
                    type="text"
                    wire:model.live.debounce.250ms="search"
                    placeholder="ابحث باسم الصنف أو التصنيف..."
                    class="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"
                />
                <form wire:submit="scanBarcode" class="flex gap-2">
                    <input
                        type="text"
                        wire:model="barcodeInput"
                        placeholder="امسح الباركود..."
                        class="w-48 font-mono bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    />
                    <button type="submit" class="px-4 py-2 bg-emerald-700 text-white rounded-lg text-sm font-medium">
                        إضافة
                    </button>
                </form>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                @foreach($products as $product)
                    <button
                        wire:click="addToCart({{ $product->id }})"
                        class="text-right bg-white border border-slate-200 hover:border-emerald-600 rounded-xl p-3 transition"
                    >
                        <div class="text-xs text-slate-500 font-mono">{{ $product->sku }}</div>
                        <div class="font-semibold text-sm mt-1 truncate">{{ $product->name_ar }}</div>
                        <div class="flex items-center justify-between mt-3 text-sm tabular-nums">
                            <span class="font-bold text-emerald-700">{{ number_format($product->price_with_vat, 2) }} ر.س</span>
                            <span class="text-xs text-slate-500">المخزون: {{ $product->stock_qty }}</span>
                        </div>
                    </button>
                @endforeach
            </div>
        </div>

        {{-- سلة الفاتورة وإتمام الدفع --}}
        <div class="col-span-12 lg:col-span-4 bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between">
            <div class="space-y-3">
                <h2 class="font-bold text-base border-b border-slate-100 pb-3">فاتورة المبيعات الحالية</h2>
                @forelse($cart as $item)
                    <div class="flex items-center justify-between text-sm py-1.5 border-b border-slate-100">
                        <div>
                            <div class="font-medium">{{ $item['name_ar'] }}</div>
                            <div class="text-xs text-slate-500 tabular-nums">{{ $item['qty'] }} × {{ number_format($item['unit_price'], 2) }} ر.س</div>
                        </div>
                        <div class="font-semibold tabular-nums">
                            {{ number_format($item['qty'] * $item['unit_price'], 2) }}
                        </div>
                    </div>
                @empty
                    <p class="text-sm text-slate-400 py-8 text-center">السلة فارغة — امسح باركود أو اختر صنفاً</p>
                @endforelse
            </div>

            <div class="border-t border-slate-200 pt-4 space-y-2 text-sm tabular-nums">
                <div class="flex justify-between text-slate-600">
                    <span>المجموع الخاضع للضريبة</span>
                    <span>{{ number_format($this->totals['subtotal'], 2) }} ر.س</span>
                </div>
                <div class="flex justify-between text-slate-600">
                    <span>ضريبة القيمة المضافة (15%)</span>
                    <span>{{ number_format($this->totals['vat'], 2) }} ر.س</span>
                </div>
                <div class="flex justify-between font-bold text-base text-slate-900 pt-2 border-t border-slate-100">
                    <span>الإجمالي المستحق</span>
                    <span>{{ number_format($this->totals['grand_total'], 2) }} ر.س</span>
                </div>
                <button
                    wire:click="checkout"
                    class="w-full mt-3 py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold rounded-xl transition"
                >
                    إتمام الدفع وإصدار فاتورة ZATCA
                </button>
            </div>
        </div>
    </div>
</div>
`,
    },
    {
      path: 'app/Livewire/PurchaseManager.php',
      language: 'php',
      category: 'livewire',
      description_ar: 'مكون Livewire 3 لإدارة فواتير المشتريات والموردين وتحديث المخزون والتكلفة تلقائياً',
      description_en: 'Livewire 3 Purchases & Suppliers component that increments stock and updates product cost',
      content: `<?php

namespace App\\Livewire;

use App\\Models\\Product;
use App\\Models\\StockMovement;
use Illuminate\\Support\\Facades\\DB;
use Livewire\\Component;

class PurchaseManager extends Component
{
    public ?int $supplierId = null;
    public string $supplierInvoiceNo = '';
    public string $paymentStatus = 'paid';
    public array $lines = [];

    public function addLine(int $productId, int $qty, float $unitCost): void
    {
        $product = Product::findOrFail($productId);
        $this->lines[] = [
            'product_id' => $product->id,
            'name_ar' => $product->name_ar,
            'qty' => $qty,
            'unit_cost' => $unitCost,
            'tax_rate' => (float) $product->tax_rate,
        ];
    }

    public function savePurchase(): void
    {
        if (!$this->supplierId || empty($this->lines)) {
            return;
        }

        DB::transaction(function () {
            $subtotal = 0;
            $vat = 0;
            foreach ($this->lines as $line) {
                $lineSub = $line['qty'] * $line['unit_cost'];
                $subtotal += $lineSub;
                $vat += $lineSub * ($line['tax_rate'] / 100);
            }
            $grandTotal = round($subtotal + $vat, 2);
            $poNumber = 'PO-' . now()->format('Y') . '-' . str_pad((string) (DB::table('purchases')->count() + 1), 5, '0', STR_PAD_LEFT);

            DB::table('purchases')->insert([
                'purchase_number' => $poNumber,
                'supplier_id' => $this->supplierId,
                'supplier_invoice_no' => $this->supplierInvoiceNo,
                'payment_status' => $this->paymentStatus,
                'paid_amount' => $this->paymentStatus === 'paid' ? $grandTotal : 0,
                'subtotal' => round($subtotal, 2),
                'vat_total' => round($vat, 2),
                'grand_total' => $grandTotal,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            foreach ($this->lines as $line) {
                $product = Product::lockForUpdate()->findOrFail($line['product_id']);
                $product->increment('stock_qty', $line['qty']);
                $product->update(['cost_price' => $line['unit_cost']]);

                StockMovement::create([
                    'product_id' => $product->id,
                    'type' => 'purchase',
                    'qty_delta' => $line['qty'],
                    'balance_after' => $product->stock_qty,
                    'reference_no' => $poNumber,
                ]);
            }

            $this->lines = [];
            $this->supplierInvoiceNo = '';
        });
    }

    public function render()
    {
        return view('livewire.purchase-manager', [
            'purchases' => DB::table('purchases')->latest()->get(),
            'suppliers' => DB::table('suppliers')->get(),
            'products' => Product::where('active', true)->get(),
        ]);
    }
}
`,
    },
    {
      path: 'routes/web.php',
      language: 'php',
      category: 'config',
      description_ar: 'مسارات الويب لمكونات Livewire الرئيسية في النظام',
      description_en: 'Laravel web routes binding POS, Inventory, Purchases, and ZATCA Onboarding components',
      content: `<?php

use App\\Livewire\\InventoryManager;
use App\\Livewire\\PosTerminal;
use App\\Livewire\\PurchaseManager;
use App\\Livewire\\ZatcaOnboarding;
use Illuminate\\Support\\Facades\\Route;

Route::get('/', PosTerminal::class)->name('pos.terminal');
Route::get('/inventory', InventoryManager::class)->name('inventory.index');
Route::get('/purchases', PurchaseManager::class)->name('purchases.index');
Route::get('/zatca-onboarding', ZatcaOnboarding::class)->name('zatca.onboarding');
`,
    },
  ];
}

export async function buildLaravelZipBuffer(org: OrganizationSettings): Promise<Buffer> {
  const zip = new JSZip();
  const files = generateLaravelFiles(org);

  for (const file of files) {
    zip.file(`mizan-laravel-pos/${file.path}`, file.content);
  }

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
