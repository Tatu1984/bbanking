import { Router } from 'express';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();

// Apply auth to all routes
router.use(authenticate);

// GET /api/customers - List all customers
router.get('/', async (req: AuthRequest, res) => {
  const { page = '1', limit = '20', search, type, kycStatus, riskCategory } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);
  const skip = (pageNum - 1) * limitNum;

  const where: any = {};

  if (search) {
    where.OR = [
      { firstName: { contains: search as string, mode: 'insensitive' } },
      { lastName: { contains: search as string, mode: 'insensitive' } },
      { companyName: { contains: search as string, mode: 'insensitive' } },
      { email: { contains: search as string, mode: 'insensitive' } },
      { phone: { contains: search as string } },
      { customerId: { contains: search as string } },
    ];
  }

  if (type) where.type = type;
  if (kycStatus) where.kycStatus = kycStatus;
  if (riskCategory) where.riskCategory = riskCategory;

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      skip,
      take: limitNum,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { accounts: true, loans: true },
        },
      },
    }),
    prisma.customer.count({ where }),
  ]);

  res.json({
    success: true,
    data: customers,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

// GET /api/customers/:id - Get single customer
router.get('/:id', async (req, res) => {
  const customer = await prisma.customer.findUnique({
    where: { id: req.params.id },
    include: {
      accounts: {
        orderBy: { createdAt: 'desc' },
      },
      loans: {
        orderBy: { createdAt: 'desc' },
      },
      cards: {
        orderBy: { createdAt: 'desc' },
      },
      kycDocuments: true,
      beneficiaries: {
        where: { isActive: true },
      },
    },
  });

  if (!customer) {
    throw new AppError('Customer not found', 404);
  }

  res.json({ success: true, data: customer });
});

// POST /api/customers - Create customer
router.post('/', authorize('admin', 'manager', 'officer'), async (req: AuthRequest, res) => {
  const {
    type,
    firstName,
    lastName,
    companyName,
    cin,
    email,
    phone,
    pan,
    aadhaar,
    address,
    city,
    state,
    pincode,
    dateOfBirth,
    riskCategory,
  } = req.body;

  // Validate required fields
  if (!type || !email || !phone || !address) {
    throw new AppError('Type, email, phone, and address are required', 400);
  }

  if (type === 'individual' && (!firstName || !lastName)) {
    throw new AppError('First name and last name are required for individual customers', 400);
  }

  if (type === 'corporate' && !companyName) {
    throw new AppError('Company name is required for corporate customers', 400);
  }

  // Check for duplicate email
  const existingCustomer = await prisma.customer.findUnique({
    where: { email },
  });

  if (existingCustomer) {
    throw new AppError('Customer with this email already exists', 409);
  }

  const customer = await prisma.customer.create({
    data: {
      type,
      firstName,
      lastName,
      companyName,
      cin,
      email,
      phone,
      pan,
      aadhaar,
      address,
      city,
      state,
      pincode,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      riskCategory: riskCategory || 'low',
    },
  });

  // Create audit log
  await prisma.auditLog.create({
    data: {
      userId: req.user!.id,
      userName: req.user!.email,
      action: 'create',
      entity: 'customer',
      entityId: customer.id,
      entityName: type === 'individual'
        ? `${firstName} ${lastName}`
        : companyName,
      newValues: customer as any,
      status: 'success',
    },
  });

  res.status(201).json({ success: true, data: customer });
});

// PATCH /api/customers/:id - Update customer
router.patch('/:id', authorize('admin', 'manager', 'officer'), async (req: AuthRequest, res) => {
  const { id } = req.params;
  const updateData = req.body;

  const existingCustomer = await prisma.customer.findUnique({
    where: { id },
  });

  if (!existingCustomer) {
    throw new AppError('Customer not found', 404);
  }

  // Don't allow changing customer type
  delete updateData.type;
  delete updateData.customerId;

  if (updateData.dateOfBirth) {
    updateData.dateOfBirth = new Date(updateData.dateOfBirth);
  }

  const customer = await prisma.customer.update({
    where: { id },
    data: updateData,
  });

  // Create audit log
  await prisma.auditLog.create({
    data: {
      userId: req.user!.id,
      userName: req.user!.email,
      action: 'update',
      entity: 'customer',
      entityId: customer.id,
      entityName: customer.type === 'individual'
        ? `${customer.firstName} ${customer.lastName}`
        : customer.companyName || '',
      oldValues: existingCustomer as any,
      newValues: customer as any,
      status: 'success',
    },
  });

  res.json({ success: true, data: customer });
});

// PATCH /api/customers/:id/kyc - Update KYC status
router.patch('/:id/kyc', authorize('admin', 'manager'), async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { kycStatus } = req.body;

  if (!['pending', 'verified', 'expired', 'rejected'].includes(kycStatus)) {
    throw new AppError('Invalid KYC status', 400);
  }

  const customer = await prisma.customer.update({
    where: { id },
    data: { kycStatus },
  });

  res.json({ success: true, data: customer });
});

// POST /api/customers/:id/documents - Add KYC document
router.post('/:id/documents', authorize('admin', 'manager', 'officer'), async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { documentType, documentNumber, documentUrl, expiryDate } = req.body;

  const customer = await prisma.customer.findUnique({ where: { id } });

  if (!customer) {
    throw new AppError('Customer not found', 404);
  }

  const document = await prisma.kYCDocument.create({
    data: {
      customerId: id,
      documentType,
      documentNumber,
      documentUrl,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
    },
  });

  res.status(201).json({ success: true, data: document });
});

// GET /api/customers/:id/accounts - Get customer accounts
router.get('/:id/accounts', async (req, res) => {
  const accounts = await prisma.account.findMany({
    where: { customerId: req.params.id },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ success: true, data: accounts });
});

// GET /api/customers/:id/transactions - Get customer transactions
router.get('/:id/transactions', async (req, res) => {
  const { page = '1', limit = '20' } = req.query;
  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);

  const accounts = await prisma.account.findMany({
    where: { customerId: req.params.id },
    select: { id: true },
  });

  const accountIds = accounts.map(a => a.id);

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        OR: [
          { fromAccountId: { in: accountIds } },
          { toAccountId: { in: accountIds } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
    }),
    prisma.transaction.count({
      where: {
        OR: [
          { fromAccountId: { in: accountIds } },
          { toAccountId: { in: accountIds } },
        ],
      },
    }),
  ]);

  res.json({
    success: true,
    data: transactions,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

export default router;
