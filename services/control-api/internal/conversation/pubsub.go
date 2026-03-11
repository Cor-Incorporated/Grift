package conversation

import (
	"context"
	"fmt"

	"cloud.google.com/go/pubsub/v2"
)

// PubSubPublisher publishes events to Google Cloud Pub/Sub.
type PubSubPublisher struct {
	client *pubsub.Client
}

// NewPubSubPublisher creates a new Pub/Sub-backed publisher.
func NewPubSubPublisher(client *pubsub.Client) *PubSubPublisher {
	return &PubSubPublisher{client: client}
}

// Publish sends one message to a Pub/Sub topic with ordering key.
func (p *PubSubPublisher) Publish(ctx context.Context, topic string, orderingKey string, data []byte) error {
	if p == nil || p.client == nil {
		return fmt.Errorf("pubsub client is not configured")
	}
	if topic == "" {
		return fmt.Errorf("topic is required")
	}
	if orderingKey == "" {
		return fmt.Errorf("ordering key is required")
	}

	publisher := p.client.Publisher(topic)
	publisher.EnableMessageOrdering = true
	defer publisher.Stop()

	result := publisher.Publish(ctx, &pubsub.Message{
		Data:        data,
		OrderingKey: orderingKey,
	})

	if _, err := result.Get(ctx); err != nil {
		return fmt.Errorf("publish to topic %q: %w", topic, err)
	}
	return nil
}
