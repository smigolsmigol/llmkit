"""Attribute AI costs to the business dimensions that created them."""

from llmkit import LLMKit

client = LLMKit(
    api_key="llmk_your_key",
    customer_id="tenant_acme",
    feature_id="support_copilot",
    agent_id="refund_agent",
)

run = client.session("refund_01JEXAMPLE")
completion, cost = run.chat(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Summarize this refund request."}],
)

print(completion.choices[0].message.content)
print(f"This customer workflow cost ${cost.total_cost:.6f}")
