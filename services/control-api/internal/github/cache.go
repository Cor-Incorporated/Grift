// Package github provides GitHub App authentication and token management
// for the BenevolentDirector control-api service.
package github

import (
	"context"
	"sync"
	"time"
)

// TokenCache provides get/set operations for caching installation tokens.
// Implementations must be safe for concurrent use.
type TokenCache interface {
	// Get retrieves a cached value by key. Returns an empty string and no error
	// if the key is not found or has expired.
	Get(ctx context.Context, key string) (string, error)

	// Set stores a value with the given key and TTL. If the key already exists,
	// the value and TTL are replaced.
	Set(ctx context.Context, key string, value string, ttl time.Duration) error
}

type cacheEntry struct {
	value     string
	expiresAt time.Time
}

// InMemoryCache is a simple in-memory TokenCache implementation suitable for
// local development and testing. For production use with multiple replicas,
// replace with a Redis-backed implementation.
type InMemoryCache struct {
	mu      sync.RWMutex
	entries map[string]cacheEntry
}

// NewInMemoryCache creates a new InMemoryCache.
func NewInMemoryCache() *InMemoryCache {
	return &InMemoryCache{
		entries: make(map[string]cacheEntry),
	}
}

// Get retrieves a cached value by key. Returns an empty string if the key is
// not found or has expired. Expired entries are lazily removed on access.
func (c *InMemoryCache) Get(_ context.Context, key string) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	entry, ok := c.entries[key]
	if !ok {
		return "", nil
	}

	if time.Now().After(entry.expiresAt) {
		delete(c.entries, key)
		return "", nil
	}

	return entry.value, nil
}

// Set stores a value with the given key and TTL.
func (c *InMemoryCache) Set(_ context.Context, key string, value string, ttl time.Duration) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.entries[key] = cacheEntry{
		value:     value,
		expiresAt: time.Now().Add(ttl),
	}
	return nil
}

// TODO: Add RedisCache implementation when Redis dependency is available.
// type RedisCache struct { client *redis.Client }
// func NewRedisCache(client *redis.Client) *RedisCache { ... }
