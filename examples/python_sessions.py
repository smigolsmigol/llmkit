#!/usr/bin/env python3
"""Session tracking for multi-turn agents via LLMKit proxy."""
import os
from llmkit import LLMKit

kit = LLMKit(api_key=os.environ["LLMKIT_API_KEY"])
agent = kit.session()

print(f"session: {agent.session_id}")

r1, c1 = agent.chat(
    model="gpt-4o",
    messages=[{"role": "user", "content": "What is 2+2?"}],
)
print(f"turn 1: {r1.choices[0].message.content} (${c1.total_cost or 0:.6f})")

r2, c2 = agent.chat(
    model="gpt-4o",
    messages=[
        {"role": "user", "content": "What is 2+2?"},
        {"role": "assistant", "content": r1.choices[0].message.content or ""},
        {"role": "user", "content": "Now multiply that by 10"},
    ],
)
print(f"turn 2: {r2.choices[0].message.content} (${c2.total_cost or 0:.6f})")
print(f"session total: {agent.stats}")
