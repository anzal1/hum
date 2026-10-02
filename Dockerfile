FROM node:22-alpine
WORKDIR /app
COPY package.json server.js mcp.js ./
COPY api ./api
COPY public ./public
ENV HOST=0.0.0.0 PORT=3737
EXPOSE 3737
USER node
CMD ["node", "server.js"]
