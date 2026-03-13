from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class CostInfo:
    """Cost metadata from LLMKit proxy response headers or local estimation."""

    total_cost: float | None = None
    provider: str | None = None
    latency_ms: float | None = None
    session_id: str | None = None
    estimated: bool = False

    @classmethod
    def from_headers(cls, headers: Any) -> CostInfo:
        get = (
            headers.get
            if isinstance(headers, dict)
            else getattr(headers, "get", lambda k, d=None: d)
        )
        raw_cost = get("x-llmkit-cost", None)
        raw_latency = get("x-llmkit-latency-ms", None)
        try:
            total_cost = float(raw_cost) if raw_cost else None
        except (ValueError, TypeError):
            total_cost = None
        try:
            latency_ms = float(raw_latency) if raw_latency else None
        except (ValueError, TypeError):
            latency_ms = None
        return cls(
            total_cost=total_cost,
            provider=get("x-llmkit-provider", None),
            latency_ms=latency_ms,
            session_id=get("x-llmkit-session-id", None),
            estimated=False,
        )


@dataclass
class SessionStats:
    """Running cost aggregation across requests in a session."""

    session_id: str = ""
    total_cost: float = 0.0
    request_count: int = 0
    _costs: list[CostInfo] = field(default_factory=list, repr=False)

    def record(self, cost: CostInfo) -> None:
        self._costs.append(cost)
        self.request_count += 1
        if cost.total_cost is not None:
            self.total_cost += cost.total_cost

    @property
    def avg_cost(self) -> float | None:
        if self.request_count == 0:
            return None
        return self.total_cost / self.request_count

    def __str__(self) -> str:
        parts = [f"{self.request_count} requests"]
        parts.append(f"${self.total_cost:.4f} total")
        if self.avg_cost is not None:
            parts.append(f"${self.avg_cost:.4f} avg")
        if self.session_id:
            parts.append(f"session={self.session_id}")
        return " | ".join(parts)
