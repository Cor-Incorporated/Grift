package handler

import (
	"encoding/json"
	"net/http"
)

// maxLimit is the upper-bound cap for the limit query parameter.
const maxLimit = 100

// writeJSON writes a JSON response with the given status code.
func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeJSONError writes a JSON error response.
func writeJSONError(w http.ResponseWriter, msg string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// errorBody creates a simple error response body.
func errorBody(msg string) map[string]string {
	return map[string]string{"error": msg}
}
