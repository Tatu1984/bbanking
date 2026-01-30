import { Router } from 'express';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);

// GET /api/loans
router.get('/', async (req, res) => {
  const { page = '1', limit = '20', status, type, customerId } = req.query;
  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);

  const where: any = {};
  if (status) where.status = status;
  if (type) where.type = type;
  if (customerId) where.customerId = customerId;

  const [loans, total] = await Promise.all([
    prisma.loan.findMany({
      where,
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, companyName: true, email: true } },
      },
    }),
    prisma.loan.count({ where }),
  ]);

  res.json({
    success: true,
    data: loans,
    pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
  });
});

// GET /api/loans/:id
router.get('/:id', async (req, res) => {
  const loan = await prisma.loan.findUnique({
    where: { id: req.params.id },
    include: {
      customer: true,
      application: true,
      collectionActivities: { orderBy: { activityDate: 'desc' } },
    },
  });

  if (!loan) throw new AppError('Loan not found', 404);
  res.json({ success: true, data: loan });
});

// GET /api/loans/applications
router.get('/applications/list', async (req, res) => {
  const { page = '1', limit = '20', status } = req.query;
  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);

  const where: any = {};
  if (status) where.status = status;

  const [applications, total] = await Promise.all([
    prisma.loanApplication.findMany({
      where,
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
      orderBy: { createdAt: 'desc' },
      include: { customer: { select: { id: true, firstName: true, lastName: true, companyName: true } } },
    }),
    prisma.loanApplication.count({ where }),
  ]);

  res.json({
    success: true,
    data: applications,
    pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
  });
});

// POST /api/loans/applications
router.post('/applications', authorize('admin', 'manager', 'officer'), async (req: AuthRequest, res) => {
  const { customerId, loanType, requestedAmount, tenure, purpose, employmentType, monthlyIncome, existingEMI = 0 } = req.body;

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new AppError('Customer not found', 404);

  const applicationNumber = `LA${Date.now()}`;

  const application = await prisma.loanApplication.create({
    data: {
      applicationNumber,
      customerId,
      loanType,
      requestedAmount,
      tenure,
      purpose,
      employmentType,
      monthlyIncome,
      existingEMI,
      status: 'submitted',
      submittedAt: new Date(),
    },
    include: { customer: true },
  });

  res.status(201).json({ success: true, data: application });
});

// PATCH /api/loans/applications/:id/approve
router.patch('/applications/:id/approve', authorize('admin', 'manager'), async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { approvedAmount, interestRate, tenureMonths } = req.body;

  const application = await prisma.loanApplication.findUnique({ where: { id } });
  if (!application) throw new AppError('Application not found', 404);
  if (application.status !== 'under_review' && application.status !== 'submitted') {
    throw new AppError('Application cannot be approved in current status', 400);
  }

  const updated = await prisma.loanApplication.update({
    where: { id },
    data: {
      status: 'approved',
      approvedAmount: approvedAmount || application.requestedAmount,
      approvedAt: new Date(),
      approvedBy: req.user!.id,
    },
  });

  res.json({ success: true, data: updated });
});

// POST /api/loans/:id/collection-activity
router.post('/:id/collection-activity', authorize('admin', 'manager', 'officer'), async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { activityType, outcome, promiseDate, promiseAmount, notes, nextFollowUp } = req.body;

  const loan = await prisma.loan.findUnique({ where: { id }, include: { customer: true } });
  if (!loan) throw new AppError('Loan not found', 404);

  const activity = await prisma.collectionActivity.create({
    data: {
      loanId: id,
      customerId: loan.customerId,
      activityType,
      activityDate: new Date(),
      outcome,
      promiseDate: promiseDate ? new Date(promiseDate) : null,
      promiseAmount,
      notes,
      collectorId: req.user!.id,
      collectorName: req.user!.email,
      nextFollowUp: nextFollowUp ? new Date(nextFollowUp) : null,
    },
  });

  res.status(201).json({ success: true, data: activity });
});

export default router;
