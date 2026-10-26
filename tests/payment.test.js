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

describe('GET /api/health', () => {
  it('returns ok status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('POST /api/payments/charge', () => {
  it('records a successful charge', async () => {
    const res = await request(app)
      .post('/api/payments/charge')
      .send({ memberId: 1, amount: 49.99, reason: 'PREMIUM plan renewal' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      memberId: 1,
      type: 'CHARGE',
      status: 'SUCCESS',
      reason: 'PREMIUM plan renewal',
    });
    expect(Number(res.body.amount)).toBeCloseTo(49.99);
  });

  it('rejects an amount of zero or below', async () => {
    const res = await request(app)
      .post('/api/payments/charge')
      .send({ memberId: 1, amount: 0 });

    expect(res.status).toBe(400);
  });

  it('rejects a missing memberId', async () => {
    const res = await request(app)
      .post('/api/payments/charge')
      .send({ amount: 10 });

    expect(res.status).toBe(400);
  });

  it('records a declined charge as FAILED and responds 402', async () => {
    const res = await request(app)
      .post('/api/payments/charge')
      .send({ memberId: 1, amount: 49.99, status: 'FAILED' });

    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({
      memberId: 1,
      type: 'CHARGE',
      status: 'FAILED',
    });

    const persisted = await request(app).get(`/api/payments/${res.body.id}`);

    expect(persisted.status).toBe(200);
    expect(persisted.body.id).toBe(res.body.id);
    expect(persisted.body.status).toBe('FAILED');
  });

  it('includes a declined charge in the member payment history', async () => {
    const charge = await request(app)
      .post('/api/payments/charge')
      .send({ memberId: 1, amount: 49.99 });
    const declined = await request(app)
      .post('/api/payments/charge')
      .send({ memberId: 1, amount: 39.99, status: 'FAILED' });

    const history = await request(app).get('/api/payments/member/1');

    expect(history.status).toBe(200);
    expect(history.body.map((p) => p.id).sort()).toEqual(
      [charge.body.id, declined.body.id].sort(),
    );
    expect(history.body.find((p) => p.id === declined.body.id).status).toBe('FAILED');
  });
});

describe('POST /api/payments/refund', () => {
  it('records a refund against a valid prior charge', async () => {
    const charge = await request(app)
      .post('/api/payments/charge')
      .send({ memberId: 1, amount: 49.99 });

    const res = await request(app).post('/api/payments/refund').send({
      memberId: 1,
      amount: 20,
      reason: 'early cancellation',
      relatedPaymentId: charge.body.id,
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      memberId: 1,
      type: 'REFUND',
      status: 'SUCCESS',
      relatedPaymentId: charge.body.id,
    });
  });

  it('records a refund with no relatedPaymentId', async () => {
    const res = await request(app)
      .post('/api/payments/refund')
      .send({ memberId: 1, amount: 15 });

    expect(res.status).toBe(201);
    expect(res.body.relatedPaymentId == null).toBe(true);
  });

  it('rejects a relatedPaymentId that does not exist', async () => {
    const res = await request(app)
      .post('/api/payments/refund')
      .send({ memberId: 1, amount: 20, relatedPaymentId: 999999 });

    expect(res.status).toBe(422);
  });

  it('rejects a relatedPaymentId belonging to a different member', async () => {
    const charge = await request(app)
      .post('/api/payments/charge')
      .send({ memberId: 1, amount: 49.99 });

    const res = await request(app).post('/api/payments/refund').send({
      memberId: 2,
      amount: 20,
      relatedPaymentId: charge.body.id,
    });

    expect(res.status).toBe(422);
  });

  it('rejects a relatedPaymentId that points to a refund, not a charge', async () => {
    const charge = await request(app)
      .post('/api/payments/charge')
      .send({ memberId: 1, amount: 49.99 });

    const refund = await request(app).post('/api/payments/refund').send({
      memberId: 1,
      amount: 20,
      relatedPaymentId: charge.body.id,
    });

    const res = await request(app).post('/api/payments/refund').send({
      memberId: 1,
      amount: 5,
      relatedPaymentId: refund.body.id,
    });

    expect(res.status).toBe(422);
  });

  it('rejects a refund larger than the related charge and creates nothing', async () => {
    const charge = await request(app)
      .post('/api/payments/charge')
      .send({ memberId: 1, amount: 49.99 });

    const res = await request(app).post('/api/payments/refund').send({
      memberId: 1,
      amount: 50,
      relatedPaymentId: charge.body.id,
    });

    expect(res.status).toBe(422);

    const history = await request(app).get('/api/payments/member/1');

    expect(history.body).toHaveLength(1);
    expect(history.body[0].id).toBe(charge.body.id);
  });

  it('accepts a refund for exactly the related charge amount', async () => {
    const charge = await request(app)
      .post('/api/payments/charge')
      .send({ memberId: 1, amount: 49.99 });

    const res = await request(app).post('/api/payments/refund').send({
      memberId: 1,
      amount: 49.99,
      relatedPaymentId: charge.body.id,
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      type: 'REFUND',
      status: 'SUCCESS',
      relatedPaymentId: charge.body.id,
    });
    expect(Number(res.body.amount)).toBeCloseTo(49.99);
  });

  it('refunds a given charge only once', async () => {
    const charge = await request(app)
      .post('/api/payments/charge')
      .send({ memberId: 1, amount: 49.99 });

    const first = await request(app).post('/api/payments/refund').send({
      memberId: 1,
      amount: 20,
      relatedPaymentId: charge.body.id,
    });

    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      type: 'REFUND',
      status: 'SUCCESS',
      relatedPaymentId: charge.body.id,
    });

    const second = await request(app).post('/api/payments/refund').send({
      memberId: 1,
      amount: 10,
      relatedPaymentId: charge.body.id,
    });

    expect(second.status).toBe(409);
    expect(second.body.message).toContain(String(charge.body.id));

    const history = await request(app).get('/api/payments/member/1');
    const refundsForCharge = history.body.filter(
      (p) => p.type === 'REFUND' && p.relatedPaymentId === charge.body.id,
    );

    expect(refundsForCharge).toHaveLength(1);
    expect(refundsForCharge[0].id).toBe(first.body.id);
  });

  it('records a refund requested as PENDING and responds 202', async () => {
    const charge = await request(app)
      .post('/api/payments/charge')
      .send({ memberId: 1, amount: 49.99 });

    const res = await request(app).post('/api/payments/refund').send({
      memberId: 1,
      amount: 20,
      relatedPaymentId: charge.body.id,
      status: 'PENDING',
    });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      type: 'REFUND',
      status: 'PENDING',
      relatedPaymentId: charge.body.id,
    });

    const persisted = await request(app).get(`/api/payments/${res.body.id}`);

    expect(persisted.status).toBe(200);
    expect(persisted.body.status).toBe('PENDING');
  });

  it('accepts an explicit SUCCESS status for a refund', async () => {
    const charge = await request(app)
      .post('/api/payments/charge')
      .send({ memberId: 1, amount: 49.99 });

    const res = await request(app).post('/api/payments/refund').send({
      memberId: 1,
      amount: 20,
      relatedPaymentId: charge.body.id,
      status: 'SUCCESS',
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('SUCCESS');
  });

  it('rejects a refund status other than SUCCESS or PENDING and creates nothing', async () => {
    const charge = await request(app)
      .post('/api/payments/charge')
      .send({ memberId: 1, amount: 49.99 });

    for (const status of ['FAILED', 'CHARGE', 'PARTIAL']) {
      const res = await request(app).post('/api/payments/refund').send({
        memberId: 1,
        amount: 20,
        relatedPaymentId: charge.body.id,
        status,
      });

      expect(res.status).toBe(400);
    }

    const history = await request(app).get('/api/payments/member/1');

    expect(history.body).toHaveLength(1);
    expect(history.body[0].id).toBe(charge.body.id);
  });

  it('only ever stores a payment status of SUCCESS, FAILED or PENDING', async () => {
    const charge = await request(app)
      .post('/api/payments/charge')
      .send({ memberId: 1, amount: 49.99 });
    await request(app).post('/api/payments/refund').send({
      memberId: 1,
      amount: 20,
      relatedPaymentId: charge.body.id,
      status: 'PENDING',
    });
    await request(app)
      .post('/api/payments/charge')
      .send({ memberId: 1, amount: 39.99, status: 'FAILED' });

    const history = await request(app).get('/api/payments/member/1');

    expect(history.body).toHaveLength(3);
    for (const payment of history.body) {
      expect(['SUCCESS', 'FAILED', 'PENDING']).toContain(payment.status);
    }
  });
});

