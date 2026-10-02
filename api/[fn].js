// Vercel entry. One function serves /api/search, /api/radio, /api/alt and /api/import.
import { handlers } from './_core.js';

export function GET(request) {
  const name = new URL(request.url).pathname.split('/').pop();
  const handler = handlers[name];
  return handler ? handler(request) : new Response('Not found', { status: 404 });
}
