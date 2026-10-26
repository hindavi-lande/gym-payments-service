const { Payment } = require('../models');
const ApiError = require('../utils/ApiError');

async function charge({ memberId, amount, reason, status = 'SUCCESS' }) {
  return Payment.create({ memberId, amount, reason, type: 'CHARGE', status });
}

const REFUND_STATUSES = ['SUCCESS', 'PENDING'];

async function loadRefundableCharge({ memberId, amount, relatedPaymentId }) {
  const original = await Payment.findByPk(relatedPaymentId);
  if (!original || original.memberId !== memberId || original.type !== 'CHARGE') {
    throw new ApiError(422, `relatedPaymentId ${relatedPaymentId} is not a valid charge for member ${memberId}`);
  }

  if (Number(amount) > Number(original.amount)) {
    throw new ApiError(422, `refund amount ${amount} exceeds charge ${relatedPaymentId} amount ${original.amount}`);
  }

  const existingRefund = await Payment.findOne({
    where: {
      relatedPaymentId,
      type: 'REFUND',
      status: REFUND_STATUSES,
    },
  });
  if (existingRefund) {
    throw new ApiError(409, `charge ${relatedPaymentId} has already been refunded`);
  }

  return original;
}

async function refund({ memberId, amount, reason, relatedPaymentId, status = 'SUCCESS' }) {
  if (!REFUND_STATUSES.includes(status)) {
    throw new ApiError(400, `refund status must be one of ${REFUND_STATUSES.join(', ')}`);
  }

  if (relatedPaymentId) {
    await loadRefundableCharge({ memberId, amount, relatedPaymentId });
  }

  return Payment.create({ memberId, amount, reason, relatedPaymentId, type: 'REFUND', status });
}

async function getById(id) {
  const payment = await Payment.findByPk(id);
  if (!payment) {
    throw new ApiError(404, `Payment with id ${id} not found`);
  }
  return payment;
}

const SETTLE_STATUSES = ['SUCCESS', 'FAILED'];

async function settleRefund(id, { status } = {}) {
  const payment = await getById(id);

  if (!SETTLE_STATUSES.includes(status)) {
    throw new ApiError(400, `settled refund status must be one of ${SETTLE_STATUSES.join(', ')}`);
  }

  if (payment.type !== 'REFUND' || payment.status !== 'PENDING') {
    throw new ApiError(422, `payment ${id} is not a pending refund`);
  }

  return payment.update({ status });
}

async function getHistoryForMember(memberId) {
  return Payment.findAll({
    where: { memberId },
    order: [['createdAt', 'DESC']],
  });
}

module.exports = {
  charge,
  refund,
  getById,
  settleRefund,
  getHistoryForMember,
};
