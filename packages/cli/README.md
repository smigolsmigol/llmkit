# @f3d1/llmkit-cli

Local AI cost tracking for OpenAI and Anthropic clients that honor their standard base-URL environment variables. Wrap a command, observe compatible calls through a local proxy, and print a cost summary when it exits.

## Usage

```bash
npx @f3d1/llmkit-cli -- python my_agent.py
npx @f3d1/llmkit-cli -- node agent.js
npx @f3d1/llmkit-cli -- your-binary --flag
```

The CLI sets `OPENAI_BASE_URL` and `ANTHROPIC_BASE_URL` for the child process. Calls that ignore those variables, use another protocol, or bypass that environment are not observed.

## Options

```text
--port <N>      proxy port (default: random)
-v, --verbose   per-request costs as they happen
--json          machine-readable output
-V, --version   print version
-h, --help      show this help
```

## Illustrative output shape

```text
LLMKit cost summary

$0.0342 total  |  5 requests  |  12.8s  |  ~$9.62/hr

claude-sonnet  3 requests  $0.0291
gpt-4.1-mini   2 requests  $0.0051
```

The numbers above illustrate the output format; actual values come from the calls observed in your wrapped process.

## Accuracy boundary

- Cost is estimated from provider usage fields and the bundled pricing snapshot.
- Calls without recognized usage metadata remain unpriced.
- Provider invoice adjustments, discounts, and later price changes may differ.
- The CLI observes cost; budget rejection requires gateway mode.

## Docs

Full documentation and proxy setup: [github.com/smigolsmigol/llmkit](https://github.com/smigolsmigol/llmkit)

## License

MIT
