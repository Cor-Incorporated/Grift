package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/domain"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
)

func TestSQLTenantStore_Create(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	tenantID := uuid.New()
	input := &domain.Tenant{
		ID:             tenantID,
		Name:           "Acme",
		Slug:           "acme",
		Plan:           domain.PlanPro,
		Settings:       json.RawMessage(`{"region":"apac"}`),
		AnalyticsOptIn: true,
		TrainingOptIn:  false,
	}

	tests := []struct {
		name    string
		mock    func(sqlmock.Sqlmock)
		wantErr bool
	}{
		{
			name: "success",
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`INSERT INTO tenants`).
					WithArgs(tenantID, input.Name, input.Slug, input.Plan, input.Settings, input.AnalyticsOptIn, input.TrainingOptIn).
					WillReturnRows(sqlmock.NewRows([]string{"created_at", "updated_at"}).AddRow(now, now))
			},
		},
		{
			name: "insert error",
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`INSERT INTO tenants`).
					WithArgs(tenantID, input.Name, input.Slug, input.Plan, input.Settings, input.AnalyticsOptIn, input.TrainingOptIn).
					WillReturnError(errors.New("insert failed"))
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("sqlmock.New() error = %v", err)
			}
			defer db.Close()

			tt.mock(mock)
			store := NewSQLTenantStore(db)
			tenantCopy := *input

			got, err := store.Create(context.Background(), &tenantCopy)
			if (err != nil) != tt.wantErr {
				t.Fatalf("Create() error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr && got == nil {
				t.Fatal("Create() returned nil")
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("ExpectationsWereMet() error = %v", err)
			}
		})
	}
}

func TestSQLTenantStore_List(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	tenantID := uuid.New()

	tenantColumns := []string{
		"id", "name", "slug", "plan", "settings", "analytics_opt_in", "training_opt_in", "created_at", "updated_at",
	}

	tests := []struct {
		name      string
		mock      func(sqlmock.Sqlmock)
		wantCount int
		wantTotal int
		wantErr   bool
	}{
		{
			name: "success",
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`SELECT COUNT\(\*\) FROM tenants`).
					WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
				m.ExpectQuery(`SELECT id, name, slug, plan, settings, analytics_opt_in, training_opt_in, created_at, updated_at`).
					WithArgs(10, 5).
					WillReturnRows(sqlmock.NewRows(tenantColumns).AddRow(
						tenantID, "Acme", "acme", domain.PlanFree, json.RawMessage(`{}`), false, false, now, now,
					))
			},
			wantCount: 1,
			wantTotal: 1,
		},
		{
			name: "count error",
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`SELECT COUNT\(\*\) FROM tenants`).
					WillReturnError(errors.New("count failed"))
			},
			wantErr: true,
		},
		{
			name: "list query error",
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`SELECT COUNT\(\*\) FROM tenants`).
					WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
				m.ExpectQuery(`SELECT id, name, slug, plan, settings, analytics_opt_in, training_opt_in, created_at, updated_at`).
					WithArgs(10, 5).
					WillReturnError(errors.New("list failed"))
			},
			wantErr: true,
		},
		{
			name: "row iteration error",
			mock: func(m sqlmock.Sqlmock) {
				rows := sqlmock.NewRows(tenantColumns).
					AddRow(tenantID, "Acme", "acme", domain.PlanFree, json.RawMessage(`{}`), false, false, now, now).
					RowError(0, errors.New("row error"))
				m.ExpectQuery(`SELECT COUNT\(\*\) FROM tenants`).
					WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
				m.ExpectQuery(`SELECT id, name, slug, plan, settings, analytics_opt_in, training_opt_in, created_at, updated_at`).
					WithArgs(10, 5).
					WillReturnRows(rows)
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("sqlmock.New() error = %v", err)
			}
			defer db.Close()

			tt.mock(mock)
			store := NewSQLTenantStore(db)

			got, total, err := store.List(context.Background(), 10, 5)
			if (err != nil) != tt.wantErr {
				t.Fatalf("List() error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr && len(got) != tt.wantCount {
				t.Fatalf("List() count = %d, want %d", len(got), tt.wantCount)
			}
			if !tt.wantErr && total != tt.wantTotal {
				t.Fatalf("List() total = %d, want %d", total, tt.wantTotal)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("ExpectationsWereMet() error = %v", err)
			}
		})
	}
}

