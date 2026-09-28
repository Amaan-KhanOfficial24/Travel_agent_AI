// The assistant loop against the stand-in Gemini (same request/response format).
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { signUp } from '../test/auth.js';
import { resetDb } from '../test/db.js';

const app = createApp();
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
type Agent = Awaited<ReturnType<typeof signUp>>['agent'];
let user: Agent;

beforeEach(async () => {
  await resetDb();
  user = (await signUp(app)).agent;
});
afterAll(() => pool.end());

describe('assistant', () => {
  it('searches with a tool, answers with a real price, and returns offer cards', async () => {
    const res = await user.post('/agent/chat').send({ message: `Find flights from DXB to LHR on ${future(30)} for 2 adults` });
    expect(res.status).toBe(200);
    const { reply, cards, conversationId } = res.body.data;
    expect(cards[0].type).toBe('offers');
    const cheapest = cards[0].offers[0];
    expect(reply).toContain(cheapest.totalAmount);
    expect(conversationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('remembers the conversation: "check the price" uses the earlier search', async () => {
    const first = await user.post('/agent/chat').send({ message: `Flights from LHR to STN on ${future(30)}` });
    const res = await user.post('/agent/chat').send({ conversationId: first.body.data.conversationId, message: 'check the price of the cheapest' });
    expect(res.body.data.cards[0].type).toBe('quote');
    expect(res.body.data.reply).toMatch(/price changed from .* to /);
  });

  it('never shows a price the tools did not return (grounding guard)', async () => {
    const res = await user.post('/agent/chat').send({ message: `INVENT flights from DXB to LHR on ${future(30)}` });
    expect(res.body.data.reply).not.toContain('123.45');
    expect(res.body.data.reply).toMatch(/cards below/);
  });

  it('asks a question when details are missing', async () => {
    const res = await user.post('/agent/chat').send({ message: 'I want to travel' });
    expect(res.body.data.reply).toMatch(/Where would you like to fly/);
    expect(res.body.data.cards).toEqual([]);
  });

  it("cannot open another user's conversation", async () => {
    const first = await user.post('/agent/chat').send({ message: 'hello' });
    const other = (await signUp(app)).agent;
    const res = await other.post('/agent/chat').send({ conversationId: first.body.data.conversationId, message: 'hi' });
    expect(res.status).toBe(404);
  });

  it('requires login', async () => {
    expect((await request(app).post('/agent/chat').send({ message: 'hi' })).status).toBe(401);
  });
});
