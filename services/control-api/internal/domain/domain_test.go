package domain

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestTenantJSONRoundTrip(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	tenant := Tenant{
		ID:             uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"),
		Name:           "Acme Corp",
		Slug:           "acme-corp",
		Plan:           PlanPro,
		Settings:       json.RawMessage(`{"theme":"dark"}`),
		AnalyticsOptIn: true,
		TrainingOptIn:  false,
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	data, err := json.Marshal(tenant)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	var got Tenant
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}

	if got.ID != tenant.ID {
		t.Errorf("ID = %v, want %v", got.ID, tenant.ID)
	}
	if got.Name != tenant.Name {
		t.Errorf("Name = %v, want %v", got.Name, tenant.Name)
	}
	if got.Slug != tenant.Slug {
		t.Errorf("Slug = %v, want %v", got.Slug, tenant.Slug)
	}
	if got.Plan != tenant.Plan {
		t.Errorf("Plan = %v, want %v", got.Plan, tenant.Plan)
	}
	if got.AnalyticsOptIn != tenant.AnalyticsOptIn {
		t.Errorf("AnalyticsOptIn = %v, want %v", got.AnalyticsOptIn, tenant.AnalyticsOptIn)
	}
	if got.TrainingOptIn != tenant.TrainingOptIn {
		t.Errorf("TrainingOptIn = %v, want %v", got.TrainingOptIn, tenant.TrainingOptIn)
	}
}

func TestTenantJSONFieldNames(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	tenant := Tenant{
		ID:        uuid.MustParse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"),
		Name:      "Test",
		Slug:      "test",
		Plan:      PlanFree,
		Settings:  json.RawMessage(`{}`),
		CreatedAt: now,
		UpdatedAt: now,
	}

	data, err := json.Marshal(tenant)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	var m map[string]json.RawMessage
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("Unmarshal to map error = %v", err)
	}

	requiredFields := []string{
		"id", "name", "slug", "plan", "settings",
		"analytics_opt_in", "training_opt_in",
		"created_at", "updated_at",
	}
	for _, field := range requiredFields {
		if _, ok := m[field]; !ok {
			t.Errorf("missing JSON field %q", field)
		}
	}
}

func TestCaseJSONRoundTrip(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	priority := CasePriorityHigh
	company := "Test Inc"
	c := Case{
		ID:          uuid.New(),
		TenantID:    uuid.New(),
		Title:       "New website project",
		Type:        CaseTypeNewProject,
		Status:      CaseStatusDraft,
		Priority:    &priority,
		CompanyName: &company,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	data, err := json.Marshal(c)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	var got Case
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}

	if got.Title != c.Title {
		t.Errorf("Title = %v, want %v", got.Title, c.Title)
	}
	if got.Type != c.Type {
		t.Errorf("Type = %v, want %v", got.Type, c.Type)
	}
	if got.Status != c.Status {
		t.Errorf("Status = %v, want %v", got.Status, c.Status)
	}
	if got.Priority == nil || *got.Priority != priority {
		t.Errorf("Priority = %v, want %v", got.Priority, &priority)
	}
	if got.CompanyName == nil || *got.CompanyName != company {
		t.Errorf("CompanyName = %v, want %v", got.CompanyName, &company)
	}
}

func TestCaseOmitsNilOptionalFields(t *testing.T) {
	c := Case{
		ID:        uuid.New(),
		TenantID:  uuid.New(),
		Title:     "Minimal",
		Type:      CaseTypeUndetermined,
		Status:    CaseStatusDraft,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	data, err := json.Marshal(c)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	var m map[string]json.RawMessage
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("Unmarshal to map error = %v", err)
	}

	optionalFields := []string{
		"priority", "business_line", "existing_system_url",
		"spec_markdown", "contact_name", "contact_email",
		"company_name", "created_by_uid",
	}
	for _, field := range optionalFields {
		if _, ok := m[field]; ok {
			t.Errorf("expected field %q to be omitted when nil", field)
		}
	}
}

