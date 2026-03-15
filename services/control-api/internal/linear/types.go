package linear

// LinearProject represents the subset of project fields used by control-api.
type LinearProject struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	URL  string `json:"url"`
}

// LinearCycle represents the subset of cycle fields used by control-api.
type LinearCycle struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	URL  string `json:"url"`
}

// LinearIssue represents the subset of issue fields used by control-api.
type LinearIssue struct {
	ID         string `json:"id"`
	Identifier string `json:"identifier"`
	Title      string `json:"title"`
	URL        string `json:"url"`
}
