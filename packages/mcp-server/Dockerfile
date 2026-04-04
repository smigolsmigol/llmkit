FROM node:20-alpine@sha256:f598378b5240225e6beab68fa9f356db1fb8efe55173e6d4d8153113bb8f333c
WORKDIR /app
COPY package.json .
RUN npm ci --ignore-scripts 2>/dev/null || npm install --ignore-scripts
ENTRYPOINT ["npx", "@f3d1/llmkit-mcp-server"]