func TestSQLTenantStore_GetByID(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	tenantID := uuid.New()
	columns := []string{
		"id", "name", "slug", "plan", "settings", "analytics_opt_in", "training_opt_in", "created_at", "updated_at",
	}

	tests := []struct {
		name    string
		mock    func(sqlmock.Sqlmock)
		wantNil bool
		wantErr bool
	}{
		{
			name: "found",
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`SELECT id, name, slug, plan, settings, analytics_opt_in, training_opt_in, created_at, updated_at`).
					WithArgs(tenantID).
					WillReturnRows(sqlmock.NewRows(columns).AddRow(
						tenantID, "Acme", "acme", domain.PlanFree, json.RawMessage(`{}`), false, false, now, now,
					))
			},
		},
		{
			name: "not found",
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`SELECT id, name, slug, plan, settings, analytics_opt_in, training_opt_in, created_at, updated_at`).
					WithArgs(tenantID).
					WillReturnError(sql.ErrNoRows)
			},
			wantNil: true,
		},
		{
			name: "query error",
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`SELECT id, name, slug, plan, settings, analytics_opt_in, training_opt_in, created_at, updated_at`).
					WithArgs(tenantID).
					WillReturnError(errors.New("lookup failed"))
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("sqlmock.New() error = %v", err)
			}
			defer db.Close()

			tt.mock(mock)
			store := NewSQLTenantStore(db)

			got, err := store.GetByID(context.Background(), tenantID)
			if (err != nil) != tt.wantErr {
				t.Fatalf("GetByID() error = %v, wantErr %v", err, tt.wantErr)
			}
			if tt.wantNil && got != nil {
				t.Fatalf("GetByID() = %#v, want nil", got)
			}
			if !tt.wantNil && !tt.wantErr && got == nil {
				t.Fatal("GetByID() returned nil")
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("ExpectationsWereMet() error = %v", err)
			}
		})
	}
}

func TestSQLTenantStore_UpdateSettings(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	tenantID := uuid.New()
	analyticsOptIn := true
	trainingOptIn := true
	settings := json.RawMessage(`{"region":"apac"}`)
	columns := []string{
		"id", "name", "slug", "plan", "settings", "analytics_opt_in", "training_opt_in", "created_at", "updated_at",
	}

	tests := []struct {
		name    string
		mock    func(sqlmock.Sqlmock)
		wantNil bool
		wantErr bool
	}{
		{
			name: "updates all optional fields",
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`UPDATE tenants SET updated_at = now\(\), analytics_opt_in = \$1, training_opt_in = \$2, settings = \$3 WHERE id = \$4`).
					WithArgs(analyticsOptIn, trainingOptIn, settings, tenantID).
					WillReturnRows(sqlmock.NewRows(columns).AddRow(
						tenantID, "Acme", "acme", domain.PlanPro, settings, analyticsOptIn, trainingOptIn, now, now,
					))
			},
		},
		{
			name: "updates only timestamp when no fields provided",
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`UPDATE tenants SET updated_at = now\(\) WHERE id = \$1`).
					WithArgs(tenantID).
					WillReturnRows(sqlmock.NewRows(columns).AddRow(
						tenantID, "Acme", "acme", domain.PlanFree, json.RawMessage(`{}`), false, false, now, now,
					))
			},
		},
		{
			name: "not found",
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`UPDATE tenants SET updated_at = now\(\) WHERE id = \$1`).
					WithArgs(tenantID).
					WillReturnError(sql.ErrNoRows)
			},
			wantNil: true,
		},
		{
			name: "update error",
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`UPDATE tenants SET updated_at = now\(\), analytics_opt_in = \$1, training_opt_in = \$2, settings = \$3 WHERE id = \$4`).
					WithArgs(analyticsOptIn, trainingOptIn, settings, tenantID).
					WillReturnError(errors.New("update failed"))
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("sqlmock.New() error = %v", err)
			}
			defer db.Close()

			tt.mock(mock)
			store := NewSQLTenantStore(db)

			var got *domain.Tenant
			if tt.name == "updates all optional fields" || tt.name == "update error" {
				got, err = store.UpdateSettings(context.Background(), tenantID, &analyticsOptIn, &trainingOptIn, settings)
			} else {
				got, err = store.UpdateSettings(context.Background(), tenantID, nil, nil, nil)
			}
			if (err != nil) != tt.wantErr {
				t.Fatalf("UpdateSettings() error = %v, wantErr %v", err, tt.wantErr)
			}
			if tt.wantNil && got != nil {
				t.Fatalf("UpdateSettings() = %#v, want nil", got)
			}
			if !tt.wantNil && !tt.wantErr && got == nil {
				t.Fatal("UpdateSettings() returned nil")
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("ExpectationsWereMet() error = %v", err)
			}
		})
	}
}