func TestRequirementArtifactJSONRoundTrip(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	creator := "user-123"
	chunk1 := uuid.New()
	chunk2 := uuid.New()
	ra := RequirementArtifact{
		ID:           uuid.New(),
		TenantID:     uuid.New(),
		CaseID:       uuid.New(),
		Version:      2,
		Markdown:     "# Requirements\n\n- Feature A\n- Feature B",
		SourceChunks: []uuid.UUID{chunk1, chunk2},
		Status:       ArtifactStatusFinalized,
		CreatedByUID: &creator,
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	data, err := json.Marshal(ra)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	var got RequirementArtifact
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}

	if got.Version != ra.Version {
		t.Errorf("Version = %v, want %v", got.Version, ra.Version)
	}
	if got.Markdown != ra.Markdown {
		t.Errorf("Markdown = %v, want %v", got.Markdown, ra.Markdown)
	}
	if len(got.SourceChunks) != 2 {
		t.Fatalf("SourceChunks len = %d, want 2", len(got.SourceChunks))
	}
	if got.SourceChunks[0] != chunk1 {
		t.Errorf("SourceChunks[0] = %v, want %v", got.SourceChunks[0], chunk1)
	}
	if got.Status != ArtifactStatusFinalized {
		t.Errorf("Status = %v, want %v", got.Status, ArtifactStatusFinalized)
	}
}

func TestEstimateJSONRoundTrip(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	inv := 10.0
	impl := 80.0
	test := 20.0
	buf := 10.0
	est := Estimate{
		ID:                 uuid.New(),
		TenantID:           uuid.New(),
		CaseID:             uuid.New(),
		EstimateMode:       EstimateModeMarketComparison,
		Status:             EstimateStatusDraft,
		YourHourlyRate:     8000,
		YourEstimatedHours: 120,
		TotalYourCost:      960000,
		HoursInvestigation: &inv,
		HoursImplementation: &impl,
		HoursTesting:       &test,
		HoursBuffer:        &buf,
		Multiplier:         1.8,
		RiskFlags:          []string{"complex_integration", "tight_deadline"},
		ThreeWayProposal:   json.RawMessage(`{"our_proposal":{}}`),
		CreatedAt:          now,
		UpdatedAt:          now,
	}

	data, err := json.Marshal(est)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	var got Estimate
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}

	if got.EstimateMode != EstimateModeMarketComparison {
		t.Errorf("EstimateMode = %v, want %v", got.EstimateMode, EstimateModeMarketComparison)
	}
	if got.YourHourlyRate != 8000 {
		t.Errorf("YourHourlyRate = %v, want 8000", got.YourHourlyRate)
	}
	if got.Multiplier != 1.8 {
		t.Errorf("Multiplier = %v, want 1.8", got.Multiplier)
	}
	if len(got.RiskFlags) != 2 {
		t.Fatalf("RiskFlags len = %d, want 2", len(got.RiskFlags))
	}
	if got.RiskFlags[0] != "complex_integration" {
		t.Errorf("RiskFlags[0] = %v, want complex_integration", got.RiskFlags[0])
	}
}

func TestApprovalDecisionJSONRoundTrip(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	comment := "Looks good, approved."
	role := "admin"
	ad := ApprovalDecision{
		ID:            uuid.New(),
		TenantID:      uuid.New(),
		ProposalID:    uuid.New(),
		Decision:      DecisionApproved,
		DecidedByUID:  "user-456",
		DecidedByRole: &role,
		Comment:       &comment,
		DecidedAt:     now,
		CreatedAt:     now,
	}

	data, err := json.Marshal(ad)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	var got ApprovalDecision
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}

	if got.Decision != DecisionApproved {
		t.Errorf("Decision = %v, want %v", got.Decision, DecisionApproved)
	}
	if got.DecidedByUID != "user-456" {
		t.Errorf("DecidedByUID = %v, want user-456", got.DecidedByUID)
	}
	if got.Comment == nil || *got.Comment != comment {
		t.Errorf("Comment = %v, want %v", got.Comment, &comment)
	}
}

func TestProposalSessionJSONRoundTrip(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	ps := ProposalSession{
		ID:         uuid.New(),
		TenantID:   uuid.New(),
		CaseID:     uuid.New(),
		EstimateID: uuid.New(),
		Status:     ProposalStatusPresented,
		PresentedAt: &now,
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	data, err := json.Marshal(ps)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	var got ProposalSession
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}

	if got.Status != ProposalStatusPresented {
		t.Errorf("Status = %v, want %v", got.Status, ProposalStatusPresented)
	}
	if got.PresentedAt == nil {
		t.Error("PresentedAt should not be nil")
	}
	if got.DecidedAt != nil {
		t.Error("DecidedAt should be nil")
	}
}

