import { Router } from 'express';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// Generate masked card number
const maskCardNumber = (cardNumber: string) => {
  return `**** **** **** ${cardNumber.slice(-4)}`;
};

// GET /api/cards
router.get('/', async (req, res) => {
  const { page = '1', limit = '20', type, status, customerId } = req.query;
  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);

  const where: any = {};
  if (type) where.type = type;
  if (status) where.status = status;
  if (customerId) where.customerId = customerId;

  const [cards, total] = await Promise.all([
    prisma.card.findMany({
      where,
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        maskedNumber: true,
        type: true,
        variant: true,
        nameOnCard: true,
        expiryDate: true,
        dailyLimit: true,
        monthlyLimit: true,
        status: true,
        isInternational: true,
        isOnline: true,
        issuedAt: true,
        lastUsed: true,
        customer: { select: { id: true, firstName: true, lastName: true, companyName: true } },
      },
    }),
    prisma.card.count({ where }),
  ]);

  res.json({
    success: true,
    data: cards,
    pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
  });
});

// GET /api/cards/:id
router.get('/:id', async (req, res) => {
  const card = await prisma.card.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      maskedNumber: true,
      type: true,
      variant: true,
      nameOnCard: true,
      expiryDate: true,
      dailyLimit: true,
      monthlyLimit: true,
      status: true,
      isInternational: true,
      isOnline: true,
      issuedAt: true,
      lastUsed: true,
      customer: true,
      account: true,
      disputes: { orderBy: { createdAt: 'desc' } },
    },
  });

  if (!card) throw new AppError('Card not found', 404);
  res.json({ success: true, data: card });
});

// POST /api/cards
router.post('/', authorize('admin', 'manager'), async (req: AuthRequest, res) => {
  const { customerId, accountId, type, variant, dailyLimit, monthlyLimit, nameOnCard } = req.body;

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new AppError('Customer not found', 404);

  // Generate card details
  const cardNumber = '4' + Array.from({ length: 15 }, () => Math.floor(Math.random() * 10)).join('');
  const cvv = Array.from({ length: 3 }, () => Math.floor(Math.random() * 10)).join('');
  const expiryDate = new Date();
  expiryDate.setFullYear(expiryDate.getFullYear() + 5);

  const card = await prisma.card.create({
    data: {
      cardNumber,
      maskedNumber: maskCardNumber(cardNumber),
      customerId,
      accountId,
      type,
      variant,
      nameOnCard,
      expiryDate,
      cvv, // In production, encrypt this
      dailyLimit,
      monthlyLimit,
    },
    select: {
      id: true,
      maskedNumber: true,
      type: true,
      variant: true,
      nameOnCard: true,
      expiryDate: true,
      dailyLimit: true,
      monthlyLimit: true,
      status: true,
    },
  });

  res.status(201).json({ success: true, data: card });
});

// PATCH /api/cards/:id/status
router.patch('/:id/status', authorize('admin', 'manager'), async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['active', 'blocked', 'cancelled'].includes(status)) {
    throw new AppError('Invalid status', 400);
  }

  const card = await prisma.card.update({
    where: { id },
    data: { status },
    select: { id: true, maskedNumber: true, status: true },
  });

  res.json({ success: true, data: card });
});

// PATCH /api/cards/:id/limits
router.patch('/:id/limits', authorize('admin', 'manager'), async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { dailyLimit, monthlyLimit } = req.body;

  const card = await prisma.card.update({
    where: { id },
    data: { dailyLimit, monthlyLimit },
    select: { id: true, maskedNumber: true, dailyLimit: true, monthlyLimit: true },
  });

  res.json({ success: true, data: card });
});

// POST /api/cards/:id/disputes
router.post('/:id/disputes', async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { disputeType, transactionDate, transactionAmount, merchantName, description } = req.body;

  const card = await prisma.card.findUnique({ where: { id } });
  if (!card) throw new AppError('Card not found', 404);

  const disputeNumber = `DIS${Date.now()}`;

  const dispute = await prisma.cardDispute.create({
    data: {
      disputeNumber,
      cardId: id,
      disputeType,
      transactionDate: new Date(transactionDate),
      transactionAmount,
      merchantName,
      description,
    },
  });

  res.status(201).json({ success: true, data: dispute });
});

export default router;
