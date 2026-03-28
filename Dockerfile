FROM node:22-slim@sha256:80fdb3f57c815e1b638d221f30a826823467c4a56c8f6a8d7aa091cd9b1675ea

WORKDIR /app

RUN npm install -g @f3d1/llmkit-mcp-server@0.4.4

ENTRYPOINT ["llmkit-mcp"]
