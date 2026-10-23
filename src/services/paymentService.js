const { Op } = require('sequelize');
const { Payment } = require('../models');
const ApiError = require('../utils/ApiError');

async function charge({ memberId, amount, reason, simulateDecline }) {
  if (simulateDecline) {
    throw new ApiError(402, 'Payment declined by issuer');
  }
  return Payment.create({ memberId, amount, reason, type: 'CHARGE', status: 'SUCCESS' });
}

const REFUND_STATUSES = ['SUCCESS', 'PENDING', 'FAILED'];

// A charge can only give money back once: an existing SUCCESS or PENDING refund
// against it blocks a second one. A FAILED refund does not block a retry because
// no money moved. The refund can also never be larger than the charge it reverses.
async function assertChargeIsRefundable(charge, requestedAmount) {
  const existingRefund = await Payment.findOne({
    where: {
      type: 'REFUND',
      relatedPaymentId: charge.id,
      status: { [Op.in]: ['SUCCESS', 'PENDING'] },
    },
  });

  if (existingRefund) {
    throw new ApiError(409, `Payment ${charge.id} has already been refunded`);
  }

  if (Number(requestedAmount) > Number(charge.amount)) {
    throw new ApiError(
      422,
      `Refund amount ${requestedAmount} exceeds the amount of payment ${charge.id} (${charge.amount})`,
    );
  }
}

async function refund({ memberId, amount, reason, relatedPaymentId, status = 'SUCCESS', simulatePending }) {
  let resolvedStatus = status;
  if (!REFUND_STATUSES.includes(resolvedStatus)) {
    throw new ApiError(422, `status must be one of ${REFUND_STATUSES.join(', ')}`);
  }
  if (simulatePending) {
    resolvedStatus = 'PENDING';
  }

  if (relatedPaymentId) {
    const original = await Payment.findByPk(relatedPaymentId);
    if (!original || original.memberId !== memberId || original.type !== 'CHARGE') {
      throw new ApiError(422, `relatedPaymentId ${relatedPaymentId} is not a valid charge for member ${memberId}`);
    }
    await assertChargeIsRefundable(original, amount);
  }

  return Payment.create({ memberId, amount, reason, relatedPaymentId, type: 'REFUND', status: resolvedStatus });
}

const SETTLEABLE_STATUSES = ['SUCCESS', 'FAILED'];

// A pending refund is settled by whoever resolves it (a staff-facing gateway or
// admin caller): only a REFUND row that is currently PENDING can move, and only
// to a final outcome. A CHARGE is never touched here.
async function setStatus(id, status) {
  if (!SETTLEABLE_STATUSES.includes(status)) {
    throw new ApiError(422, `status must be one of ${SETTLEABLE_STATUSES.join(', ')}`);
  }

  const payment = await Payment.findByPk(id);
  if (!payment) {
    throw new ApiError(404, `Payment with id ${id} not found`);
  }

  if (payment.type !== 'REFUND' || payment.status !== 'PENDING') {
    throw new ApiError(
      409,
      `Payment ${id} is a ${payment.type} with status ${payment.status} and cannot be settled`,
    );
  }

  payment.status = status;
  await payment.save();
  return payment;
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
  setStatus,
  getById,
  getHistoryForMember,
};
