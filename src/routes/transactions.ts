import { Router } from 'express';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { Prisma } from '@prisma/client';

const router = Router();
router.use(authenticate);

// GET /api/transactions
router.get('/', async (req: AuthRequest, res) => {
  const { page = '1', limit = '20', type, mode, status, startDate, endDate } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);

  const where: any = {};
  if (type) where.type = type;
  if (mode) where.mode = mode;
  if (status) where.status = status;
  if (startDate && endDate) {
    where.createdAt = {
      gte: new Date(startDate as string),
      lte: new Date(endDate as string),
    };
  }

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
      orderBy: { createdAt: 'desc' },
      include: {
        fromAccount: {
          select: { accountNumber: true, customer: { select: { firstName: true, lastName: true, companyName: true } } },
        },
        toAccount: {
          select: { accountNumber: true, customer: { select: { firstName: true, lastName: true, companyName: true } } },
        },
      },
    }),
    prisma.transaction.count({ where }),
  ]);

  res.json({
    success: true,
    data: transactions,
    pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
  });
});

// GET /api/transactions/:id
router.get('/:id', async (req, res) => {
  const transaction = await prisma.transaction.findUnique({
    where: { id: req.params.id },
    include: {
      fromAccount: { include: { customer: true } },
      toAccount: { include: { customer: true } },
      glEntries: true,
    },
  });

  if (!transaction) {
    throw new AppError('Transaction not found', 404);
  }

  res.json({ success: true, data: transaction });
});

// POST /api/transactions/internal - Internal transfer
router.post('/internal', authorize('admin', 'manager', 'officer', 'teller'), async (req: AuthRequest, res) => {
  const { fromAccountId, toAccountId, amount, description } = req.body;

  if (!fromAccountId || !toAccountId || !amount) {
    throw new AppError('From account, to account, and amount are required', 400);
  }

  if (fromAccountId === toAccountId) {
    throw new AppError('Cannot transfer to the same account', 400);
  }

  const [fromAccount, toAccount] = await Promise.all([
    prisma.account.findUnique({ where: { id: fromAccountId } }),
    prisma.account.findUnique({ where: { id: toAccountId } }),
  ]);

  if (!fromAccount) throw new AppError('Source account not found', 404);
  if (!toAccount) throw new AppError('Destination account not found', 404);
  if (fromAccount.status !== 'active') throw new AppError('Source account is not active', 400);
  if (toAccount.status !== 'active') throw new AppError('Destination account is not active', 400);

  const amountDecimal = new Prisma.Decimal(amount);
  if (fromAccount.availableBalance.lessThan(amountDecimal)) {
    throw new AppError('Insufficient balance', 400);
  }

  // Execute transfer in a transaction
  const result = await prisma.$transaction(async (tx) => {
    // Debit from source
    const updatedFrom = await tx.account.update({
      where: { id: fromAccountId },
      data: {
        balance: { decrement: amountDecimal },
        availableBalance: { decrement: amountDecimal },
      },
    });

    // Credit to destination
    const updatedTo = await tx.account.update({
      where: { id: toAccountId },
      data: {
        balance: { increment: amountDecimal },
        availableBalance: { increment: amountDecimal },
      },
    });

    // Create debit transaction
    const debitTx = await tx.transaction.create({
      data: {
        fromAccountId,
        toAccountId,
        type: 'debit',
        amount: amountDecimal,
        mode: 'internal',
        status: 'completed',
        description,
        balanceAfter: updatedFrom.balance,
        processedAt: new Date(),
      },
    });

    // Create credit transaction
    const creditTx = await tx.transaction.create({
      data: {
        fromAccountId,
        toAccountId,
        type: 'credit',
        amount: amountDecimal,
        mode: 'internal',
        status: 'completed',
        description,
        reference: debitTx.transactionId,
        balanceAfter: updatedTo.balance,
        processedAt: new Date(),
      },
    });

    return { debitTx, creditTx };
  });

  await prisma.auditLog.create({
    data: {
      userId: req.user!.id,
      userName: req.user!.email,
      action: 'create',
      entity: 'transaction',
      entityId: result.debitTx.id,
      entityName: `Internal Transfer: ${amount}`,
      status: 'success',
    },
  });

  res.status(201).json({ success: true, data: result });
});

