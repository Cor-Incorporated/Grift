package github

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

// velocityTokenProvider always returns the same token (test helper).
type velocityTokenProvider struct {
	token string
}

func (s *velocityTokenProvider) InstallationToken(_ context.Context) (string, error) {
	return s.token, nil
}

func TestNormalize(t *testing.T) {
	tests := []struct {
		name          string
		raw           *RawVelocityData
		wantCPW       float64
		wantADPW      float64
		wantPMF       float64
		wantICS       float64
		wantChurn     float64
		wantCC        int
		wantScoreMin  float64
		wantScoreMax  float64
	}{
		{
			name: "typical active repo",
			raw: &RawVelocityData{
				WeeklyCommits:    []int{10, 12, 8, 15, 20, 10, 5, 18, 12, 14, 9, 11, 16},
				MergedPRCount:    26,
				AvgIssueCloseHrs: 48.0,
				ContributorCount: 5,
				Languages:        map[string]int64{"Go": 50000, "Python": 10000},
				TotalCommits:     160,
				ActiveDays:       52,
			},
			wantCPW:      12.0, // 160/13 ≈ 12.3, but avg of list
			wantADPW:     4.0,  // 52/13 = 4.0
			wantPMF:      2.0,  // 26/13 = 2.0
			wantICS:      48.0,
			wantChurn:    0.0,
			wantCC:       5,
			wantScoreMin: 30.0,
			wantScoreMax: 80.0,
		},
		{
			name:         "zero/empty data",
			raw:          &RawVelocityData{},
			wantCPW:      0,
			wantADPW:     0,
			wantPMF:      0,
			wantICS:      0,
			wantChurn:    0,
			wantCC:       0,
			wantScoreMin: 0,
			wantScoreMax: 0,
		},
		{
			name:         "nil input",
			raw:          nil,
			wantCPW:      0,
			wantADPW:     0,
			wantPMF:      0,
			wantICS:      0,
			wantChurn:    0,
			wantCC:       0,
			wantScoreMin: 0,
			wantScoreMax: 0,
		},
		{
			name: "extreme values - score capped at 100",
			raw: &RawVelocityData{
				WeeklyCommits:    []int{100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100},
				MergedPRCount:    500,
				AvgIssueCloseHrs: 1.0,
				ContributorCount: 100,
				Languages:        map[string]int64{"Go": 1000000},
				TotalCommits:     1300,
				ActiveDays:       91,
			},
			wantCPW:      100.0,
			wantADPW:     7.0,  // 91/13 = 7.0
			wantPMF:      38.46, // 500/13 ≈ 38.46
			wantICS:      1.0,
			wantChurn:    0.0,
			wantCC:       100,
			wantScoreMin: 100.0,
			wantScoreMax: 100.0,
		},
		{
			name: "single week of data",
			raw: &RawVelocityData{
				WeeklyCommits:    []int{5},
				MergedPRCount:    1,
				AvgIssueCloseHrs: 24.0,
				ContributorCount: 1,
				Languages:        map[string]int64{"JavaScript": 5000},
				TotalCommits:     5,
				ActiveDays:       3,
			},
			wantCPW:      5.0,
			wantADPW:     0.23, // 3/13
			wantPMF:      0.077,
			wantICS:      24.0,
			wantChurn:    0.0,
			wantCC:       1,
			wantScoreMin: 5.0,
			wantScoreMax: 20.0,
		},
	}

	va := &VelocityAnalyzer{}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := va.Normalize(tt.raw)

			if tt.raw == nil || (len(tt.raw.WeeklyCommits) == 0 && tt.raw.MergedPRCount == 0) {
				// Zero/nil case: exact zero checks
				if got.CommitsPerWeek != 0 {
					t.Errorf("CommitsPerWeek = %v, want 0", got.CommitsPerWeek)
				}
				if got.VelocityScore != 0 {
					t.Errorf("VelocityScore = %v, want 0", got.VelocityScore)
				}
				return
			}

			if got.ContributorCount != tt.wantCC {
				t.Errorf("ContributorCount = %d, want %d", got.ContributorCount, tt.wantCC)
			}
			if got.ChurnRate != tt.wantChurn {
				t.Errorf("ChurnRate = %v, want %v", got.ChurnRate, tt.wantChurn)
			}
			if got.IssueCloseSpeed != tt.wantICS {
				t.Errorf("IssueCloseSpeed = %v, want %v", got.IssueCloseSpeed, tt.wantICS)
			}
			if got.VelocityScore < tt.wantScoreMin {
				t.Errorf("VelocityScore = %v, want >= %v", got.VelocityScore, tt.wantScoreMin)
			}
			if got.VelocityScore > tt.wantScoreMax {
				t.Errorf("VelocityScore = %v, want <= %v", got.VelocityScore, tt.wantScoreMax)
			}
		})
	}
}

