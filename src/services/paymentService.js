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

function parseMemberId(value, fieldName) {
  const id = Number(value);
  if (value === undefined || value === null || value === '' || !Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, `${fieldName} must be a positive integer`);
  }
  return id;
}

async function mergePayments({ fromMemberId, toMemberId }) {
  const fromId = parseMemberId(fromMemberId, 'fromMemberId');
  const toId = parseMemberId(toMemberId, 'toMemberId');

  const [moved] = await Payment.update({ memberId: toId }, { where: { memberId: fromId } });
  return { moved };
}

module.exports = {
  charge,
  refund,
  getById,
  getHistoryForMember,
  mergePayments,
};
