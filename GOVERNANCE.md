# LLMKit governance

Last reviewed: 2026-08-13

LLMKit uses a single-maintainer governance model. Federico Benini
([@smigolsmigol](https://github.com/smigolsmigol)) is the project lead and current maintainer. The
maintainer has final responsibility for project direction, releases, security response, and the use
of project infrastructure.

This model describes current authority. It does not claim a second maintainer, shared credential
custody, or access continuity that does not yet exist.

## How decisions are made

1. Feature proposals, behavior changes, and support questions start in a GitHub issue or discussion.
2. The maintainer decides whether a proposal fits the [roadmap](ROADMAP.md), security requirements,
   maintenance cost, and compatibility commitments.
3. Accepted changes are reviewed through a pull request. Required CI must pass before merge.
4. The maintainer records material compatibility, security, or governance decisions in the owning
   repository document or pull request.
5. The maintainer may reverse an earlier decision when new evidence changes the risk or product
   boundary. The reason must be recorded publicly unless it contains embargoed security details.

Security reports must use the private process in [SECURITY.md](SECURITY.md), not a public issue.

## Roles and responsibilities

| Role | Current holder | Responsibilities |
| --- | --- | --- |
| Project lead and maintainer | Federico Benini ([@smigolsmigol](https://github.com/smigolsmigol)) | Set direction, decide disputed proposals, review and merge changes, maintain project policy, and appoint or remove maintainers. |
| Release operator | Federico Benini | Freeze a reviewed revision, run release gates, publish supported packages, verify public artifacts, and document rollback or recovery. |
| Security contact | Federico Benini via `security@llmkit.sh` | Receive private reports, acknowledge and triage them, coordinate fixes and disclosure, and credit reporters who do not request anonymity. |
| Contributor | Anyone whose contribution is accepted | Follow [CONTRIBUTING.md](CONTRIBUTING.md), certify contribution rights, add tests and documentation required by the change, and respond to review findings. |

One person currently holds the three maintainer roles. A role table is not a substitute for a second
qualified operator.

## Disagreements and appeals

Keep technical disagreement on the relevant issue or pull request. State the observed behavior,
the user or compatibility consequence, and the evidence that would change the decision. The
maintainer makes the final project decision.

Conduct complaints follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). A complaint about the sole
maintainer cannot be independently adjudicated inside the current project. A reporter may use the
Contributor Covenant escalation route identified in the code of conduct or exercise the rights
provided by the MIT license.

## Becoming a maintainer

Maintainer access is granted by the project lead after a contributor demonstrates sustained work in
the affected area, sound review judgment, reliable security handling, and the ability to operate the
release path. Access is scoped to the work the person can safely own and may be removed when the
person is inactive or no longer accepts the responsibility.

There is no automatic promotion based on commit count.

## Continuity status

The project does not yet meet its target for access continuity or a bus factor of two. No public
document should claim otherwise. Closing this gap requires a real second operator or an enforceable
recovery arrangement that can create and close issues, accept changes, and publish releases without
exposing recovery secrets.

Governance changes use the same pull-request and review path as code changes. Emergency security
changes may be prepared privately, but the resulting policy must be reconciled here after disclosure.