func TestNormalizeScoreCappedAt100(t *testing.T) {
	va := &VelocityAnalyzer{}
	raw := &RawVelocityData{
		WeeklyCommits:    []int{999, 999, 999, 999, 999, 999, 999, 999, 999, 999, 999, 999, 999},
		MergedPRCount:    9999,
		ContributorCount: 9999,
		ActiveDays:       91,
	}
	got := va.Normalize(raw)
	if got.VelocityScore > 100 {
		t.Errorf("VelocityScore = %v, want <= 100", got.VelocityScore)
	}
	if got.VelocityScore != 100 {
		t.Errorf("VelocityScore = %v, want exactly 100", got.VelocityScore)
	}
}

func TestAnalyzeWithMockServer(t *testing.T) {
	now := time.Now()
	closedAt := now.Add(-24 * time.Hour)
	createdAt := now.Add(-72 * time.Hour)

	mux := http.NewServeMux()

	// Commit activity endpoint
	mux.HandleFunc("GET /repos/testorg/testrepo/stats/commit_activity", func(w http.ResponseWriter, r *http.Request) {
		weeks := make([]commitActivityResponse, 52)
		for i := range weeks {
			weeks[i] = commitActivityResponse{
				Total: 5 + i%10,
				Week:  now.AddDate(0, 0, -(52-i)*7).Unix(),
				Days:  []int{1, 0, 2, 1, 0, 1, 0},
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(weeks)
	})

	// Pulls endpoint
	mux.HandleFunc("GET /repos/testorg/testrepo/pulls", func(w http.ResponseWriter, r *http.Request) {
		pulls := []pullResponse{
			{MergedAt: &closedAt},
			{MergedAt: &closedAt},
			{MergedAt: nil}, // not merged
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(pulls)
	})

	// Issues endpoint
	mux.HandleFunc("GET /repos/testorg/testrepo/issues", func(w http.ResponseWriter, r *http.Request) {
		issues := []issueResponse{
			{CreatedAt: createdAt, ClosedAt: &closedAt},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(issues)
	})

	// Contributors endpoint
	mux.HandleFunc("GET /repos/testorg/testrepo/stats/contributors", func(w http.ResponseWriter, r *http.Request) {
		contributors := []contributorResponse{
			{Total: 100},
			{Total: 50},
			{Total: 25},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(contributors)
	})

	// Languages endpoint
	mux.HandleFunc("GET /repos/testorg/testrepo/languages", func(w http.ResponseWriter, r *http.Request) {
		langs := map[string]int64{"Go": 80000, "Shell": 5000}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(langs)
	})

	srv := httptest.NewServer(mux)
	defer srv.Close()

	client := NewClient(&velocityTokenProvider{token: "test-token"})
	analyzer := NewVelocityAnalyzer(client, WithAnalyzerBaseURL(srv.URL))

	ctx := context.Background()
	raw, err := analyzer.Analyze(ctx, "testorg", "testrepo")
	if err != nil {
		t.Fatalf("Analyze() error = %v", err)
	}

	if len(raw.WeeklyCommits) != 13 {
		t.Errorf("WeeklyCommits len = %d, want 13", len(raw.WeeklyCommits))
	}
	if raw.MergedPRCount != 2 {
		t.Errorf("MergedPRCount = %d, want 2", raw.MergedPRCount)
	}
	if raw.ContributorCount != 3 {
		t.Errorf("ContributorCount = %d, want 3", raw.ContributorCount)
	}
	if raw.AvgIssueCloseHrs <= 0 {
		t.Errorf("AvgIssueCloseHrs = %v, want > 0", raw.AvgIssueCloseHrs)
	}
	if len(raw.Languages) != 2 {
		t.Errorf("Languages len = %d, want 2", len(raw.Languages))
	}
	if raw.Languages["Go"] != 80000 {
		t.Errorf("Languages[Go] = %d, want 80000", raw.Languages["Go"])
	}

	// Also test normalization of the collected data
	normalized := analyzer.Normalize(raw)
	if normalized.CommitsPerWeek <= 0 {
		t.Errorf("CommitsPerWeek = %v, want > 0", normalized.CommitsPerWeek)
	}
	if normalized.VelocityScore <= 0 {
		t.Errorf("VelocityScore = %v, want > 0", normalized.VelocityScore)
	}
	if normalized.VelocityScore > 100 {
		t.Errorf("VelocityScore = %v, want <= 100", normalized.VelocityScore)
	}
}

func TestAnalyzeAPIError(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /repos/testorg/testrepo/stats/commit_activity", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"message":"internal error"}`))
	})

	srv := httptest.NewServer(mux)
	defer srv.Close()

	client := NewClient(&velocityTokenProvider{token: "test-token"})
	analyzer := NewVelocityAnalyzer(client, WithAnalyzerBaseURL(srv.URL))

	_, err := analyzer.Analyze(context.Background(), "testorg", "testrepo")
	if err == nil {
		t.Fatal("Analyze() expected error, got nil")
	}
}

func TestRateLimitHandling(t *testing.T) {
	t.Run("short wait retries and succeeds", func(t *testing.T) {
		callCount := 0
		resetTime := time.Now().Add(1 * time.Second)

		mux := http.NewServeMux()
		mux.HandleFunc("GET /repos/testorg/testrepo/stats/commit_activity", func(w http.ResponseWriter, r *http.Request) {
			callCount++
			if callCount == 1 {
				w.Header().Set("X-RateLimit-Remaining", "0")
				w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(resetTime.Unix(), 10))
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(`{"message":"API rate limit exceeded"}`))
				return
			}
			// Second call succeeds
			weeks := make([]commitActivityResponse, 13)
			for i := range weeks {
				weeks[i] = commitActivityResponse{
					Total: 3,
					Week:  time.Now().AddDate(0, 0, -(13-i)*7).Unix(),
					Days:  []int{1, 0, 1, 0, 1, 0, 0},
				}
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(weeks)
		})
		// Add remaining endpoints for full Analyze
		mux.HandleFunc("GET /repos/testorg/testrepo/pulls", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]pullResponse{})
		})
		mux.HandleFunc("GET /repos/testorg/testrepo/issues", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]issueResponse{})
		})
		mux.HandleFunc("GET /repos/testorg/testrepo/stats/contributors", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]contributorResponse{})
		})
		mux.HandleFunc("GET /repos/testorg/testrepo/languages", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]int64{})
		})

		srv := httptest.NewServer(mux)
		defer srv.Close()

		client := NewClient(&velocityTokenProvider{token: "test-token"})
		analyzer := NewVelocityAnalyzer(client, WithAnalyzerBaseURL(srv.URL))

		raw, err := analyzer.Analyze(context.Background(), "testorg", "testrepo")
		if err != nil {
			t.Fatalf("Analyze() error = %v", err)
		}
		if len(raw.WeeklyCommits) != 13 {
			t.Errorf("WeeklyCommits len = %d, want 13", len(raw.WeeklyCommits))
		}
		if callCount < 2 {
			t.Errorf("callCount = %d, want >= 2 (retry happened)", callCount)
		}
	})

	t.Run("long wait returns rate limit error", func(t *testing.T) {
		resetTime := time.Now().Add(120 * time.Second) // > 60s

		mux := http.NewServeMux()
		mux.HandleFunc("GET /repos/testorg/testrepo/stats/commit_activity", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-RateLimit-Remaining", "0")
			w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(resetTime.Unix(), 10))
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"message":"API rate limit exceeded"}`))
		})

		srv := httptest.NewServer(mux)
		defer srv.Close()

		client := NewClient(&velocityTokenProvider{token: "test-token"})
		analyzer := NewVelocityAnalyzer(client, WithAnalyzerBaseURL(srv.URL))

		_, err := analyzer.Analyze(context.Background(), "testorg", "testrepo")
		if err == nil {
			t.Fatal("Analyze() expected rate limit error, got nil")
		}

		var rlErr *ErrRateLimited
		if !isRateLimitError(err, &rlErr) {
			t.Errorf("expected ErrRateLimited, got: %v", err)
		}
	})

	t.Run("context cancellation during rate limit wait", func(t *testing.T) {
		resetTime := time.Now().Add(30 * time.Second)

		mux := http.NewServeMux()
		mux.HandleFunc("GET /repos/testorg/testrepo/stats/commit_activity", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("X-RateLimit-Remaining", "0")
			w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(resetTime.Unix(), 10))
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"message":"rate limit"}`))
		})

		srv := httptest.NewServer(mux)
		defer srv.Close()

		client := NewClient(&velocityTokenProvider{token: "test-token"})
		analyzer := NewVelocityAnalyzer(client, WithAnalyzerBaseURL(srv.URL))

		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancel()

		_, err := analyzer.Analyze(ctx, "testorg", "testrepo")
		if err == nil {
			t.Fatal("Analyze() expected context error, got nil")
		}
	})
}

