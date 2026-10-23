process.env.DB_STORAGE = ':memory:';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../src/app');
const { sequelize, Payment } = require('../src/models');

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

afterEach(async () => {
  await Payment.destroy({ where: {}, truncate: true });
});

afterAll(async () => {
  await sequelize.close();
});

async function createCharge(memberId = 1, amount = 79.99) {
  const res = await request(app).post('/api/payments/charge').send({ memberId, amount });
  return res.body;
}

describe('POST /api/payments/refund — refund rules', () => {
  it('records a refund tied to the charge it reverses', async () => {
    const charge = await createCharge();

    const res = await request(app).post('/api/payments/refund').send({
      memberId: 1,
      amount: 26.66,
      reason: 'unused time after cancellation',
      relatedPaymentId: charge.id,
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      memberId: 1,
      type: 'REFUND',
      status: 'SUCCESS',
      relatedPaymentId: charge.id,
      reason: 'unused time after cancellation',
    });
    expect(Number(res.body.amount)).toBeCloseTo(26.66);
  });

  it('rejects a refund larger than the charge it reverses', async () => {
    const charge = await createCharge();

    const res = await request(app).post('/api/payments/refund').send({
      memberId: 1,
      amount: 80,
      relatedPaymentId: charge.id,
    });

    expect(res.status).toBe(422);

    const refunds = await Payment.findAll({ where: { type: 'REFUND' } });
    expect(refunds).toHaveLength(0);
  });

  it('allows a refund of exactly the charge amount', async () => {
    const charge = await createCharge();

    const res = await request(app).post('/api/payments/refund').send({
      memberId: 1,
      amount: Number(charge.amount),
      relatedPaymentId: charge.id,
    });

    expect(res.status).toBe(201);
    expect(res.body.relatedPaymentId).toBe(charge.id);
  });

  it('refuses a second refund against a charge that already has a SUCCESS refund', async () => {
    const charge = await createCharge();

    const first = await request(app).post('/api/payments/refund').send({
      memberId: 1,
      amount: 20,
      relatedPaymentId: charge.id,
    });
    expect(first.status).toBe(201);

    const res = await request(app).post('/api/payments/refund').send({
      memberId: 1,
      amount: 10,
      relatedPaymentId: charge.id,
    });

    expect(res.status).toBe(409);
    expect(res.body.message).toContain(String(charge.id));
    expect(res.body.message).toMatch(/already been refunded/i);

    const refunds = await Payment.findAll({ where: { type: 'REFUND' } });
    expect(refunds).toHaveLength(1);
  });

  it('refuses a second refund against a charge that already has a PENDING refund', async () => {
    const charge = await createCharge();

    const first = await request(app).post('/api/payments/refund').send({
      memberId: 1,
      amount: 20,
      relatedPaymentId: charge.id,
      simulatePending: true,
    });
    expect(first.status).toBe(201);
    expect(first.body.status).toBe('PENDING');

    const res = await request(app).post('/api/payments/refund').send({
      memberId: 1,
      amount: 10,
      relatedPaymentId: charge.id,
    });

    expect(res.status).toBe(409);
    expect(res.body.message).toContain(String(charge.id));
    expect(res.body.message).toMatch(/already been refunded/i);

    const refunds = await Payment.findAll({ where: { type: 'REFUND' } });
    expect(refunds).toHaveLength(1);
  });

  it('allows another refund when the earlier attempt is FAILED', async () => {
    const charge = await createCharge();

    const failed = await request(app).post('/api/payments/refund').send({
      memberId: 1,
      amount: 20,
      relatedPaymentId: charge.id,
      status: 'FAILED',
    });
    expect(failed.status).toBe(201);
    expect(failed.body.status).toBe('FAILED');

    const retry = await request(app).post('/api/payments/refund').send({
      memberId: 1,
      amount: 20,
      relatedPaymentId: charge.id,
    });

    expect(retry.status).toBe(201);
    expect(retry.body.status).toBe('SUCCESS');
    expect(retry.body.relatedPaymentId).toBe(charge.id);

    const refunds = await Payment.findAll({ where: { type: 'REFUND' } });
    expect(refunds).toHaveLength(2);
  });

  it('records a refund as PENDING when simulatePending is true', async () => {
    const charge = await createCharge();

    const res = await request(app).post('/api/payments/refund').send({
      memberId: 1,
      amount: 26.66,
      relatedPaymentId: charge.id,
      simulatePending: true,
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.relatedPaymentId).toBe(charge.id);
  });

  it('accepts PENDING as an explicit status', async () => {
    const charge = await createCharge();

    const res = await request(app).post('/api/payments/refund').send({
      memberId: 1,
      amount: 26.66,
      relatedPaymentId: charge.id,
      status: 'PENDING',
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
  });

  it('rejects a status outside SUCCESS, PENDING and FAILED', async () => {
    const charge = await createCharge();

    const res = await request(app).post('/api/payments/refund').send({
      memberId: 1,
      amount: 26.66,
      relatedPaymentId: charge.id,
      status: 'COMPLETED',
    });

    expect(res.status).toBe(422);

    const refunds = await Payment.findAll({ where: { type: 'REFUND' } });
    expect(refunds).toHaveLength(0);
  });
});

async function createPendingRefund(memberId = 1, amount = 26.66) {
  const charge = await createCharge(memberId);
  const refundRes = await request(app).post('/api/payments/refund').send({
    memberId,
    amount,
    relatedPaymentId: charge.id,
    simulatePending: true,
  });
  return { charge, refund: refundRes.body };
}

describe('PATCH /api/payments/:id/status — settle a pending refund', () => {
  it('settles a pending refund as SUCCESS', async () => {
    const { refund } = await createPendingRefund();
    expect(refund.status).toBe('PENDING');

    const res = await request(app)
      .patch(`/api/payments/${refund.id}/status`)
      .send({ status: 'SUCCESS' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(refund.id);
    expect(res.body.status).toBe('SUCCESS');

    const readBack = await request(app).get(`/api/payments/${refund.id}`);
    expect(readBack.status).toBe(200);
    expect(readBack.body.status).toBe('SUCCESS');
  });

  it('settles a pending refund as FAILED and reports it in the member history', async () => {
    const { charge, refund } = await createPendingRefund(1, 26.66);

    const res = await request(app)
      .patch(`/api/payments/${refund.id}/status`)
      .send({ status: 'FAILED' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('FAILED');

    const history = await request(app).get('/api/payments/member/1');
    expect(history.status).toBe(200);

    const settled = history.body.find((p) => p.id === refund.id);
    expect(settled).toBeDefined();
    expect(settled.status).toBe('FAILED');
    expect(settled.relatedPaymentId).toBe(charge.id);
  });

  it('keeps the relatedPaymentId after settling', async () => {
    const { charge, refund } = await createPendingRefund(2, 26.66);

    const res = await request(app)
      .patch(`/api/payments/${refund.id}/status`)
      .send({ status: 'SUCCESS' });

    expect(res.status).toBe(200);
    expect(res.body.relatedPaymentId).toBe(charge.id);

    const history = await request(app).get('/api/payments/member/2');
    const found = history.body.find((p) => p.id === refund.id);
    expect(found.type).toBe('REFUND');
    expect(found.relatedPaymentId).toBe(charge.id);
    expect(found.status).toBe('SUCCESS');
  });

  it('returns 404 for an unknown payment id', async () => {
    const res = await request(app)
      .patch('/api/payments/999999/status')
      .send({ status: 'SUCCESS' });

    expect(res.status).toBe(404);
  });

  it('returns 409 when the payment is a CHARGE', async () => {
    const charge = await createCharge();

    const res = await request(app)
      .patch(`/api/payments/${charge.id}/status`)
      .send({ status: 'FAILED' });

    expect(res.status).toBe(409);
  });

  it('returns 409 when the refund is not currently PENDING', async () => {
    const charge = await createCharge();
    const refundRes = await request(app).post('/api/payments/refund').send({
      memberId: 1,
      amount: 20,
      relatedPaymentId: charge.id,
    });
    expect(refundRes.body.status).toBe('SUCCESS');

    const res = await request(app)
      .patch(`/api/payments/${refundRes.body.id}/status`)
      .send({ status: 'FAILED' });

    expect(res.status).toBe(409);
  });

  it('rejects a status other than SUCCESS or FAILED', async () => {
    const { refund } = await createPendingRefund();

    const res = await request(app)
      .patch(`/api/payments/${refund.id}/status`)
      .send({ status: 'PENDING' });

    expect(res.status).toBe(422);

    const readBack = await request(app).get(`/api/payments/${refund.id}`);
    expect(readBack.body.status).toBe('PENDING');
  });
});


