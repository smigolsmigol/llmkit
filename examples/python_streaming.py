#!/usr/bin/env python3
"""Streaming with cost callback - cost fires after the stream ends."""
import openai
from llmkit import tracked

costs = []

client = openai.OpenAI(
    http_client=tracked(on_cost=costs.append)
)

stream = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Write a haiku about API costs"}],
    stream=True,
    stream_options={"include_usage": True},
)

for chunk in stream:
    delta = chunk.choices[0].delta.content if chunk.choices else None
    if delta:
        print(delta, end="", flush=True)

print()
if costs:
    print(f"cost: ${costs[-1].total_cost:.6f}")
