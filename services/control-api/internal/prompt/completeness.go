package prompt

import "fmt"

const CompletenessThreshold = 0.8

// InjectCompletenessFeedback appends checklist guidance to a base system prompt.
func InjectCompletenessFeedback(basePrompt string, missingItems []string) string {
	feedback := fmt.Sprintf("未収集項目: [%s]", joinMissingItems(missingItems))
	if basePrompt == "" {
		return feedback
	}
	return basePrompt + "\n\n" + feedback
}

// ShouldMarkConversationComplete returns true when completeness meets the threshold.
func ShouldMarkConversationComplete(completeness float64) bool {
	return completeness >= CompletenessThreshold
}

func joinMissingItems(items []string) string {
	if len(items) == 0 {
		return ""
	}
	joined := items[0]
	for i := 1; i < len(items); i++ {
		joined += ", " + items[i]
	}
	return joined
}
