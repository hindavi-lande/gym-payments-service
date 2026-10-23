const paymentService = require('../services/paymentService');

async function charge(req, res, next) {
  try {
    const payment = await paymentService.charge(req.body);
    if (payment.status === 'FAILED') {
      return res.status(402).json(payment);
    }
    res.status(201).json(payment);
  } catch (err) {
    next(err);
  }
}

async function refund(req, res, next) {
  try {
    const payment = await paymentService.refund(req.body);
    res.status(201).json(payment);
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const payment = await paymentService.getById(req.params.id);
    res.json(payment);
  } catch (err) {
    next(err);
  }
}

async function getHistoryForMember(req, res, next) {
  try {
    const history = await paymentService.getHistoryForMember(req.params.memberId);
    res.json(history);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  charge,
  refund,
  getById,
  getHistoryForMember,
};
