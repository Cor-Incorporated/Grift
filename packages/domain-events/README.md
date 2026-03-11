# @bd/domain-events

JSON Schema catalog for Grift v2 Pub/Sub domain events.

## Validate

```bash
npm install
npm run validate
```

## Event Catalog

| Event | Schema | Payload basis |
| --- | --- | --- |
| `CaseCreated` | `schemas/CaseCreated.json` | `cases` |
| `CaseUpdated` | `schemas/CaseUpdated.json` | `cases` |
| `RequirementArtifactGenerated` | `schemas/RequirementArtifactGenerated.json` | `requirement_artifacts` |
| `EstimateRequested` | `schemas/EstimateRequested.json` | `estimates` |
| `EstimateCompleted` | `schemas/EstimateCompleted.json` | `estimates` |
| `ApprovalDecisionMade` | `schemas/ApprovalDecisionMade.json` | `approval_decisions` |
| `HandoffInitiated` | `schemas/HandoffInitiated.json` | `handoff_packages` |
| `HandoffCompleted` | `schemas/HandoffCompleted.json` | `handoff_packages`, `handoff_issue_mappings` |
| `VelocityMetricRefreshed` | `schemas/VelocityMetricRefreshed.json` | `repository_snapshots` |
| `MarketEvidenceCollected` | `schemas/MarketEvidenceCollected.json` | `evidence_fragments` |
| `ProjectOutcomeRecorded` | `schemas/ProjectOutcomeRecorded.json` | `project_outcomes` |

All event schemas share the common envelope in `schemas/_envelope.json`.

## Envelope (ADR-0009 / ADR-0015)

Required fields:

- `event_id`
- `event_type`
- `tenant_id`
- `aggregate_type`
- `aggregate_id`
- `aggregate_version` (integer)
- `idempotency_key` (string)
- `occurred_at` (date-time)
- `producer`
- `source_domain`
- `payload`

Backward compatibility:

- Legacy `timestamp` remains as a deprecated alias for `occurred_at`.
- Legacy semver `version` remains as a deprecated field; use `aggregate_version` for ordering.