func TestAnalyzeEmptyResponses(t *testing.T) {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /repos/testorg/testrepo/stats/commit_activity", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, "[]")
	})
	mux.HandleFunc("GET /repos/testorg/testrepo/pulls", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, "[]")
	})
	mux.HandleFunc("GET /repos/testorg/testrepo/issues", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, "[]")
	})
	mux.HandleFunc("GET /repos/testorg/testrepo/stats/contributors", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, "[]")
	})
	mux.HandleFunc("GET /repos/testorg/testrepo/languages", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, "{}")
	})

	srv := httptest.NewServer(mux)
	defer srv.Close()

	client := NewClient(&velocityTokenProvider{token: "test-token"})
	analyzer := NewVelocityAnalyzer(client, WithAnalyzerBaseURL(srv.URL))

	raw, err := analyzer.Analyze(context.Background(), "testorg", "testrepo")
	if err != nil {
		t.Fatalf("Analyze() error = %v", err)
	}

	if len(raw.WeeklyCommits) != 0 {
		t.Errorf("WeeklyCommits len = %d, want 0", len(raw.WeeklyCommits))
	}
	if raw.MergedPRCount != 0 {
		t.Errorf("MergedPRCount = %d, want 0", raw.MergedPRCount)
	}
	if raw.ContributorCount != 0 {
		t.Errorf("ContributorCount = %d, want 0", raw.ContributorCount)
	}

	normalized := analyzer.Normalize(raw)
	if normalized.VelocityScore != 0 {
		t.Errorf("VelocityScore = %v, want 0", normalized.VelocityScore)
	}
}

