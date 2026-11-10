// Local seed: categories, a commission rule, the platform ledger accounts and
// three sample makers in Trichy with a few products. Sample data only.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const categories = [
  { slug: 'cakes', nameEn: 'Cakes and bakes', nameTa: 'கேக் மற்றும் பேக்கரி' },
  { slug: 'terracotta', nameEn: 'Terracotta', nameTa: 'சுடுமண்' },
  { slug: 'jewellery', nameEn: 'Jewellery', nameTa: 'நகைகள்' },
  { slug: 'henna', nameEn: 'Henna', nameTa: 'மருதாணி' },
  { slug: 'plants', nameEn: 'Plants', nameTa: 'செடிகள்' },
];

const ledgerAccounts = [
  { code: 'provider_clearing', name: 'Razorpay clearing', type: 'asset' as const },
  { code: 'platform_commission', name: 'Platform commission revenue', type: 'revenue' as const },
  { code: 'gateway_fees', name: 'Payment gateway fees', type: 'expense' as const },
  { code: 'gst_tcs_payable', name: 'GST TCS payable (Sec 52)', type: 'liability' as const },
  { code: 'tds_194o_payable', name: 'TDS 194-O payable', type: 'liability' as const },
  { code: 'refunds_payable', name: 'Refunds payable to buyers', type: 'liability' as const },
];

const sellers = [
  {
    phone: '+919000000001',
    name: 'Meena',
    handle: 'meenaclaystudio',
    businessName: 'Meena Clay Studio',
    category: 'terracotta',
    bio: 'Third-generation potter. Diyas, planters and kitchen pots, shaped and fired in Woraiyur.',
    area: 'Woraiyur',
    pincode: '620003',
    lng: 78.6795,
    lat: 10.8285,
    localDelivery: true,
    products: [
      {
        title: 'Terracotta diya set, 6 pieces',
        titleTa: 'மண் அகல் விளக்கு, 6',
        pricePaise: 45000,
        stock: 12,
      },
      {
        title: 'Hanging planter, small',
        titleTa: 'தொங்கும் செடி தொட்டி',
        pricePaise: 22000,
        stock: 8,
      },
      {
        title: 'Clay water pot, 5 litre',
        titleTa: 'மண் பானை, 5 லிட்டர்',
        pricePaise: 48000,
        stock: 5,
      },
    ],
  },
  {
    phone: '+919000000002',
    name: 'Sabitha',
    handle: 'sweetboxtrichy',
    businessName: 'Sweet Box',
    category: 'cakes',
    bio: 'Home bakery in Thillai Nagar. Custom cakes with two days notice.',
    area: 'Thillai Nagar',
    pincode: '620018',
    lng: 78.6847,
    lat: 10.8264,
    localDelivery: true,
    products: [
      {
        title: 'Chocolate truffle cake, 1 kg',
        titleTa: 'சாக்லேட் கேக், 1 கிலோ',
        pricePaise: 90000,
        stock: 4,
      },
      {
        title: 'Millet cookies, box of 12',
        titleTa: 'சிறுதானிய குக்கீஸ், 12',
        pricePaise: 25000,
        stock: 20,
      },
    ],
  },
  {
    phone: '+919000000003',
    name: 'Abirami',
    handle: 'abihenna',
    businessName: 'Abi Henna',
    category: 'henna',
    bio: 'Bridal and festive henna. Natural cones made fresh every week.',
    area: 'Srirangam',
    pincode: '620006',
    lng: 78.6939,
    lat: 10.8624,
    localDelivery: false,
    products: [
      {
        title: 'Natural henna cones, pack of 10',
        titleTa: 'இயற்கை மருதாணி கோன், 10',
        pricePaise: 30000,
        stock: 30,
      },
    ],
  },
];

async function main(): Promise<void> {
  for (const [position, c] of categories.entries()) {
    await prisma.category.upsert({
      where: { slug: c.slug },
      update: { nameEn: c.nameEn, nameTa: c.nameTa, position },
      create: { ...c, position },
    });
  }

  for (const a of ledgerAccounts) {
    await prisma.ledgerAccount.upsert({ where: { code: a.code }, update: {}, create: a });
  }

  const ruleCount = await prisma.commissionRule.count();
  if (ruleCount === 0) {
    await prisma.commissionRule.create({
      data: {
        name: 'Pilot default 5%',
        rateBps: 500,
        validFrom: new Date('2026-11-01T00:00:00+05:30'),
      },
    });
  }

  for (const s of sellers) {
    const category = await prisma.category.findUniqueOrThrow({ where: { slug: s.category } });
    const user = await prisma.user.upsert({
      where: { phone: s.phone },
      update: {},
      create: {
        phone: s.phone,
        firebaseUid: `seed-${s.handle}`,
        name: s.name,
        roles: ['buyer', 'seller'],
        city: 'Trichy',
      },
    });
    const profile = await prisma.sellerProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        handle: s.handle,
        businessName: s.businessName,
        storyEn: s.bio,
        areaName: s.area,
        categoryId: category.id,
        city: 'Trichy',
        pincode: s.pincode,
        pickupAddressLine: `Sample address, ${s.area}, Trichy`,
        openingHours: {
          mon: [{ open: '09:00', close: '19:00' }],
          tue: [{ open: '09:00', close: '19:00' }],
          wed: [{ open: '09:00', close: '19:00' }],
          thu: [{ open: '09:00', close: '19:00' }],
          fri: [{ open: '09:00', close: '19:00' }],
          sat: [{ open: '10:00', close: '14:00' }],
        },
        status: 'active',
        localDelivery: s.localDelivery,
        verificationStatus: 'verified',
        verifiedAt: new Date(),
      },
    });
    await prisma.$executeRaw`
      UPDATE seller_profiles
      SET location = ST_SetSRID(ST_MakePoint(${s.lng}, ${s.lat}), 4326)::geography
      WHERE id = ${profile.id}::uuid`;

    await prisma.ledgerAccount.upsert({
      where: { code: `seller_payable:${profile.id}` },
      update: {},
      create: {
        code: `seller_payable:${profile.id}`,
        name: `Payable to ${s.businessName}`,
        type: 'liability',
        sellerId: profile.id,
      },
    });

    for (const [i, p] of s.products.entries()) {
      const sku = `${s.handle}-${i + 1}`;
      await prisma.product.upsert({
        where: { sellerId_sku: { sellerId: profile.id, sku } },
        update: {},
        create: {
          ...p,
          sku,
          sellerId: profile.id,
          categoryId: category.id,
          fulfilmentModes: s.localDelivery ? ['pickup', 'local_delivery'] : ['pickup'],
          status: 'active',
          moderationStatus: 'live',
        },
      });
    }
  }

  const counts = {
    categories: await prisma.category.count(),
    sellers: await prisma.sellerProfile.count(),
    products: await prisma.product.count(),
    ledgerAccounts: await prisma.ledgerAccount.count(),
  };
  console.log('Seeded', counts);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
