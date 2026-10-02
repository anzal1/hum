// Cloudflare Workers entry. Static files come from public/, everything else lands here.
import { handlers, share } from './api/_core.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (/^\/s\/[\w-]{11}$/.test(pathname)) return share(request);
    const name = pathname.match(/^\/api\/(\w+)$/)?.[1];
    if (name && handlers[name]) return handlers[name](request);
    return env.ASSETS.fetch(request);
  },
};
