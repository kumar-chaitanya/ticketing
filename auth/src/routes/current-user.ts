import express from 'express';
import { currentUser } from '@sgticketing/common';
import { Request, Response } from 'express';

const router = express.Router();

router.get('/api/users/currentuser', currentUser(process.env.JWT_KEY!), (req: Request, res: Response) => {
  res.send({ currentUser: req.currentUser || null });
});

export { router as currentUserRouter };
