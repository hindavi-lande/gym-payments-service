const { Router } = require('express');
const paymentController = require('../controllers/paymentController');

const router = Router();

router.post('/charge', paymentController.charge);
router.post('/refund', paymentController.refund);
router.get('/member/:memberId', paymentController.getHistoryForMember);
router.patch('/:id/status', paymentController.setStatus);
router.get('/:id', paymentController.getById);

module.exports = router;
