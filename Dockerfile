FROM node:22-slim@sha256:80fdb3f57c815e1b638d221f30a826823467c4a56c8f6a8d7aa091cd9b1675ea

WORKDIR /app

COPY packages/mcp-server/package.json .
RUN npm ci --ignore-scripts 2>/dev/null || npm install --ignore-scripts

ENTRYPOINT ["npx", "@f3d1/llmkit-mcp-server"]
