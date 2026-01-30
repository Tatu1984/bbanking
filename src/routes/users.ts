import { Router } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authenticate);
router.use(authorize('admin', 'manager'));

// GET /api/users
router.get('/', async (req, res) => {
  const { page = '1', limit = '20', role, status, branch } = req.query;
  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);

  const where: any = {};
  if (role) where.role = role;
  if (status) where.status = status;
  if (branch) where.branch = branch;

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        employeeId: true,
        name: true,
        email: true,
        role: true,
        branch: true,
        department: true,
        status: true,
        lastLogin: true,
        createdAt: true,
      },
    }),
    prisma.user.count({ where }),
  ]);

  res.json({
    success: true,
    data: users,
    pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
  });
});

// GET /api/users/:id
router.get('/:id', async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      employeeId: true,
      name: true,
      email: true,
      role: true,
      branch: true,
      department: true,
      status: true,
      lastLogin: true,
      loginAttempts: true,
      lockedUntil: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) throw new AppError('User not found', 404);
  res.json({ success: true, data: user });
});

// POST /api/users
router.post('/', authorize('admin'), async (req: AuthRequest, res) => {
  const { employeeId, name, email, password, role, branch, department } = req.body;

  if (!employeeId || !name || !email || !password || !branch || !department) {
    throw new AppError('All fields are required', 400);
  }

  const existingUser = await prisma.user.findFirst({
    where: { OR: [{ email }, { employeeId }] },
  });

  if (existingUser) {
    throw new AppError('User with this email or employee ID already exists', 409);
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      employeeId,
      name,
      email,
      password: hashedPassword,
      role: role || 'officer',
      branch,
      department,
    },
    select: {
      id: true,
      employeeId: true,
      name: true,
      email: true,
      role: true,
      branch: true,
      department: true,
      status: true,
      createdAt: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: req.user!.id,
      userName: req.user!.email,
      action: 'create',
      entity: 'user',
      entityId: user.id,
      entityName: user.name,
      status: 'success',
    },
  });

  res.status(201).json({ success: true, data: user });
});

// PATCH /api/users/:id
router.patch('/:id', authorize('admin'), async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { name, role, branch, department, status } = req.body;

  const user = await prisma.user.update({
    where: { id },
    data: {
      ...(name && { name }),
      ...(role && { role }),
      ...(branch && { branch }),
      ...(department && { department }),
      ...(status && { status }),
      ...(status === 'active' && { loginAttempts: 0, lockedUntil: null }),
    },
    select: {
      id: true,
      employeeId: true,
      name: true,
      email: true,
      role: true,
      branch: true,
      department: true,
      status: true,
    },
  });

  res.json({ success: true, data: user });
});

// POST /api/users/:id/reset-password
router.post('/:id/reset-password', authorize('admin'), async (req: AuthRequest, res) => {
  const { id } = req.params;
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 8) {
    throw new AppError('Password must be at least 8 characters', 400);
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);

  await prisma.user.update({
    where: { id },
    data: { password: hashedPassword, loginAttempts: 0, lockedUntil: null },
  });

  res.json({ success: true, message: 'Password reset successfully' });
});

// POST /api/users/:id/unlock
router.post('/:id/unlock', authorize('admin'), async (req: AuthRequest, res) => {
  const { id } = req.params;

  await prisma.user.update({
    where: { id },
    data: { status: 'active', loginAttempts: 0, lockedUntil: null },
  });

  res.json({ success: true, message: 'User unlocked successfully' });
});

export default router;
