package middleware

import (
	"context"
	"fmt"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"google.golang.org/api/option"
)

// FirebaseVerifier implements TokenVerifier using the Firebase Admin SDK.
type FirebaseVerifier struct {
	client *auth.Client
}

// NewFirebaseVerifier creates a new FirebaseVerifier. It initializes the
// Firebase App using environment credentials (GOOGLE_APPLICATION_CREDENTIALS)
// or explicit project ID configuration.
//
// If projectID is empty, the SDK will use GOOGLE_APPLICATION_CREDENTIALS
// or Application Default Credentials (ADC).
func NewFirebaseVerifier(ctx context.Context, projectID string) (*FirebaseVerifier, error) {
	var app *firebase.App
	var err error

	if projectID != "" {
		config := &firebase.Config{ProjectID: projectID}
		app, err = firebase.NewApp(ctx, config)
	} else {
		app, err = firebase.NewApp(ctx, nil)
	}
	if err != nil {
		return nil, fmt.Errorf("initializing firebase app: %w", err)
	}

	client, err := app.Auth(ctx)
	if err != nil {
		return nil, fmt.Errorf("initializing firebase auth client: %w", err)
	}

	return &FirebaseVerifier{client: client}, nil
}

// NewFirebaseVerifierWithCredentials creates a FirebaseVerifier using an explicit
// credentials JSON file path. This is useful for testing and environments where
// GOOGLE_APPLICATION_CREDENTIALS is not set.
func NewFirebaseVerifierWithCredentials(ctx context.Context, projectID, credentialsFile string) (*FirebaseVerifier, error) {
	var opts []option.ClientOption
	if credentialsFile != "" {
		opts = append(opts, option.WithCredentialsFile(credentialsFile))
	}

	config := &firebase.Config{ProjectID: projectID}
	app, err := firebase.NewApp(ctx, config, opts...)
	if err != nil {
		return nil, fmt.Errorf("initializing firebase app: %w", err)
	}

	client, err := app.Auth(ctx)
	if err != nil {
		return nil, fmt.Errorf("initializing firebase auth client: %w", err)
	}

	return &FirebaseVerifier{client: client}, nil
}

// VerifyIDToken verifies a Firebase ID token and returns the user ID and email.
func (fv *FirebaseVerifier) VerifyIDToken(ctx context.Context, idToken string) (string, string, error) {
	token, err := fv.client.VerifyIDToken(ctx, idToken)
	if err != nil {
		return "", "", fmt.Errorf("verifying id token: %w", err)
	}

	email, _ := token.Claims["email"].(string)
	return token.UID, email, nil
}
