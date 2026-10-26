const { Router } = require('express');
const paymentController = require('../controllers/paymentController');

const router = Router();

router.post('/charge', paymentController.charge);
router.post('/refund', paymentController.refund);
router.patch('/:id/status', paymentController.settle);
router.get('/member/:memberId', paymentController.getHistoryForMember);
router.get('/:id', paymentController.getById);

module.exports = router;
