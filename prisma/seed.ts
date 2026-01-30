import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create admin user
  const adminPassword = await bcrypt.hash('admin123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@cbs.com' },
    update: {},
    create: {
      employeeId: 'EMP001',
      name: 'System Administrator',
      email: 'admin@cbs.com',
      password: adminPassword,
      role: 'admin',
      branch: 'HEAD_OFFICE',
      department: 'IT',
    },
  });
  console.log('✅ Created admin user:', admin.email);

  // Create test officer
  const officerPassword = await bcrypt.hash('officer123', 12);
  const officer = await prisma.user.upsert({
    where: { email: 'officer@cbs.com' },
    update: {},
    create: {
      employeeId: 'EMP002',
      name: 'Test Officer',
      email: 'officer@cbs.com',
      password: officerPassword,
      role: 'officer',
      branch: 'MAIN_BRANCH',
      department: 'Operations',
    },
  });
  console.log('✅ Created officer user:', officer.email);

  // Create branches
  const headOffice = await prisma.branch.upsert({
    where: { code: 'HEAD' },
    update: {},
    create: {
      code: 'HEAD',
      name: 'Head Office',
      address: '123 Financial District',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400001',
      phone: '+91-22-12345678',
      ifscCode: 'CBS00000001',
    },
  });

  const mainBranch = await prisma.branch.upsert({
    where: { code: 'MAIN' },
    update: {},
    create: {
      code: 'MAIN',
      name: 'Main Branch',
      address: '456 Commercial Street',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400002',
      phone: '+91-22-87654321',
      ifscCode: 'CBS00000002',
    },
  });
  console.log('✅ Created branches');

  // Create products
  const products = [
    { code: 'SAV001', name: 'Regular Savings', type: 'savings', description: 'Basic savings account with 3.5% interest', interestRate: 3.5, minBalance: 1000 },
    { code: 'SAV002', name: 'Premium Savings', type: 'savings', description: 'Premium savings with higher interest', interestRate: 4.5, minBalance: 25000 },
    { code: 'CUR001', name: 'Business Current', type: 'current', description: 'Current account for businesses', minBalance: 10000 },
    { code: 'FD001', name: 'Fixed Deposit', type: 'fd', description: 'Term deposit with guaranteed returns', interestRate: 7.0, tenureMin: 12, tenureMax: 60 },
    { code: 'HL001', name: 'Home Loan', type: 'loan', description: 'Housing loan up to 90% LTV', interestRate: 8.5, tenureMin: 60, tenureMax: 360 },
    { code: 'PL001', name: 'Personal Loan', type: 'loan', description: 'Unsecured personal loan', interestRate: 12.0, tenureMin: 12, tenureMax: 60 },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: { code: product.code },
      update: {},
      create: product,
    });
  }
  console.log('✅ Created products');

  // Create sample customers
  const customer1 = await prisma.customer.upsert({
    where: { email: 'john.doe@example.com' },
    update: {},
    create: {
      type: 'individual',
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe@example.com',
      phone: '+91-9876543210',
      pan: 'ABCDE1234F',
      address: '789 Residential Area, Andheri',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400053',
      dateOfBirth: new Date('1985-06-15'),
      kycStatus: 'verified',
      riskCategory: 'low',
    },
  });

  const customer2 = await prisma.customer.upsert({
    where: { email: 'contact@acmecorp.com' },
    update: {},
    create: {
      type: 'corporate',
      companyName: 'ACME Corporation',
      cin: 'U12345MH2010PTC123456',
      email: 'contact@acmecorp.com',
      phone: '+91-22-44556677',
      pan: 'AAACA1234A',
      address: '100 Business Park, BKC',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400051',
      kycStatus: 'verified',
      riskCategory: 'medium',
    },
  });
  console.log('✅ Created sample customers');

  // Create accounts for customers
  const account1 = await prisma.account.upsert({
    where: { accountNumber: '100100001001' },
    update: {},
    create: {
      accountNumber: '100100001001',
      customerId: customer1.id,
      type: 'savings',
      balance: 150000,
      availableBalance: 150000,
      branch: 'MAIN_BRANCH',
      ifscCode: 'CBS00000002',
      status: 'active',
    },
  });

  const account2 = await prisma.account.upsert({
    where: { accountNumber: '100100001002' },
    update: {},
    create: {
      accountNumber: '100100001002',
      customerId: customer2.id,
      type: 'current',
      balance: 5000000,
      availableBalance: 5000000,
      branch: 'MAIN_BRANCH',
      ifscCode: 'CBS00000002',
      status: 'active',
    },
  });
  console.log('✅ Created sample accounts');

  // Create sample transactions
  await prisma.transaction.createMany({
    data: [
      {
        toAccountId: account1.id,
        type: 'credit',
        amount: 50000,
        mode: 'neft',
        status: 'completed',
        description: 'Salary credit',
        balanceAfter: 150000,
        processedAt: new Date(),
      },
      {
        fromAccountId: account1.id,
        type: 'debit',
        amount: 5000,
        mode: 'upi',
        status: 'completed',
        description: 'Online shopping',
        balanceAfter: 145000,
        processedAt: new Date(),
      },
    ],
    skipDuplicates: true,
  });
  console.log('✅ Created sample transactions');

  // Create sample GL entries
  await prisma.gLEntry.createMany({
    data: [
      {
        entryNumber: 'GL000001',
        accountCode: '1001',
        accountName: 'Cash in Hand',
        type: 'debit',
        amount: 100000,
        description: 'Opening cash balance',
        postingDate: new Date(),
        postingStatus: 'posted',
        postedAt: new Date(),
        branch: 'MAIN_BRANCH',
      },
      {
        entryNumber: 'GL000002',
        accountCode: '2001',
        accountName: 'Customer Deposits',
        type: 'credit',
        amount: 100000,
        description: 'Opening deposit liability',
        postingDate: new Date(),
        postingStatus: 'posted',
        postedAt: new Date(),
        branch: 'MAIN_BRANCH',
      },
    ],
    skipDuplicates: true,
  });
  console.log('✅ Created sample GL entries');

  console.log('🎉 Seeding completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