func TestSQLTenantStore_AddMember(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	memberID := uuid.New()
	tenantID := uuid.New()
	email := "owner@example.com"
	displayName := "Owner"
	input := &domain.TenantMember{
		ID:          memberID,
		TenantID:    tenantID,
		FirebaseUID: "uid-1",
		Email:       &email,
		DisplayName: &displayName,
		Role:        domain.MemberRoleOwner,
		Active:      true,
	}

	tests := []struct {
		name    string
		mock    func(sqlmock.Sqlmock)
		wantErr bool
	}{
		{
			name: "success",
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`INSERT INTO tenant_members`).
					WithArgs(memberID, tenantID, input.FirebaseUID, input.Email, input.DisplayName, input.Role, input.Active).
					WillReturnRows(sqlmock.NewRows([]string{"created_at", "updated_at"}).AddRow(now, now))
			},
		},
		{
			name: "insert error",
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`INSERT INTO tenant_members`).
					WithArgs(memberID, tenantID, input.FirebaseUID, input.Email, input.DisplayName, input.Role, input.Active).
					WillReturnError(errors.New("insert failed"))
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("sqlmock.New() error = %v", err)
			}
			defer db.Close()

			tt.mock(mock)
			store := NewSQLTenantStore(db)
			memberCopy := *input

			got, err := store.AddMember(context.Background(), &memberCopy)
			if (err != nil) != tt.wantErr {
				t.Fatalf("AddMember() error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr && got == nil {
				t.Fatal("AddMember() returned nil")
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("ExpectationsWereMet() error = %v", err)
			}
		})
	}
}

func TestSQLTenantStore_ListMembers(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	memberID := uuid.New()
	tenantID := uuid.New()
	email := "member@example.com"
	displayName := "Member"
	columns := []string{
		"id", "tenant_id", "firebase_uid", "email", "display_name", "role", "active", "created_at", "updated_at",
	}

	tests := []struct {
		name      string
		mock      func(sqlmock.Sqlmock)
		wantCount int
		wantTotal int
		wantErr   bool
	}{
		{
			name: "success",
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`SELECT COUNT\(\*\) FROM tenant_members WHERE tenant_id = \$1`).
					WithArgs(tenantID).
					WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
				m.ExpectQuery(`SELECT id, tenant_id, firebase_uid, email, display_name, role, active, created_at, updated_at`).
					WithArgs(tenantID, 20, 0).
					WillReturnRows(sqlmock.NewRows(columns).AddRow(
						memberID, tenantID, "uid-1", email, displayName, domain.MemberRoleMember, true, now, now,
					))
			},
			wantCount: 1,
			wantTotal: 1,
		},
		{
			name: "count error",
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`SELECT COUNT\(\*\) FROM tenant_members WHERE tenant_id = \$1`).
					WithArgs(tenantID).
					WillReturnError(errors.New("count failed"))
			},
			wantErr: true,
		},
		{
			name: "list query error",
			mock: func(m sqlmock.Sqlmock) {
				m.ExpectQuery(`SELECT COUNT\(\*\) FROM tenant_members WHERE tenant_id = \$1`).
					WithArgs(tenantID).
					WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
				m.ExpectQuery(`SELECT id, tenant_id, firebase_uid, email, display_name, role, active, created_at, updated_at`).
					WithArgs(tenantID, 20, 0).
					WillReturnError(errors.New("query failed"))
			},
			wantErr: true,
		},
		{
			name: "row iteration error",
			mock: func(m sqlmock.Sqlmock) {
				rows := sqlmock.NewRows(columns).
					AddRow(memberID, tenantID, "uid-1", email, displayName, domain.MemberRoleMember, true, now, now).
					RowError(0, errors.New("row error"))
				m.ExpectQuery(`SELECT COUNT\(\*\) FROM tenant_members WHERE tenant_id = \$1`).
					WithArgs(tenantID).
					WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
				m.ExpectQuery(`SELECT id, tenant_id, firebase_uid, email, display_name, role, active, created_at, updated_at`).
					WithArgs(tenantID, 20, 0).
					WillReturnRows(rows)
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("sqlmock.New() error = %v", err)
			}
			defer db.Close()

			tt.mock(mock)
			store := NewSQLTenantStore(db)

			got, total, err := store.ListMembers(context.Background(), tenantID, 20, 0)
			if (err != nil) != tt.wantErr {
				t.Fatalf("ListMembers() error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr && len(got) != tt.wantCount {
				t.Fatalf("ListMembers() count = %d, want %d", len(got), tt.wantCount)
			}
			if !tt.wantErr && total != tt.wantTotal {
				t.Fatalf("ListMembers() total = %d, want %d", total, tt.wantTotal)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("ExpectationsWereMet() error = %v", err)
			}
		})
	}
}
