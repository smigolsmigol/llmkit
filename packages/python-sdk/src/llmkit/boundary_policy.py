"""Declared route policy shared by offline checking and runtime admission."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .boundary import (
    BoundaryRuntime,
    CoverageReport,
    CoverageStatus,
    EffectScope,
    HmacAuthority,
    canonical_arguments,
    content_sha256,
)

POLICY_VERSION = "llmkit-boundary-policy-v1"
_MAX_POLICY_BYTES = 65536
_NAME = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.:/-]{0,255}")


@dataclass(frozen=True)
class BoundaryRoute:
    id: str
    surface: str
    effect_class: str
    target: str
    version: str
    enrolled: bool

    def __post_init__(self) -> None:
        for value in (self.id, self.surface, self.effect_class, self.target, self.version):
            if not isinstance(value, str) or _NAME.fullmatch(value) is None:
                raise ValueError("invalid_boundary_route_field")
        if type(self.enrolled) is not bool:
            raise ValueError("invalid_boundary_route_enrollment")

    @property
    def scope(self) -> EffectScope:
        return EffectScope(self.effect_class, self.target, self.version)


def _coverage(adapter: str) -> CoverageReport:
    # Import only the selected built-in adapter, never code named in a policy file.
    if adapter == "openai-agents":
        from .integrations.openai_agents import openai_agents_coverage

        return openai_agents_coverage(model_dispatch_enrolled=True)
    from .integrations.pydantic_ai import pydantic_ai_coverage

    return pydantic_ai_coverage(model_dispatch_enrolled=True, function_tool_enrolled=True)


@dataclass(frozen=True)
class BoundaryPolicy:
    adapter: str
    routes: tuple[BoundaryRoute, ...]
    require_trusted_provenance: bool = False

    def __post_init__(self) -> None:
        if self.adapter not in ("openai-agents", "pydantic-ai"):
            raise ValueError("unsupported_boundary_adapter")
        if type(self.require_trusted_provenance) is not bool:
            raise ValueError("invalid_boundary_provenance_requirement")
        if (
            type(self.routes) is not tuple
            or not 1 <= len(self.routes) <= 128
            or any(not isinstance(route, BoundaryRoute) for route in self.routes)
        ):
            raise ValueError("invalid_boundary_routes")
        if len({route.id for route in self.routes}) != len(self.routes):
            raise ValueError("duplicate_boundary_route")
        if len({route.scope for route in self.routes}) != len(self.routes):
            raise ValueError("duplicate_boundary_effect")

    @classmethod
    def parse(cls, source: str) -> BoundaryPolicy:
        if len(source.encode("utf-8")) > _MAX_POLICY_BYTES:
            raise ValueError("boundary_policy_too_large")
        try:
            value = canonical_arguments(source)
            if set(value) != {"version", "adapter", "require_trusted_provenance", "routes"}:
                raise ValueError("invalid_boundary_policy_fields")
            if value["version"] != POLICY_VERSION or type(value["routes"]) is not list:
                raise ValueError("invalid_boundary_policy_version_or_routes")
            if not 1 <= len(value["routes"]) <= 128:
                raise ValueError("invalid_boundary_routes")
            fields = {"id", "surface", "effect_class", "target", "version", "enrolled"}
            routes = []
            for route in value["routes"]:
                if type(route) is not dict or set(route) != fields:
                    raise ValueError("invalid_boundary_route_fields")
                routes.append(BoundaryRoute(**route))
            return cls(value["adapter"], tuple(routes), value["require_trusted_provenance"])
        except (ValueError, TypeError, RecursionError) as error:
            raise ValueError("invalid_boundary_policy") from error

    @classmethod
    def load(cls, path: str | Path) -> BoundaryPolicy:
        with Path(path).open("rb") as stream:
            raw = stream.read(_MAX_POLICY_BYTES + 1)
        if len(raw) > _MAX_POLICY_BYTES:
            raise ValueError("boundary_policy_too_large")
        return cls.parse(raw.decode("utf-8"))

    def as_dict(self) -> dict[str, Any]:
        return {
            "version": POLICY_VERSION,
            "adapter": self.adapter,
            "require_trusted_provenance": self.require_trusted_provenance,
            "routes": [asdict(route) for route in sorted(self.routes, key=lambda route: route.id)],
        }

    @property
    def sha256(self) -> str:
        return content_sha256(self.as_dict())

    def check(self) -> dict[str, Any]:
        try:
            coverage = _coverage(self.adapter)
        except ImportError:
            coverage = None
        findings = []
        for route in sorted(self.routes, key=lambda route: route.id):
            reason = None
            if not route.enrolled:
                reason = "unenrolled_route"
            elif coverage is None:
                reason = "adapter_unavailable"
            elif coverage.status_for(route.surface) is not CoverageStatus.ENFORCED:
                reason = "unsupported_surface"
            elif route.surface == "model_dispatch":
                if (
                    route.effect_class != "model.dispatch"
                    or route.version != "llmkit-gateway-receipt-v1"
                    or len(route.target.split(":")) < 3
                    or not route.target.startswith("llmkit-gateway:")
                    or not all(route.target.split(":"))
                ):
                    reason = "model_binding_mismatch"
            elif route.effect_class == "model.dispatch":
                reason = "tool_binding_mismatch"
            if reason is not None:
                findings.append({"route": route.id, "reason": reason})
        return {
            "version": POLICY_VERSION,
            "policy_sha256": self.sha256,
            "adapter": self.adapter,
            "inventory_kind": "declared",
            "runtime_enforcement_verified": False,
            "ok": not findings,
            "findings": findings,
        }

    def runtime(self, *, authority: HmacAuthority) -> BoundaryRuntime:
        if not self.check()["ok"]:
            raise ValueError("boundary_policy_check_failed")
        return BoundaryRuntime(
            authority=authority,
            policy_sha256=self.sha256,
            adapter=self.adapter,
            require_trusted_provenance=self.require_trusted_provenance,
            allowed_effects=tuple(route.scope for route in self.routes),
        )
