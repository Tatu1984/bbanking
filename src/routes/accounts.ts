import { Router } from 'express';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// Helper to generate account number
const generateAccountNumber = () => {
  const prefix = '1001';
  const random = Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
  return prefix + random;
};

// GET /api/accounts
router.get('/', async (req: AuthRequest, res) => {
  const { page = '1', limit = '20', search, type, status, customerId } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);

  const where: any = {};
  if (search) {
    where.OR = [
      { accountNumber: { contains: search as string } },
    ];
  }
  if (type) where.type = type;
  if (status) where.status = status;
  if (customerId) where.customerId = customerId;

  const [accounts, total] = await Promise.all([
    prisma.account.findMany({
      where,
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: {
          select: {
            id: true,
            customerId: true,
            type: true,
            firstName: true,
            lastName: true,
            companyName: true,
            email: true,
          },
        },
      },
    }),
    prisma.account.count({ where }),
  ]);

  res.json({
    success: true,
    data: accounts,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

// GET /api/accounts/:id
router.get('/:id', async (req, res) => {
  const account = await prisma.account.findUnique({
    where: { id: req.params.id },
    include: {
      customer: true,
      transactionsFrom: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      transactionsTo: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });

  if (!account) {
    throw new AppError('Account not found', 404);
  }

  res.json({ success: true, data: account });
});

// POST /api/accounts
router.post('/', authorize('admin', 'manager', 'officer'), async (req: AuthRequest, res) => {
  const {
    customerId,
    type,
    branch,
    currency = 'INR',
    initialDeposit = 0,
    interestRate,
    tenureMonths,
    maturityDate,
    nominationName,
    nominationRelation,
  } = req.body;

  if (!customerId || !type || !branch) {
    throw new AppError('Customer ID, type, and branch are required', 400);
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  });

  if (!customer) {
    throw new AppError('Customer not found', 404);
  }

  const accountNumber = generateAccountNumber();

  const account = await prisma.account.create({
    data: {
      accountNumber,
      customerId,
      type,
      branch,
      currency,
      balance: initialDeposit,
      availableBalance: initialDeposit,
      interestRate,
      tenureMonths,
      maturityDate: maturityDate ? new Date(maturityDate) : null,
      nominationName,
      nominationRelation,
    },
    include: { customer: true },
  });

  // Create initial deposit transaction if any
  if (initialDeposit > 0) {
    await prisma.transaction.create({
      data: {
        toAccountId: account.id,
        type: 'credit',
        amount: initialDeposit,
        mode: 'cash',
        status: 'completed',
        description: 'Initial deposit',
        balanceAfter: initialDeposit,
        processedAt: new Date(),
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      userId: req.user!.id,
      userName: req.user!.email,
      action: 'create',
      entity: 'account',
      entityId: account.id,
      entityName: accountNumber,
      newValues: account as any,
      status: 'success',
    },
  });

  res.status(201).json({ success: true, data: account });
});

// PATCH /api/accounts/:id/status
router.patch('/:id/status', authorize('admin', 'manager'), async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['active', 'dormant', 'frozen', 'closed'].includes(status)) {
    throw new AppError('Invalid status', 400);
  }

  const account = await prisma.account.update({
    where: { id },
    data: {
      status,
      ...(status === 'closed' && { closedAt: new Date() }),
    },
  });

  res.json({ success: true, data: account });
});

// GET /api/accounts/:id/transactions
router.get('/:id/transactions', async (req, res) => {
  const { page = '1', limit = '20', type } = req.query;
  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);

  const where: any = {
    OR: [
      { fromAccountId: req.params.id },
      { toAccountId: req.params.id },
    ],
  };

  if (type) where.type = type;

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
    }),
    prisma.transaction.count({ where }),
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

// GET /api/accounts/:id/statement
router.get('/:id/statement', async (req, res) => {
  const { startDate, endDate } = req.query;

  const account = await prisma.account.findUnique({
    where: { id: req.params.id },
    include: { customer: true },
  });

  if (!account) {
    throw new AppError('Account not found', 404);
  }

  const where: any = {
    OR: [
      { fromAccountId: req.params.id },
      { toAccountId: req.params.id },
    ],
    status: 'completed',
  };

  if (startDate && endDate) {
    where.createdAt = {
      gte: new Date(startDate as string),
      lte: new Date(endDate as string),
    };
  }

  const transactions = await prisma.transaction.findMany({
    where,
    orderBy: { createdAt: 'asc' },
  });

  res.json({
    success: true,
    data: {
      account,
      transactions,
      period: { startDate, endDate },
    },
  });
});

export default router;