func TestEnumValidation(t *testing.T) {
	tests := []struct {
		name  string
		valid bool
		check func() bool
	}{
		{"valid Plan", true, func() bool { return PlanPro.IsValid() }},
		{"invalid Plan", false, func() bool { return Plan("invalid").IsValid() }},
		{"valid CaseType", true, func() bool { return CaseTypeBugReport.IsValid() }},
		{"invalid CaseType", false, func() bool { return CaseType("xyz").IsValid() }},
		{"valid CaseStatus", true, func() bool { return CaseStatusOnHold.IsValid() }},
		{"invalid CaseStatus", false, func() bool { return CaseStatus("").IsValid() }},
		{"valid CasePriority", true, func() bool { return CasePriorityCritical.IsValid() }},
		{"invalid CasePriority", false, func() bool { return CasePriority("urgent").IsValid() }},
		{"valid EstimateMode", true, func() bool { return EstimateModeHybrid.IsValid() }},
		{"invalid EstimateMode", false, func() bool { return EstimateMode("full").IsValid() }},
		{"valid EstimateStatus", true, func() bool { return EstimateStatusReady.IsValid() }},
		{"invalid EstimateStatus", false, func() bool { return EstimateStatus("pending").IsValid() }},
		{"valid ArtifactStatus", true, func() bool { return ArtifactStatusDraft.IsValid() }},
		{"invalid ArtifactStatus", false, func() bool { return ArtifactStatus("published").IsValid() }},
		{"valid ProposalStatus", true, func() bool { return ProposalStatusExpired.IsValid() }},
		{"invalid ProposalStatus", false, func() bool { return ProposalStatus("cancelled").IsValid() }},
		{"valid Decision", true, func() bool { return DecisionRejected.IsValid() }},
		{"invalid Decision", false, func() bool { return Decision("pending").IsValid() }},
		{"valid MemberRole", true, func() bool { return MemberRoleOwner.IsValid() }},
		{"invalid MemberRole", false, func() bool { return MemberRole("superadmin").IsValid() }},
		{"valid AccountType Organization", true, func() bool { return AccountTypeOrganization.IsValid() }},
		{"valid AccountType User", true, func() bool { return AccountTypeUser.IsValid() }},
		{"invalid AccountType", false, func() bool { return AccountType("Bot").IsValid() }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.check(); got != tt.valid {
				t.Errorf("IsValid() = %v, want %v", got, tt.valid)
			}
		})
	}
}

func TestGitHubInstallationJSONRoundTrip(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	inst := GitHubInstallation{
		ID:             uuid.New(),
		TenantID:       uuid.New(),
		InstallationID: 12345678,
		AppID:          99999,
		AccountLogin:   "my-org",
		AccountType:    AccountTypeOrganization,
		Permissions:    json.RawMessage(`{"contents":"read","pull_requests":"write"}`),
		Events:         json.RawMessage(`["push","pull_request"]`),
		Active:         true,
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	data, err := json.Marshal(inst)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	var got GitHubInstallation
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}

	if got.InstallationID != 12345678 {
		t.Errorf("InstallationID = %v, want 12345678", got.InstallationID)
	}
	if got.AppID != 99999 {
		t.Errorf("AppID = %v, want 99999", got.AppID)
	}
	if got.AccountLogin != "my-org" {
		t.Errorf("AccountLogin = %v, want my-org", got.AccountLogin)
	}
	if got.AccountType != AccountTypeOrganization {
		t.Errorf("AccountType = %v, want %v", got.AccountType, AccountTypeOrganization)
	}
	if !got.Active {
		t.Error("Active should be true")
	}
}

