// Cloudflare Workers entry. Static files come from public/, everything else lands here.
import { handlers, share } from './api/_core.js';
import { sync } from './api/sync.js';

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (/^\/s\/[\w-]{11}$/.test(pathname)) return share(request, ctx);
    if (pathname === '/api/sync' || pathname.startsWith('/api/sync/')) return sync(request, env.SYNC);
    const name = pathname.match(/^\/api\/(\w+)$/)?.[1];
    if (name && handlers[name]) return handlers[name](request, ctx);
    return env.ASSETS.fetch(request);
  },
};
