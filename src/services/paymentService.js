const { Payment } = require('../models');
const ApiError = require('../utils/ApiError');

async function charge({ memberId, amount, reason }) {
  return Payment.create({ memberId, amount, reason, type: 'CHARGE', status: 'SUCCESS' });
}

async function refund({ memberId, amount, reason, relatedPaymentId }) {
  if (relatedPaymentId) {
    const original = await Payment.findByPk(relatedPaymentId);
    if (!original || original.memberId !== memberId || original.type !== 'CHARGE') {
      throw new ApiError(422, `relatedPaymentId ${relatedPaymentId} is not a valid charge for member ${memberId}`);
    }
  }
  return Payment.create({ memberId, amount, reason, relatedPaymentId, type: 'REFUND', status: 'SUCCESS' });
}

async function getById(id) {
  const payment = await Payment.findByPk(id);
  if (!payment) {
    throw new ApiError(404, `Payment with id ${id} not found`);
  }
  return payment;
}

async function getHistoryForMember(memberId) {
  return Payment.findAll({
    where: { memberId },
    order: [['createdAt', 'DESC']],
  });
}

const SPEND_WINDOW_MONTHS = 12;

async function getSpendForMember(memberId) {
  const payments = await Payment.findAll({
    where: { memberId, status: 'SUCCESS' },
  });

  const windowStart = new Date();
  windowStart.setMonth(windowStart.getMonth() - SPEND_WINDOW_MONTHS);

  const spend = payments.reduce((total, payment) => {
    // Each row is dated by its own createdAt, so a refund falls in the window
    // it actually happened in, not the window of the charge it reverses.
    if (new Date(payment.createdAt) < windowStart) {
      return total;
    }

    const amount = Number(payment.amount);
    if (payment.type === 'CHARGE') {
      return total + amount;
    }
    if (payment.type === 'REFUND') {
      return total - amount;
    }
    return total;
  }, 0);

  return Math.round(spend * 100) / 100;
}

module.exports = {
  charge,
  refund,
  getById,
  getHistoryForMember,
  getSpendForMember,
};
