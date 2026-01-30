import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new AppError('Email and password are required', 400);
  }

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new AppError('Invalid credentials', 401);
  }

  if (user.status === 'locked') {
    throw new AppError('Account is locked. Contact administrator.', 403);
  }

  if (user.status === 'inactive') {
    throw new AppError('Account is inactive', 403);
  }

  const isValidPassword = await bcrypt.compare(password, user.password);

  if (!isValidPassword) {
    // Increment login attempts
    await prisma.user.update({
      where: { id: user.id },
      data: {
        loginAttempts: user.loginAttempts + 1,
        ...(user.loginAttempts >= 4 && {
          status: 'locked',
          lockedUntil: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
        }),
      },
    });
    throw new AppError('Invalid credentials', 401);
  }

  // Reset login attempts on successful login
  await prisma.user.update({
    where: { id: user.id },
    data: {
      loginAttempts: 0,
      lastLogin: new Date(),
    },
  });

  // Create audit log
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      userName: user.name,
      action: 'login',
      entity: 'user',
      entityId: user.id,
      entityName: user.name,
      status: 'success',
    },
  });

  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      branch: user.branch,
    },
    process.env.JWT_SECRET || 'your-secret-key',
    { expiresIn: '8h' }
  );

  res.json({
    success: true,
    data: {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        branch: user.branch,
        department: user.department,
      },
    },
  });
});

// POST /api/auth/logout
router.post('/logout', authenticate, async (req: AuthRequest, res) => {
  if (req.user) {
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        userName: req.user.email,
        action: 'logout',
        entity: 'user',
        entityId: req.user.id,
        status: 'success',
      },
    });
  }

  res.json({ success: true, message: 'Logged out successfully' });
});

// GET /api/auth/me
router.get('/me', authenticate, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
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
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  res.json({ success: true, data: user });
});

// POST /api/auth/change-password
router.post('/change-password', authenticate, async (req: AuthRequest, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    throw new AppError('Current and new password are required', 400);
  }

  if (newPassword.length < 8) {
    throw new AppError('Password must be at least 8 characters', 400);
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  const isValidPassword = await bcrypt.compare(currentPassword, user.password);

  if (!isValidPassword) {
    throw new AppError('Current password is incorrect', 401);
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);

  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashedPassword },
  });

  res.json({ success: true, message: 'Password changed successfully' });
});

export default router;
