package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/middleware"
	"github.com/google/uuid"
)

// ConversationTurn represents a single turn in a conversation.
type ConversationTurn struct {
	ID         uuid.UUID      `json:"id"`
	CaseID     uuid.UUID      `json:"case_id"`
	Role       string         `json:"role"`
	Content    string         `json:"content"`
	Metadata   map[string]any `json:"metadata"`
	CreatedAt  time.Time      `json:"created_at"`
	TurnNumber int            `json:"-"`
}

// ConversationStore defines the data access contract for conversation turns.
type ConversationStore interface {
	// ListTurns returns conversation turns for a case with pagination.
	ListTurns(ctx context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]ConversationTurn, int, error)
	// InsertTurn persists a new conversation turn and returns it with server-set fields.
	InsertTurn(ctx context.Context, tenantID, caseID uuid.UUID, role, content string, metadata map[string]any) (*ConversationTurn, error)
	// EnsureCaseExists verifies that a case with the given ID exists for the tenant.
	EnsureCaseExists(ctx context.Context, tenantID, caseID uuid.UUID) error
}

// SQLConversationStore implements ConversationStore using a *sql.DB.
type SQLConversationStore struct {
	db *sql.DB
}

// NewSQLConversationStore constructs a SQLConversationStore.
func NewSQLConversationStore(db *sql.DB) *SQLConversationStore {
	return &SQLConversationStore{db: db}
}

// ListTurns retrieves conversation turns ordered by creation time.
func (s *SQLConversationStore) ListTurns(ctx context.Context, tenantID, caseID uuid.UUID, limit, offset int) ([]ConversationTurn, int, error) {
	exec := executorFromContext(ctx, s.db)

	var total int
	err := exec.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM conversation_turns WHERE tenant_id = $1 AND case_id = $2`,
		tenantID, caseID,
	).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("count conversation turns: %w", err)
	}

	rows, err := exec.QueryContext(ctx,
		`WITH ordered AS (
			SELECT id, case_id, role, content, metadata, created_at,
				ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS turn_number
			FROM conversation_turns
			WHERE tenant_id = $1 AND case_id = $2
		)
		SELECT id, case_id, role, content, metadata, created_at, turn_number
		FROM ordered
		ORDER BY turn_number ASC
		LIMIT $3 OFFSET $4`,
		tenantID, caseID, limit, offset,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("list conversation turns: %w", err)
	}
	defer rows.Close()

	var turns []ConversationTurn
	for rows.Next() {
		turn, err := scanConversationTurn(rows)
		if err != nil {
			return nil, 0, err
		}
		turns = append(turns, *turn)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate conversation turns: %w", err)
	}
	return turns, total, nil
}

// InsertTurn creates a new conversation turn and returns it.
func (s *SQLConversationStore) InsertTurn(ctx context.Context, tenantID, caseID uuid.UUID, role, content string, metadata map[string]any) (*ConversationTurn, error) {
	payload, err := json.Marshal(metadata)
	if err != nil {
		return nil, fmt.Errorf("marshal turn metadata: %w", err)
	}

	turn := &ConversationTurn{
		ID:       uuid.New(),
		CaseID:   caseID,
		Role:     role,
		Content:  content,
		Metadata: metadata,
	}

	exec := executorFromContext(ctx, s.db)

	row := exec.QueryRowContext(ctx,
		`INSERT INTO conversation_turns (id, tenant_id, case_id, role, content, metadata)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING created_at`,
		turn.ID, tenantID, turn.CaseID, turn.Role, turn.Content, payload,
	)
	if err := row.Scan(&turn.CreatedAt); err != nil {
		return nil, fmt.Errorf("insert conversation turn: %w", err)
	}

	err = exec.QueryRowContext(ctx,
		`WITH ordered AS (
			SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS turn_number
			FROM conversation_turns
			WHERE tenant_id = $1 AND case_id = $2
		)
		SELECT turn_number FROM ordered WHERE id = $3`,
		tenantID, caseID, turn.ID,
	).Scan(&turn.TurnNumber)
	if err != nil {
		return nil, fmt.Errorf("count conversation turns: %w", err)
	}

	return turn, nil
}

// EnsureCaseExists checks that the case exists for the given tenant.
func (s *SQLConversationStore) EnsureCaseExists(ctx context.Context, tenantID, caseID uuid.UUID) error {
	var id uuid.UUID
	err := executorFromContext(ctx, s.db).QueryRowContext(ctx,
		`SELECT id FROM cases WHERE tenant_id = $1 AND id = $2`,
		tenantID, caseID,
	).Scan(&id)
	if err != nil {
		return err
	}
	return nil
}

// executorFromContext returns the RLS-scoped transaction from context, or falls back to db.
func executorFromContext(ctx context.Context, db *sql.DB) dbExecutor {
	if tx := middleware.TxFromContext(ctx); tx != nil {
		return tx
	}
	return db
}

func scanConversationTurn(scanner rowScanner) (*ConversationTurn, error) {
	var (
		turn        ConversationTurn
		metadataRaw []byte
	)
	if err := scanner.Scan(
		&turn.ID,
		&turn.CaseID,
		&turn.Role,
		&turn.Content,
		&metadataRaw,
		&turn.CreatedAt,
		&turn.TurnNumber,
	); err != nil {
		return nil, fmt.Errorf("scan conversation turn: %w", err)
	}
	turn.Metadata = map[string]any{}
	if len(metadataRaw) > 0 {
		if err := json.Unmarshal(metadataRaw, &turn.Metadata); err != nil {
			return nil, fmt.Errorf("decode conversation metadata: %w", err)
		}
	}
	return &turn, nil
}
