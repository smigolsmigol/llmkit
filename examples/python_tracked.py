#!/usr/bin/env python3
"""Track OpenAI costs with zero code changes."""
from llmkit import tracked
import openai

client = openai.OpenAI(
    http_client=tracked(
        on_cost=lambda c: print(f"${c.total_cost:.6f} ({c.estimated=})")
    )
)
r = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello"}],
)
print(r.choices[0].message.content)
