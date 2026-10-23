const { Payment } = require('../models');
const ApiError = require('../utils/ApiError');

async function charge({ memberId, amount, reason, status }) {
  const chargeStatus = status === undefined ? 'SUCCESS' : status;
  if (chargeStatus !== 'SUCCESS' && chargeStatus !== 'FAILED') {
    throw new ApiError(400, `status must be one of SUCCESS, FAILED (received ${chargeStatus})`);
  }
  return Payment.create({ memberId, amount, reason, type: 'CHARGE', status: chargeStatus });
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

module.exports = {
  charge,
  refund,
  getById,
  getHistoryForMember,
};
