# @f3d1/llmkit-cli

Local AI cost tracking for OpenAI and Anthropic clients that honor their standard base-URL
environment variables. The CLI wraps a command, observes compatible calls through a local proxy,
and prints a cost summary when the process exits.

## Usage

```bash
npx @f3d1/llmkit-cli -- python my_agent.py
npx @f3d1/llmkit-cli -- node agent.js
npx @f3d1/llmkit-cli -- your-binary --flag
```

The CLI sets `OPENAI_BASE_URL` and `ANTHROPIC_BASE_URL` for the child process. It cannot observe
calls that ignore those variables, use another protocol, or bypass that environment.

Use `-v` for per-request costs or `--json` for machine-readable output. The child still needs its
provider credentials. The CLI estimates observed cost; budget rejection requires gateway mode.

See the [CLI guide](https://github.com/smigolsmigol/llmkit/blob/main/docs/integrations/cli.md) for options, output and accuracy limits.

## License

[MIT](https://github.com/smigolsmigol/llmkit/blob/main/LICENSE)
