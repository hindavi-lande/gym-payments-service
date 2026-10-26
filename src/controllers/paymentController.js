const paymentService = require('../services/paymentService');

async function charge(req, res, next) {
  try {
    const payment = await paymentService.charge(req.body);
    const statusCode = payment.status === 'FAILED' ? 402 : 201;
    res.status(statusCode).json(payment);
  } catch (err) {
    next(err);
  }
}

async function refund(req, res, next) {
  try {
    const payment = await paymentService.refund(req.body);
    const statusCode = payment.status === 'PENDING' ? 202 : 201;
    res.status(statusCode).json(payment);
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

async function settle(req, res, next) {
  try {
    const payment = await paymentService.settleRefund(req.params.id, req.body);
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
  settle,
  getHistoryForMember,
};
