package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"cloud.google.com/go/pubsub/v2"
	"github.com/google/uuid"

	"github.com/Cor-Incorporated/Grift/services/control-api/internal/conversation"
)

func main() {
	var (
		projectID           = flag.String("project-id", os.Getenv("GOOGLE_CLOUD_PROJECT"), "GCP project ID")
		topic               = flag.String("topic", "conversation-turns", "Pub/Sub topic name")
		publish             = flag.Bool("publish", false, "actually publish to Pub/Sub (default: dry-run)")
		tenantIDRaw         = flag.String("tenant-id", uuid.NewString(), "tenant UUID")
		sessionIDRaw        = flag.String("session-id", uuid.NewString(), "session UUID (ordering key)")
		turnNumber          = flag.Int("turn-number", 5, "current turn number")
		role                = flag.String("role", "assistant", "current turn role")
		content             = flag.String("content", "こちらで確認したい点は予算レンジです。", "current turn content")
		sourceDomain        = flag.String("source-domain", "estimation", "source domain")
		modelUsed           = flag.String("model-used", "qwen3.5-32b", "model name")
		systemPromptVersion = flag.String("system-prompt-version", "v3", "system prompt version")
	)
	flag.Parse()

	tenantID, err := uuid.Parse(*tenantIDRaw)
	if err != nil {
		log.Fatalf("invalid tenant-id: %v", err)
	}
	sessionID, err := uuid.Parse(*sessionIDRaw)
	if err != nil {
		log.Fatalf("invalid session-id: %v", err)
	}

	input := conversation.PublishInput{
		TenantID:            tenantID,
		SessionID:           sessionID,
		TurnNumber:          *turnNumber,
		Role:                *role,
		Content:             *content,
		SourceDomain:        *sourceDomain,
		ModelUsed:           *modelUsed,
		SystemPromptVersion: *systemPromptVersion,
		PreviousTurns: []conversation.Turn{
			{Role: "user", Content: "開発期間の目安を教えてください。", TurnNumber: max(1, *turnNumber-2)},
			{Role: "assistant", Content: "まずは前提条件を確認します。", TurnNumber: max(1, *turnNumber-1)},
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	if !*publish {
		printer := &stdoutPublisher{}
		pub := conversation.NewPublisher(printer, *topic)
		if err := pub.PublishTurnCompleted(ctx, input); err != nil {
			log.Fatalf("dry-run build failed: %v", err)
		}
		log.Println("dry-run completed (no Pub/Sub publish). Use -publish to send message.")
		return
	}

	if strings.TrimSpace(*projectID) == "" {
		log.Fatal("project-id is required when -publish is enabled")
	}

	client, err := pubsub.NewClient(ctx, *projectID)
	if err != nil {
		log.Fatalf("create pubsub client: %v", err)
	}
	defer func() {
		_ = client.Close()
	}()

	pub := conversation.NewPublisher(conversation.NewPubSubPublisher(client), *topic)
	if err := pub.PublishTurnCompleted(ctx, input); err != nil {
		log.Fatalf("publish failed: %v", err)
	}

	log.Printf("published conversation.turn.completed (topic=%s, ordering_key=%s)", *topic, sessionID.String())
}

type stdoutPublisher struct{}

func (s *stdoutPublisher) Publish(_ context.Context, topic string, orderingKey string, data []byte) error {
	fmt.Printf("topic=%s ordering_key=%s\n", topic, orderingKey)
	fmt.Println(string(data))
	return nil
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