func TestTruncate(t *testing.T) {
	tests := []struct {
		name  string
		input string
		n     int
		want  string
	}{
		{"short string", "hello", 10, "hello"},
		{"exact length", "hello", 5, "hello"},
		{"truncated", "hello world", 5, "hello..."},
		{"empty", "", 5, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := truncate([]byte(tt.input), tt.n)
			if got != tt.want {
				t.Errorf("truncate() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestValidateSlug(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr bool
	}{
		{"valid owner", "testorg", false},
		{"valid repo", "my-repo", false},
		{"valid with dots", "my.repo", false},
		{"empty", "", true},
		{"contains slash", "test/org", true},
		{"contains question mark", "test?org", true},
		{"contains hash", "test#org", true},
		{"path traversal", "..", true},
		{"path traversal in middle", "foo..bar", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateSlug(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateSlug(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
			}
		})
	}
}

func TestAnalyzeInvalidSlug(t *testing.T) {
	client := NewClient(&velocityTokenProvider{token: "test-token"})
	analyzer := NewVelocityAnalyzer(client)

	_, err := analyzer.Analyze(context.Background(), "../evil", "repo")
	if err == nil {
		t.Fatal("Analyze() expected error for path traversal owner, got nil")
	}

	_, err = analyzer.Analyze(context.Background(), "owner", "repo?q=inject")
	if err == nil {
		t.Fatal("Analyze() expected error for query injection repo, got nil")
	}
}

func TestAnalyze202Accepted(t *testing.T) {
	mux := http.NewServeMux()

	// Commit activity returns 202 (stats being computed)
	mux.HandleFunc("GET /repos/testorg/testrepo/stats/commit_activity", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{}`))
	})
	mux.HandleFunc("GET /repos/testorg/testrepo/pulls", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]pullResponse{})
	})
	mux.HandleFunc("GET /repos/testorg/testrepo/issues", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]issueResponse{})
	})
	// Contributors also returns 202
	mux.HandleFunc("GET /repos/testorg/testrepo/stats/contributors", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{}`))
	})
	mux.HandleFunc("GET /repos/testorg/testrepo/languages", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]int64{})
	})

	srv := httptest.NewServer(mux)
	defer srv.Close()

	client := NewClient(&velocityTokenProvider{token: "test-token"})
	analyzer := NewVelocityAnalyzer(client, WithAnalyzerBaseURL(srv.URL))

	raw, err := analyzer.Analyze(context.Background(), "testorg", "testrepo")
	if err != nil {
		t.Fatalf("Analyze() error = %v, want nil (202 should be treated as empty data)", err)
	}

	if len(raw.WeeklyCommits) != 0 {
		t.Errorf("WeeklyCommits len = %d, want 0 (202 = no data yet)", len(raw.WeeklyCommits))
	}
	if raw.ContributorCount != 0 {
		t.Errorf("ContributorCount = %d, want 0 (202 = no data yet)", raw.ContributorCount)
	}
}

// isRateLimitError checks if the error chain contains ErrRateLimited.
func isRateLimitError(err error, target **ErrRateLimited) bool {
	for e := err; e != nil; {
		if rl, ok := e.(*ErrRateLimited); ok {
			*target = rl
			return true
		}
		if unwrapper, ok := e.(interface{ Unwrap() error }); ok {
			e = unwrapper.Unwrap()
		} else {
			return false
		}
	}
	return false
}
