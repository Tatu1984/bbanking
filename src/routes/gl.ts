import { Router } from 'express';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// GET /api/gl - List GL entries
router.get('/', async (req, res) => {
  const { page = '1', limit = '20', type, status, startDate, endDate, accountCode } = req.query;
  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);

  const where: any = {};
  if (type) where.type = type;
  if (status) where.postingStatus = status;
  if (accountCode) where.accountCode = { contains: accountCode as string };
  if (startDate && endDate) {
    where.postingDate = {
      gte: new Date(startDate as string),
      lte: new Date(endDate as string),
    };
  }

  const [entries, total] = await Promise.all([
    prisma.gLEntry.findMany({
      where,
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
      orderBy: { postingDate: 'desc' },
    }),
    prisma.gLEntry.count({ where }),
  ]);

  // Calculate totals
  const totals = await prisma.gLEntry.groupBy({
    by: ['type'],
    where: { ...where, postingStatus: 'posted' },
    _sum: { amount: true },
  });

  const totalDebits = totals.find(t => t.type === 'debit')?._sum.amount?.toNumber() || 0;
  const totalCredits = totals.find(t => t.type === 'credit')?._sum.amount?.toNumber() || 0;

  res.json({
    success: true,
    data: entries,
    summary: { totalDebits, totalCredits, balance: totalCredits - totalDebits },
    pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
  });
});

// GET /api/gl/:id
router.get('/:id', async (req, res) => {
  const entry = await prisma.gLEntry.findUnique({
    where: { id: req.params.id },
    include: { transaction: true },
  });

  if (!entry) throw new AppError('GL Entry not found', 404);
  res.json({ success: true, data: entry });
});

// POST /api/gl - Create GL entry
router.post('/', authorize('admin', 'manager'), async (req: AuthRequest, res) => {
  const { accountCode, accountName, type, amount, description, transactionRef, postingDate, branch } = req.body;

  const entryNumber = `GL${Date.now()}`;

  const entry = await prisma.gLEntry.create({
    data: {
      entryNumber,
      accountCode,
      accountName,
      type,
      amount,
      description,
      transactionRef,
      postingDate: new Date(postingDate),
      branch,
    },
  });

  res.status(201).json({ success: true, data: entry });
});

// PATCH /api/gl/:id/post - Post entry
router.patch('/:id/post', authorize('admin', 'manager'), async (req: AuthRequest, res) => {
  const entry = await prisma.gLEntry.findUnique({ where: { id: req.params.id } });
  if (!entry) throw new AppError('GL Entry not found', 404);
  if (entry.postingStatus !== 'pending') throw new AppError('Entry is not pending', 400);

  const updated = await prisma.gLEntry.update({
    where: { id: req.params.id },
    data: {
      postingStatus: 'posted',
      postedBy: req.user!.id,
      postedAt: new Date(),
    },
  });

  res.json({ success: true, data: updated });
});

// PATCH /api/gl/:id/reverse - Reverse entry
router.patch('/:id/reverse', authorize('admin', 'manager'), async (req: AuthRequest, res) => {
  const { reason } = req.body;
  if (!reason) throw new AppError('Reversal reason is required', 400);

  const entry = await prisma.gLEntry.findUnique({ where: { id: req.params.id } });
  if (!entry) throw new AppError('GL Entry not found', 404);
  if (entry.postingStatus !== 'posted') throw new AppError('Only posted entries can be reversed', 400);

  const updated = await prisma.gLEntry.update({
    where: { id: req.params.id },
    data: {
      postingStatus: 'reversed',
      reversedBy: req.user!.id,
      reversedAt: new Date(),
      reversalReason: reason,
    },
  });

  res.json({ success: true, data: updated });
});

// POST /api/gl/batch-post - Batch post entries
router.post('/batch-post', authorize('admin', 'manager'), async (req: AuthRequest, res) => {
  const { entryIds } = req.body;

  if (!entryIds || !Array.isArray(entryIds)) {
    throw new AppError('Entry IDs array is required', 400);
  }

  const result = await prisma.gLEntry.updateMany({
    where: {
      id: { in: entryIds },
      postingStatus: 'pending',
    },
    data: {
      postingStatus: 'posted',
      postedBy: req.user!.id,
      postedAt: new Date(),
    },
  });

  res.json({ success: true, data: { count: result.count } });
});

// GET /api/gl/trial-balance
router.get('/reports/trial-balance', async (req, res) => {
  const { asOfDate } = req.query;

  const entries = await prisma.gLEntry.groupBy({
    by: ['accountCode', 'accountName', 'type'],
    where: {
      postingStatus: 'posted',
      postingDate: { lte: asOfDate ? new Date(asOfDate as string) : new Date() },
    },
    _sum: { amount: true },
  });

  // Transform to trial balance format
  const accountMap = new Map();
  for (const entry of entries) {
    const key = entry.accountCode;
    if (!accountMap.has(key)) {
      accountMap.set(key, { accountCode: entry.accountCode, accountName: entry.accountName, debit: 0, credit: 0 });
    }
    const account = accountMap.get(key);
    if (entry.type === 'debit') {
      account.debit += entry._sum.amount?.toNumber() || 0;
    } else {
      account.credit += entry._sum.amount?.toNumber() || 0;
    }
  }

  const trialBalance = Array.from(accountMap.values());
  const totalDebits = trialBalance.reduce((sum, a) => sum + a.debit, 0);
  const totalCredits = trialBalance.reduce((sum, a) => sum + a.credit, 0);

  res.json({
    success: true,
    data: {
      accounts: trialBalance,
      totals: { debit: totalDebits, credit: totalCredits, balanced: totalDebits === totalCredits },
    },
  });
});

export default router;
