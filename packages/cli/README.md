# @f3d1/llmkit-cli

Zero-code AI cost tracking. Wraps any command, intercepts OpenAI and Anthropic API calls via a local proxy, prints a cost summary when it exits.

## Usage

```bash
npx @f3d1/llmkit-cli -- python my_agent.py
npx @f3d1/llmkit-cli -- node agent.js
npx @f3d1/llmkit-cli -- your-binary --flag
```

No code changes needed. The CLI sets `OPENAI_BASE_URL` and `ANTHROPIC_BASE_URL` to a local proxy that records every request and calculates cost from the token usage.

### Options

```
--port N      proxy port (default: random open port)
--verbose     log each intercepted request
--json        output cost summary as JSON
```

### Example output

```
LLMKit Cost Summary
---
Total: $0.0342 (5 requests)

By model:
  claude-sonnet-4-6: $0.0291 (3 reqs)
  gpt-4.1-mini: $0.0051 (2 reqs)
```

## Docs

Full documentation and proxy setup: [github.com/smigolsmigol/llmkit](https://github.com/smigolsmigol/llmkit)

## License

MIT
