import { Router } from 'express';

import { hmacController } from '../../controllers/hmacController';

const router = Router();

router.get('/generate-hmac', hmacController.generateHmacSignature.bind(hmacController));

export default router;
