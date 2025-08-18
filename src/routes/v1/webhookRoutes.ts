import { Router, Request, Response } from 'express';

import { webhookController } from '../../controllers/webhookController';

const router = Router();

// Middleware to capture raw body for signature verification
export function rawBodySaver(req: Request, res: Response, buf: Buffer, encoding: string) {
  if (buf && buf.length) {
    (req as any).rawBody = buf.toString((encoding || 'utf8') as BufferEncoding);
  }
}

router.post('/proof-status', webhookController.proofStatus.bind(webhookController));
router.post('/overdue', webhookController.proofOverdue.bind(webhookController));

export default router;
