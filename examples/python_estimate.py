#!/usr/bin/env python3
"""Local cost estimation without a proxy - just needs token counts."""
from openai import OpenAI
from llmkit import estimate_cost

client = OpenAI()

r = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Explain quicksort in one sentence"}],
)

cost = estimate_cost(r)
print(r.choices[0].message.content)
print(f"estimated: ${cost.total_cost:.6f}" if cost.total_cost else "unknown model")