describe('GET /api/payments/member/:memberId', () => {
  it('returns a member payment history ordered most recent first', async () => {
    const charge = await request(app)
      .post('/api/payments/charge')
      .send({ memberId: 1, amount: 49.99 });
    const refund = await request(app).post('/api/payments/refund').send({
      memberId: 1,
      amount: 20,
      relatedPaymentId: charge.body.id,
    });

    const res = await request(app).get('/api/payments/member/1');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].id).toBe(refund.body.id);
    expect(res.body[1].id).toBe(charge.body.id);
  });

  it('returns an empty list for a member with no payments', async () => {
    const res = await request(app).get('/api/payments/member/999999');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  describe('PATCH /api/payments/:id/status', () => {
    async function createPendingRefund(memberId = 1) {
      const charge = await request(app)
        .post('/api/payments/charge')
        .send({ memberId, amount: 49.99 });
      const refund = await request(app).post('/api/payments/refund').send({
        memberId,
        amount: 20,
        relatedPaymentId: charge.body.id,
        status: 'PENDING',
      });

      return { charge: charge.body, refund: refund.body };
    }

    it('settles a pending refund as SUCCESS and reports it in the member history', async () => {
      const { refund } = await createPendingRefund();

      const res = await request(app)
        .patch(`/api/payments/${refund.id}/status`)
        .send({ status: 'SUCCESS' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: refund.id,
        type: 'REFUND',
        status: 'SUCCESS',
        relatedPaymentId: refund.relatedPaymentId,
      });

      const history = await request(app).get('/api/payments/member/1');

      expect(history.status).toBe(200);
      expect(history.body.find((p) => p.id === refund.id).status).toBe('SUCCESS');
    });

    it('settles a pending refund as FAILED and reports it in the member history', async () => {
      const { refund } = await createPendingRefund();

      const res = await request(app)
        .patch(`/api/payments/${refund.id}/status`)
        .send({ status: 'FAILED' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: refund.id, type: 'REFUND', status: 'FAILED' });

      const history = await request(app).get('/api/payments/member/1');

      expect(history.status).toBe(200);
      expect(history.body.find((p) => p.id === refund.id).status).toBe('FAILED');
    });

    it('rejects settling a payment whose status is not PENDING', async () => {
      const charge = await request(app)
        .post('/api/payments/charge')
        .send({ memberId: 1, amount: 49.99 });
      const refund = await request(app).post('/api/payments/refund').send({
        memberId: 1,
        amount: 20,
        relatedPaymentId: charge.body.id,
      });

      expect(refund.status).toBe(201);
      expect(refund.body.status).toBe('SUCCESS');

      const res = await request(app)
        .patch(`/api/payments/${refund.body.id}/status`)
        .send({ status: 'FAILED' });

      expect(res.status).toBe(422);

      const persisted = await request(app).get(`/api/payments/${refund.body.id}`);

      expect(persisted.body.status).toBe('SUCCESS');
    });

    it('rejects settling a payment that is not a refund', async () => {
      const charge = await request(app)
        .post('/api/payments/charge')
        .send({ memberId: 1, amount: 49.99, status: 'PENDING' });

      expect(charge.status).toBe(201);
      expect(charge.body.type).toBe('CHARGE');
      expect(charge.body.status).toBe('PENDING');

      const res = await request(app)
        .patch(`/api/payments/${charge.body.id}/status`)
        .send({ status: 'SUCCESS' });

      expect(res.status).toBe(422);

      const persisted = await request(app).get(`/api/payments/${charge.body.id}`);

      expect(persisted.body.status).toBe('PENDING');
    });

    it('returns 404 when settling an unknown payment', async () => {
      const res = await request(app)
        .patch('/api/payments/999999/status')
        .send({ status: 'SUCCESS' });

      expect(res.status).toBe(404);
    });

    it('rejects a target status other than SUCCESS or FAILED and leaves the row pending', async () => {
      const { refund } = await createPendingRefund();

      for (const status of ['PENDING', 'CHARGE', 'COMPLETED']) {
        const res = await request(app)
          .patch(`/api/payments/${refund.id}/status`)
          .send({ status });

        expect(res.status).toBe(400);
      }

      const persisted = await request(app).get(`/api/payments/${refund.id}`);

      expect(persisted.status).toBe(200);
      expect(persisted.body.status).toBe('PENDING');
    });
  });
});

describe('GET /api/payments/:id', () => {
  it('gets a payment by id', async () => {
    const charge = await request(app)
      .post('/api/payments/charge')
      .send({ memberId: 1, amount: 49.99 });

    const res = await request(app).get(`/api/payments/${charge.body.id}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(charge.body.id);
  });

  it('returns 404 for an unknown payment id', async () => {
    const res = await request(app).get('/api/payments/999999');

    expect(res.status).toBe(404);
  });
});

describe('unknown routes', () => {
  it('returns 404 for an undefined route', async () => {
    const res = await request(app).get('/api/not-a-real-route');

    expect(res.status).toBe(404);
  });
});
