package prompt

import "testing"

func TestInjectCompletenessFeedback(t *testing.T) {
	t.Parallel()

	got := InjectCompletenessFeedback("base prompt", []string{"budget_range", "deadline"})
	want := "base prompt\n\n未収集項目: [budget_range, deadline]"
	if got != want {
		t.Fatalf("InjectCompletenessFeedback() = %q, want %q", got, want)
	}
}

func TestInjectCompletenessFeedback_EmptyBase(t *testing.T) {
	t.Parallel()

	got := InjectCompletenessFeedback("", []string{"scope"})
	want := "未収集項目: [scope]"
	if got != want {
		t.Fatalf("InjectCompletenessFeedback() = %q, want %q", got, want)
	}
}

func TestShouldMarkConversationComplete(t *testing.T) {
	t.Parallel()

	if ShouldMarkConversationComplete(0.79) {
		t.Fatal("expected false for completeness below threshold")
	}
	if !ShouldMarkConversationComplete(0.8) {
		t.Fatal("expected true for completeness at threshold")
	}
}
