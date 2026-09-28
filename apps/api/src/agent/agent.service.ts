// The agent loop: the model reads the conversation, may call tools, sees their results,
// and finally answers in text. The backend stays in charge: it decides which tools exist,
// runs them as the logged-in user, caps the number of steps, and checks that every price
// in the answer really came from a tool result.
import type { SessionUser } from '../auth/sessions.js';
import { pool } from '../db/pool.js';
import { AppError, notFound } from '../errors.js';
import { logger } from '../logger.js';
import { generate, type Content, type Part } from './gemini.js';
import { runTool, toolDeclarations, type Card } from './tools.js';

const MAX_STEPS = 6; // tool rounds per customer message
const HISTORY = 40; // messages of context sent to the model

function systemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You are a friendly, precise travel booking assistant for a travel agency.
Today is ${today}. Resolve relative dates ("next Friday") into YYYY-MM-DD. Use IATA airport codes (Dubai = DXB, London Heathrow = LHR; ask if a city has several airports and it matters).
Rules:
- Use tools for every fact. Never invent flights, prices, times, booking references or ticket numbers.
- Only state a price that appears in a tool result, with its currency, exactly as given.
- Before the customer books, call check_price. If the price changed, say the old price, the new price and the difference clearly.
- If an alternative flight is offered (match EQUIVALENT), say plainly that it is a different flight and what changed.
- You cannot book or take payment. When the customer wants to book, tell them to press "Book" on the option card shown with your answer.
- Ask a short question when the request is missing something essential (dates, number of travellers, children's ages).
- Keep answers short: a few sentences, then the key options as a brief list.`;
}

async function getOrCreateConversation(actor: SessionUser, conversationId?: string): Promise<string> {
  if (conversationId) {
    const { rows } = await pool.query('SELECT id FROM agent_conversations WHERE id = $1 AND user_id = $2', [conversationId, actor.id]);
    if (!rows[0]) throw notFound('Conversation not found');
    return conversationId;
  }
  const { rows } = await pool.query<{ id: string }>('INSERT INTO agent_conversations (user_id) VALUES ($1) RETURNING id', [actor.id]);
  return rows[0]!.id;
}

async function loadHistory(conversationId: string): Promise<Content[]> {
  const { rows } = await pool.query<{ role: 'user' | 'model'; parts: Part[] }>(
    `SELECT role, parts FROM (SELECT id, role, parts FROM agent_messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT $2) t ORDER BY id`,
    [conversationId, HISTORY],
  );
  // The window must not start in the middle of a tool exchange.
  while (rows.length && (rows[0]!.role !== 'user' || rows[0]!.parts.some((p) => p.functionResponse))) rows.shift();
  return rows.map((r) => ({ role: r.role, parts: r.parts }));
}

const save = (conversationId: string, c: Content) =>
  pool.query('INSERT INTO agent_messages (conversation_id, role, parts) VALUES ($1, $2, $3)', [conversationId, c.role, JSON.stringify(c.parts)]);

const textOf = (c: Content) => c.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();

/** Every "123.45"-style amount in the answer must appear in some tool result we returned. */
function ungroundedAmounts(reply: string, toolJson: string): string[] {
  const amounts = reply.match(/\d[\d,]*\.\d{2}/g) ?? [];
  return amounts.filter((a) => !toolJson.includes(a.replace(/,/g, '')));
}

export const agentService = {
  async chat(actor: SessionUser, input: { conversationId?: string; message: string }) {
    const conversationId = await getOrCreateConversation(actor, input.conversationId);
    const contents = await loadHistory(conversationId);
    const userTurn: Content = { role: 'user', parts: [{ text: input.message }] };
    contents.push(userTurn);
    await save(conversationId, userTurn);

    const cards: Card[] = [];
    let toolJson = contents.flatMap((c) => c.parts).filter((p) => p.functionResponse).map((p) => JSON.stringify(p.functionResponse)).join('\n');

    for (let step = 0; step < MAX_STEPS; step++) {
      const reply = await generate({ system: systemPrompt(), contents, tools: toolDeclarations });
      contents.push(reply);
      await save(conversationId, reply);

      const calls = reply.parts.filter((p) => p.functionCall);
      if (!calls.length) {
        let text = textOf(reply);
        const bad = ungroundedAmounts(text, toolJson);
        if (bad.length) {
          // The model stated a price no tool returned. Don't show it to the customer.
          logger.warn({ conversationId, bad }, 'Assistant stated ungrounded amounts; replaced');
          text = 'I found some options. The exact, current prices are shown on the cards below; please check them there.';
        }
        return { conversationId, reply: text || 'Done.', cards };
      }

      const responses: Part[] = [];
      for (const p of calls) {
        const { name, args = {}, id } = p.functionCall!;
        let response: Record<string, unknown>;
        try {
          const out = await runTool(actor, name, args);
          response = out.result;
          cards.push(...(out.cards ?? []));
        } catch (err) {
          // Tool errors go back to the model as data, so it can explain or ask for missing details.
          const e = err as AppError & { issues?: { path: (string | number)[]; message: string }[] };
          response = { error: e.issues ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : e.message };
          logger.info({ tool: name, error: response.error }, 'Tool call failed');
        }
        responses.push({ functionResponse: { name, response, ...(id ? { id } : {}) } });
        toolJson += '\n' + JSON.stringify(response);
      }
      const toolTurn: Content = { role: 'user', parts: responses };
      contents.push(toolTurn);
      await save(conversationId, toolTurn);
    }
    return { conversationId, reply: 'That took more steps than I am allowed. Please try a simpler request.', cards };
  },

  async history(actor: SessionUser, conversationId: string) {
    await getOrCreateConversation(actor, conversationId);
    const { rows } = await pool.query<{ role: 'user' | 'model'; parts: Part[]; created_at: Date }>(
      'SELECT role, parts, created_at FROM agent_messages WHERE conversation_id = $1 ORDER BY id',
      [conversationId],
    );
    return rows
      .filter((r) => r.parts.some((p) => p.text && !p.thought))
      .map((r) => ({ role: r.role, text: textOf({ role: r.role, parts: r.parts }), at: r.created_at.toISOString() }));
  },
};

