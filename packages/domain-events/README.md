# packages/domain-events

v2 の Domain Event 名、payload 契約、versioning 規約を置く領域。

対象:

- `CaseCreated`
- `VelocityMetricRefreshed`
- `RequirementArtifactFinalized`
- `ProposalApproved`
- `HandoffCreated`

実装開始時に Pub/Sub schema と outbox contract をここへ集約する。
