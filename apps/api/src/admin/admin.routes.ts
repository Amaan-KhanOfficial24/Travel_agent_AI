// Admin-only endpoints. requireRole('admin') returns 403 for everyone else.
import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireRole } from '../middleware/auth.js';
import { tripsService } from '../trips/trips.service.js';

export const adminRouter = Router();
adminRouter.use(requireRole('admin'));

// Every trip, from every user (the service gives admins an unscoped view).
adminRouter.get('/trips', async (req, res) => {
  res.json({ data: await tripsService.list(req.user!) });
});

// Users, without password hashes: a SELECT lists only the safe columns.
adminRouter.get('/users', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.role, u.created_at AS "createdAt", count(t.id)::int AS "tripCount"
       FROM users u LEFT JOIN trips t ON t.user_id = u.id
      GROUP BY u.id ORDER BY u.created_at DESC LIMIT 100`,
  );
  res.json({ data: rows });
});
