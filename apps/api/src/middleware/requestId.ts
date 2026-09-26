// Gives every request a unique ID, returns it in the X-Request-Id response header,
// and attaches it to every log line for that request. When a user reports an error,
// the ID they see lets us find exactly that request in the logs.
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const VALID_ID = /^[A-Za-z0-9-]{8,64}$/;

export const requestId: RequestHandler = (req, res, next) => {
  // Reuse an ID sent by a trusted caller (e.g. a gateway) if it looks sane;
  // otherwise make our own. Never trust arbitrary header content blindly.
  const incoming = req.get('x-request-id');
  const id = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
};
