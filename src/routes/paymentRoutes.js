const { Router } = require('express');
const paymentController = require('../controllers/paymentController');

const router = Router();

router.post('/charge', paymentController.charge);
router.post('/refund', paymentController.refund);
router.post('/merge', paymentController.merge);
router.get('/member/:memberId', paymentController.getHistoryForMember);
router.get('/:id', paymentController.getById);

module.exports = router;