// POST /api/transactions/neft - NEFT transfer
router.post('/neft', authorize('admin', 'manager', 'officer', 'teller'), async (req: AuthRequest, res) => {
  const { fromAccountId, beneficiaryAccount, beneficiaryName, beneficiaryBank, beneficiaryIfsc, amount, description } = req.body;

  if (!fromAccountId || !beneficiaryAccount || !beneficiaryName || !beneficiaryIfsc || !amount) {
    throw new AppError('Missing required fields for NEFT transfer', 400);
  }

  const fromAccount = await prisma.account.findUnique({ where: { id: fromAccountId } });
  if (!fromAccount) throw new AppError('Source account not found', 404);
  if (fromAccount.status !== 'active') throw new AppError('Source account is not active', 400);

  const amountDecimal = new Prisma.Decimal(amount);
  if (fromAccount.availableBalance.lessThan(amountDecimal)) {
    throw new AppError('Insufficient balance', 400);
  }

  const result = await prisma.$transaction(async (tx) => {
    const updatedFrom = await tx.account.update({
      where: { id: fromAccountId },
      data: {
        balance: { decrement: amountDecimal },
        availableBalance: { decrement: amountDecimal },
      },
    });

    const transaction = await tx.transaction.create({
      data: {
        fromAccountId,
        type: 'debit',
        amount: amountDecimal,
        mode: 'neft',
        status: 'pending', // NEFT processed in batches
        description,
        beneficiaryName,
        beneficiaryAccount,
        beneficiaryBank,
        beneficiaryIfsc,
        balanceAfter: updatedFrom.balance,
      },
    });

    return transaction;
  });

  res.status(201).json({ success: true, data: result });
});

// POST /api/transactions/imps - IMPS transfer
router.post('/imps', authorize('admin', 'manager', 'officer', 'teller'), async (req: AuthRequest, res) => {
  const { fromAccountId, beneficiaryAccount, beneficiaryName, beneficiaryIfsc, amount, description } = req.body;

  if (!fromAccountId || !beneficiaryAccount || !beneficiaryName || !beneficiaryIfsc || !amount) {
    throw new AppError('Missing required fields for IMPS transfer', 400);
  }

  const amountDecimal = new Prisma.Decimal(amount);
  if (amountDecimal.greaterThan(500000)) {
    throw new AppError('IMPS maximum limit is ₹5,00,000', 400);
  }

  const fromAccount = await prisma.account.findUnique({ where: { id: fromAccountId } });
  if (!fromAccount) throw new AppError('Source account not found', 404);
  if (fromAccount.status !== 'active') throw new AppError('Source account is not active', 400);

  if (fromAccount.availableBalance.lessThan(amountDecimal)) {
    throw new AppError('Insufficient balance', 400);
  }

  const result = await prisma.$transaction(async (tx) => {
    const updatedFrom = await tx.account.update({
      where: { id: fromAccountId },
      data: {
        balance: { decrement: amountDecimal },
        availableBalance: { decrement: amountDecimal },
      },
    });

    const transaction = await tx.transaction.create({
      data: {
        fromAccountId,
        type: 'debit',
        amount: amountDecimal,
        mode: 'imps',
        status: 'completed', // IMPS is instant
        description,
        beneficiaryName,
        beneficiaryAccount,
        beneficiaryIfsc,
        balanceAfter: updatedFrom.balance,
        processedAt: new Date(),
      },
    });

    return transaction;
  });

  res.status(201).json({ success: true, data: result });
});

export default router;
