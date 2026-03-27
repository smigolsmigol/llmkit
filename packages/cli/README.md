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
--port <N>      proxy port (default: random)
-v, --verbose   per-request costs as they happen
--json          machine-readable output
-V, --version   print version
-h, --help      show this help
```

### Example output

```
    ██╗     ██╗     ███╗   ███╗██╗  ██╗██╗████████╗
    ██║     ██║     ████╗ ████║██║ ██╔╝██║╚══██╔══╝
    ██║     ██║     ██╔████╔██║█████╔╝ ██║   ██║
    ██║     ██║     ██║╚██╔╝██║██╔═██╗ ██║   ██║
    ███████╗███████╗██║ ╚═╝ ██║██║  ██╗██║   ██║
    ╚══════╝╚══════╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝   ╚═╝

    $0.0342 total  5 requests  12.8s  ~$9.62/hr

    claude-sonnet-4-6  3 reqs   $0.0291  ████████████████████
    gpt-4.1-mini       2 reqs   $0.0051  ███░░░░░░░░░░░░░░░░░
```

## Docs

Full documentation and proxy setup: [github.com/smigolsmigol/llmkit](https://github.com/smigolsmigol/llmkit)

## License

MIT
