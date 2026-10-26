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
});

describe('POST /api/payments/merge', () => {
  it('moves every payment from the duplicate member to the kept member', async () => {
    const keptCharge = await request(app)
      .post('/api/payments/charge')
      .send({ memberId: 2, amount: 49.99, reason: 'PREMIUM plan renewal' });
    const duplicateCharge = await request(app)
      .post('/api/payments/charge')
      .send({ memberId: 1, amount: 30, reason: 'duplicate account charge' });

    const res = await request(app)
      .post('/api/payments/merge')
      .send({ fromMemberId: 1, toMemberId: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ moved: 1 });

    const sourceHistory = await request(app).get('/api/payments/member/1');
    expect(sourceHistory.status).toBe(200);
    expect(sourceHistory.body).toEqual([]);

    const destinationHistory = await request(app).get('/api/payments/member/2');
    expect(destinationHistory.status).toBe(200);
    expect(destinationHistory.body).toHaveLength(2);
    expect(destinationHistory.body.map((p) => p.id).sort()).toEqual(
      [keptCharge.body.id, duplicateCharge.body.id].sort()
    );
  });

  it('keeps the details of the moved payments, including a refund link to its charge', async () => {
    const charge = await request(app)
      .post('/api/payments/charge')
      .send({ memberId: 1, amount: 49.99, reason: 'PREMIUM plan renewal' });
    const refund = await request(app).post('/api/payments/refund').send({
      memberId: 1,
      amount: 20,
      reason: 'early cancellation',
      relatedPaymentId: charge.body.id,
    });

    const res = await request(app)
      .post('/api/payments/merge')
      .send({ fromMemberId: 1, toMemberId: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ moved: 2 });

    const history = await request(app).get('/api/payments/member/2');
    expect(history.body).toHaveLength(2);

    const movedCharge = history.body.find((p) => p.id === charge.body.id);
    expect(movedCharge).toMatchObject({
      memberId: 2,
      type: 'CHARGE',
      status: 'SUCCESS',
      reason: 'PREMIUM plan renewal',
    });
    expect(Number(movedCharge.amount)).toBeCloseTo(49.99);

    const movedRefund = history.body.find((p) => p.id === refund.body.id);
    expect(movedRefund).toMatchObject({
      memberId: 2,
      type: 'REFUND',
      status: 'SUCCESS',
      reason: 'early cancellation',
      relatedPaymentId: charge.body.id,
    });
    expect(Number(movedRefund.amount)).toBeCloseTo(20);

    const sourceHistory = await request(app).get('/api/payments/member/1');
    expect(sourceHistory.body).toEqual([]);
  });

  it('orders the combined history most recent first', async () => {
    await request(app).post('/api/payments/charge').send({ memberId: 2, amount: 10 });
    await request(app).post('/api/payments/charge').send({ memberId: 1, amount: 20 });

    const res = await request(app)
      .post('/api/payments/merge')
      .send({ fromMemberId: 1, toMemberId: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ moved: 1 });

    const history = await request(app).get('/api/payments/member/2');
    expect(history.body).toHaveLength(2);
    const timestamps = history.body.map((p) => new Date(p.createdAt).getTime());
    expect(timestamps[0]).toBeGreaterThanOrEqual(timestamps[1]);
  });

  it('rejects a merge with missing or invalid member ids and leaves payments untouched', async () => {
    const charge = await request(app)
      .post('/api/payments/charge')
      .send({ memberId: 1, amount: 49.99 });

    const invalidBodies = [
      {},
      { toMemberId: 2 },
      { fromMemberId: 1 },
      { fromMemberId: 0, toMemberId: 2 },
      { fromMemberId: 1, toMemberId: -5 },
      { fromMemberId: 'not-a-number', toMemberId: 2 },
    ];

    for (const body of invalidBodies) {
      const res = await request(app).post('/api/payments/merge').send(body);
      expect(res.status).toBe(400);
    }

    const sourceHistory = await request(app).get('/api/payments/member/1');
    expect(sourceHistory.body).toHaveLength(1);
    expect(sourceHistory.body[0].id).toBe(charge.body.id);
  });

  it('returns moved 0 when the duplicate member has no payments', async () => {
    const charge = await request(app)
      .post('/api/payments/charge')
      .send({ memberId: 3, amount: 12.5 });

    const res = await request(app)
      .post('/api/payments/merge')
      .send({ fromMemberId: 1, toMemberId: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ moved: 0 });

    const history = await request(app).get('/api/payments/member/3');
    expect(history.body).toHaveLength(1);
    expect(history.body[0].id).toBe(charge.body.id);
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
