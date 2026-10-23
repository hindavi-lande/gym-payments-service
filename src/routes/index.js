const { Router } = require('express');
const paymentRoutes = require('./paymentRoutes');

const router = Router();

router.get('/health', (req, res) => res.json({ status: 'ok' }));
router.use('/payments', paymentRoutes);

module.exports = router;