func TestRepositoryJSONRoundTrip(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	instID := uuid.New()
	ghID := int64(987654)
	org := "my-org"
	desc := "A test repository"
	lang := "Go"
	repo := Repository{
		ID:               uuid.New(),
		TenantID:         uuid.New(),
		InstallationID:   &instID,
		GitHubID:         &ghID,
		OrgName:          &org,
		RepoName:         "my-repo",
		FullName:         "my-org/my-repo",
		Description:      &desc,
		Language:         &lang,
		Stars:            42,
		Topics:           []string{"go", "api"},
		TechStack:        []string{"Go", "PostgreSQL"},
		TotalCommits:     1500,
		ContributorCount: 8,
		IsPrivate:        true,
		IsArchived:       false,
		SyncedAt:         &now,
		CreatedAt:        now,
		UpdatedAt:        now,
	}

	data, err := json.Marshal(repo)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	var got Repository
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}

	if got.FullName != "my-org/my-repo" {
		t.Errorf("FullName = %v, want my-org/my-repo", got.FullName)
	}
	if got.Stars != 42 {
		t.Errorf("Stars = %v, want 42", got.Stars)
	}
	if len(got.Topics) != 2 {
		t.Fatalf("Topics len = %d, want 2", len(got.Topics))
	}
	if got.Topics[0] != "go" {
		t.Errorf("Topics[0] = %v, want go", got.Topics[0])
	}
	if len(got.TechStack) != 2 {
		t.Fatalf("TechStack len = %d, want 2", len(got.TechStack))
	}
	if got.TotalCommits != 1500 {
		t.Errorf("TotalCommits = %v, want 1500", got.TotalCommits)
	}
	if !got.IsPrivate {
		t.Error("IsPrivate should be true")
	}
	if got.GitHubID == nil || *got.GitHubID != 987654 {
		t.Errorf("GitHubID = %v, want 987654", got.GitHubID)
	}
}

func TestRepositoryOmitsNilOptionalFields(t *testing.T) {
	repo := Repository{
		ID:        uuid.New(),
		TenantID:  uuid.New(),
		RepoName:  "minimal",
		FullName:  "org/minimal",
		Topics:    []string{},
		TechStack: []string{},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	data, err := json.Marshal(repo)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	var m map[string]json.RawMessage
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("Unmarshal to map error = %v", err)
	}

	optionalFields := []string{
		"installation_id", "github_id", "org_name",
		"description", "language", "synced_at",
	}
	for _, field := range optionalFields {
		if _, ok := m[field]; ok {
			t.Errorf("expected field %q to be omitted when nil", field)
		}
	}
}

func TestVelocityMetricJSONRoundTrip(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	cpw := 25.5
	adw := 4.2
	churn := 0.0312
	score := 78.5
	hours := 120.0
	vm := VelocityMetric{
		ID:                uuid.New(),
		TenantID:          uuid.New(),
		RepositoryID:      uuid.New(),
		CommitsPerWeek:    &cpw,
		ActiveDaysPerWeek: &adw,
		ChurnRate:         &churn,
		VelocityScore:     &score,
		EstimatedHours:    &hours,
		AnalyzedAt:        now,
		CreatedAt:         now,
	}

	data, err := json.Marshal(vm)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	var got VelocityMetric
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}

	if got.CommitsPerWeek == nil || *got.CommitsPerWeek != 25.5 {
		t.Errorf("CommitsPerWeek = %v, want 25.5", got.CommitsPerWeek)
	}
	if got.VelocityScore == nil || *got.VelocityScore != 78.5 {
		t.Errorf("VelocityScore = %v, want 78.5", got.VelocityScore)
	}
	if got.EstimatedHours == nil || *got.EstimatedHours != 120.0 {
		t.Errorf("EstimatedHours = %v, want 120.0", got.EstimatedHours)
	}
}

func TestVelocityMetricScoreBounds(t *testing.T) {
	tests := []struct {
		name  string
		score *float64
		valid bool
	}{
		{"nil score is valid", nil, true},
		{"zero score is valid", ptrFloat64(0), true},
		{"mid score is valid", ptrFloat64(50.0), true},
		{"max score is valid", ptrFloat64(100.0), true},
		{"negative score is invalid", ptrFloat64(-1.0), false},
		{"over 100 is invalid", ptrFloat64(100.01), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			vm := &VelocityMetric{
				ID:           uuid.New(),
				TenantID:     uuid.New(),
				RepositoryID: uuid.New(),
				VelocityScore: tt.score,
				AnalyzedAt:   time.Now(),
				CreatedAt:    time.Now(),
			}
			if got := vm.IsScoreValid(); got != tt.valid {
				t.Errorf("IsScoreValid() = %v, want %v", got, tt.valid)
			}
		})
	}
}

func ptrFloat64(v float64) *float64 {
	return &v
}
