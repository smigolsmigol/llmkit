FROM node:22-slim

WORKDIR /app

RUN npm install -g @f3d1/llmkit-mcp-server

ENTRYPOINT ["llmkit-mcp"]
