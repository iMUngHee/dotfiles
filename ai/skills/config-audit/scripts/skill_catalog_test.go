package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestSeparatesClaudeListingFromCodexInventory(t *testing.T) {
	root := t.TempDir()
	writeSkill(t, root, "ai/skills/automatic", metadata("automatic", "Automatic capability", ""), "Instructions")
	writeSkill(t, root, "ai/skills/manual", manualMetadata("manual", "Manual capability"), "Instructions")
	writeSkill(t, root, "claude/skills/claude-native", metadata("claude-native", "Claude capability", ""), "Instructions")
	writeSkill(t, root, "codex/skills/codex-native", metadata("codex-native", "Codex capability", ""), "Instructions")

	report, code, stderr := runJSON(t, root)
	if code != 0 {
		t.Fatalf("run code = %d, stderr = %s", code, stderr)
	}
	assertNumber(t, report, 4, "authoring", "skill_count")
	assertNumber(t, report, 3, "claude", "deployed_skill_count")
	assertNumber(t, report, 2, "claude", "listed_skill_count")
	assertNumber(t, report, len("Automatic capability")+len("Claude capability"), "claude", "listing_chars")
	assertNumber(t, report, len("Manual capability"), "claude", "manual_excluded_chars")
	assertNumber(t, report, 3, "codex", "deployed_skill_count")
	assertNumber(t, report, len("Automatic capability")+len("Manual capability")+len("Codex capability"), "codex", "description_chars")
}

func TestAcceptsCurrentClaudeCodeFrontmatterTypes(t *testing.T) {
	root := t.TempDir()
	extra := strings.Join([]string{
		"when_to_use: Use for a matching request",
		"argument-hint: '[path]'",
		"arguments: [path, mode]",
		"user-invocable: false",
		"allowed-tools: [Read, 'Bash(git status)']",
		"model: sonnet",
		"effort: high",
		"context: fork",
		"agent: general-purpose",
		"hooks:",
		"  PreToolUse: []",
		"paths: ['ai/skills/**']",
		"shell: bash",
	}, "\n") + "\n"
	writeSkill(t, root, "ai/skills/all-fields", metadata("all-fields", "Primary capability", extra), "Instructions")
	writeSkill(t, root, "ai/skills/string-tools", metadata("string-tools", "String tools", "allowed-tools: Read Grep\n"), "Instructions")

	report, code, stderr := runJSON(t, root)
	if code != 0 {
		t.Fatalf("run code = %d, stderr = %s", code, stderr)
	}
	if got := diagnostics(report, "fail"); len(got) != 0 {
		t.Fatalf("unexpected failures: %#v", got)
	}
	skill := findSkill(t, report, "claude", "all-fields")
	assertValue(t, skill["listing_chars"], len("Primary capability")+len("Use for a matching request"), "listing_chars")
}

func TestReportsInvalidYAMLAndFieldTypesAsFailures(t *testing.T) {
	root := t.TempDir()
	writeRawSkill(t, root, "ai/skills/broken-yaml", "---\nname: broken-yaml\ndescription: [\n---\nInstructions\n")
	writeRawSkill(t, root, "ai/skills/broken-types", "---\nname: [not, a, string]\ndescription: Broken types\ndisable-model-invocation: false\n---\nInstructions\n")

	report, code, _ := runJSON(t, root)
	if code != 1 {
		t.Fatalf("run code = %d, want 1", code)
	}
	assertDiagnosticCode(t, report, "frontmatter-yaml")
	assertDiagnosticCode(t, report, "frontmatter-type")
}

func TestModelsOverlayNestedSkillsAndDuplicateNames(t *testing.T) {
	root := t.TempDir()
	writeSkill(t, root, "ai/skills/shadowed", metadata("shared-shadowed", "Shared shadowed", ""), "Instructions")
	writeSkill(t, root, "claude/skills/shadowed", metadata("claude-shadowed", "Claude shadowed", ""), "Instructions")
	writeSkill(t, root, "ai/skills/container", metadata("container", "Container", ""), "Instructions")
	writeSkill(t, root, "ai/skills/container/node_modules/tool/trace", metadata("nested-trace", "Nested trace", ""), "Instructions")
	writeSkill(t, root, "ai/skills/duplicate-one", metadata("duplicate", "Duplicate one", ""), "Instructions")
	writeSkill(t, root, "ai/skills/duplicate-two", metadata("duplicate", "Duplicate two", ""), "Instructions")

	report, code, _ := runJSON(t, root)
	if code != 1 {
		t.Fatalf("run code = %d, want 1", code)
	}
	assertDiagnosticCode(t, report, "overlay-shadow")
	assertDiagnosticCode(t, report, "duplicate-name")
	assertNumber(t, report, 1, "structure", "nested_skill_count")
	assertSkillPresent(t, report, "claude", "claude-shadowed", true)
	assertSkillPresent(t, report, "claude", "shared-shadowed", false)
	assertSkillPresent(t, report, "codex", "shared-shadowed", true)
	assertSkillPresent(t, report, "claude", "nested-trace", true)
	assertSkillPresent(t, report, "codex", "nested-trace", true)
}

func TestChecksOnlyExplicitResourcePrefixes(t *testing.T) {
	root := t.TempDir()
	body := "Read `references/existing.md` and [missing](scripts/missing.sh). Ignore `notes.md`."
	writeSkill(t, root, "ai/skills/resources", metadata("resources", "Resource checks", ""), body)
	resourceDir := filepath.Join(root, "ai/skills/resources/references")
	if err := os.MkdirAll(resourceDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(resourceDir, "existing.md"), []byte("# Existing\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	report, code, _ := runJSON(t, root)
	if code != 1 {
		t.Fatalf("run code = %d, want 1", code)
	}
	broken := diagnosticsByCode(report, "broken-resource")
	if len(broken) != 1 {
		t.Fatalf("broken-resource count = %d, want 1", len(broken))
	}
	if !strings.Contains(broken[0]["message"].(string), "scripts/missing.sh") {
		t.Fatalf("unexpected message: %v", broken[0]["message"])
	}
	encoded, _ := json.Marshal(report)
	if strings.Contains(string(encoded), "notes.md") {
		t.Fatalf("non-resource notes.md was treated as a resource: %s", encoded)
	}
}

func TestOfficialLimitsAndUnknownFieldsAreWarningsOnly(t *testing.T) {
	root := t.TempDir()
	extra := "future-field: preserve forward compatibility\n"
	body := strings.Repeat("Instruction\n", 501)
	writeSkill(t, root, "ai/skills/large", metadata("large", strings.Repeat("x", 1537), extra), body)

	report, code, stderr := runJSON(t, root)
	if code != 0 {
		t.Fatalf("run code = %d, stderr = %s", code, stderr)
	}
	if got := diagnostics(report, "fail"); len(got) != 0 {
		t.Fatalf("unexpected failures: %#v", got)
	}
	assertDiagnosticCode(t, report, "claude-listing-cap")
	assertDiagnosticCode(t, report, "skill-body-lines")
	assertDiagnosticCode(t, report, "unknown-field")
}

func TestMissingExplicitMetadataIsAWarning(t *testing.T) {
	root := t.TempDir()
	writeRawSkill(t, root, "ai/skills/implicit", "---\ndescription: Implicit metadata\n---\nInstructions\n")

	report, code, stderr := runJSON(t, root)
	if code != 0 {
		t.Fatalf("run code = %d, stderr = %s", code, stderr)
	}
	missing := diagnosticsByCode(report, "explicit-local-field")
	fields := make([]string, 0, len(missing))
	for _, item := range missing {
		fields = append(fields, item["field"].(string))
	}
	if strings.Join(fields, ",") != "disable-model-invocation,name" && strings.Join(fields, ",") != "name,disable-model-invocation" {
		t.Fatalf("missing fields = %v", fields)
	}
}

func TestTextAndJSONAreDeterministicAndRanked(t *testing.T) {
	root := t.TempDir()
	writeSkill(t, root, "ai/skills/small", metadata("small", "Small", ""), "Instructions")
	writeSkill(t, root, "ai/skills/large", metadata("large", "A much larger capability", ""), "Instructions")

	first, _, firstCode := runCatalog(root, "--format", "json")
	second, _, secondCode := runCatalog(root, "--format", "json")
	text, textErr, textCode := runCatalog(root)
	if firstCode != 0 || secondCode != 0 || textCode != 0 {
		t.Fatalf("codes = %d/%d/%d, text stderr = %s", firstCode, secondCode, textCode, textErr)
	}
	if first != second {
		t.Fatal("JSON output is not deterministic")
	}
	for _, section := range []string{"AUTHORING", "CLAUDE", "CODEX", "STRUCTURE", "TOP CONTRIBUTORS"} {
		if !strings.Contains(text, section) {
			t.Errorf("text output missing %s", section)
		}
	}
	if strings.Index(text, "large") >= strings.Index(text, "small") {
		t.Fatalf("contributors are not ranked by size:\n%s", text)
	}
}

func TestInvalidRootAndFormatExitTwo(t *testing.T) {
	root := t.TempDir()
	_, stderr, code := runCatalog(filepath.Join(root, "missing"))
	if code != 2 || !strings.Contains(stderr, "root") {
		t.Fatalf("invalid root code/stderr = %d/%q", code, stderr)
	}
	_, stderr, code = runCatalog(root, "--format", "xml")
	if code != 2 || !strings.Contains(stderr, "format") {
		t.Fatalf("invalid format code/stderr = %d/%q", code, stderr)
	}
}

func metadata(name, description, extra string) string {
	return fmt.Sprintf("name: %s\ndescription: %s\ndisable-model-invocation: false\n%s", name, strconv.Quote(description), extra)
}

func manualMetadata(name, description string) string {
	return fmt.Sprintf("name: %s\ndescription: %s\ndisable-model-invocation: true\n", name, strconv.Quote(description))
}

func writeSkill(t *testing.T, root, relativeDirectory, frontmatter, body string) {
	t.Helper()
	writeRawSkill(t, root, relativeDirectory, "---\n"+frontmatter+"---\n"+body+"\n")
}

func writeRawSkill(t *testing.T, root, relativeDirectory, content string) {
	t.Helper()
	directory := filepath.Join(root, filepath.FromSlash(relativeDirectory))
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "SKILL.md"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func runCatalog(root string, args ...string) (string, string, int) {
	arguments := append([]string{"--root", root}, args...)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	code := run(arguments, &stdout, &stderr)
	return stdout.String(), stderr.String(), code
}

func runJSON(t *testing.T, root string) (map[string]any, int, string) {
	t.Helper()
	stdout, stderr, code := runCatalog(root, "--format", "json")
	var report map[string]any
	if err := json.Unmarshal([]byte(stdout), &report); err != nil {
		t.Fatalf("catalog did not return JSON: %v\nstdout: %s\nstderr: %s", err, stdout, stderr)
	}
	return report, code, stderr
}

func diagnostics(report map[string]any, severity string) []map[string]any {
	items := report["diagnostics"].([]any)
	result := make([]map[string]any, 0)
	for _, raw := range items {
		item := raw.(map[string]any)
		if item["severity"] == severity {
			result = append(result, item)
		}
	}
	return result
}

func diagnosticsByCode(report map[string]any, code string) []map[string]any {
	items := report["diagnostics"].([]any)
	result := make([]map[string]any, 0)
	for _, raw := range items {
		item := raw.(map[string]any)
		if item["code"] == code {
			result = append(result, item)
		}
	}
	return result
}

func assertDiagnosticCode(t *testing.T, report map[string]any, code string) {
	t.Helper()
	if len(diagnosticsByCode(report, code)) == 0 {
		t.Fatalf("missing diagnostic code %s: %#v", code, report["diagnostics"])
	}
}

func assertNumber(t *testing.T, report map[string]any, want int, keys ...string) {
	t.Helper()
	var current any = report
	for _, key := range keys {
		current = current.(map[string]any)[key]
	}
	assertValue(t, current, want, strings.Join(keys, "."))
}

func assertValue(t *testing.T, got any, want int, label string) {
	t.Helper()
	value, ok := got.(float64)
	if !ok || int(value) != want {
		t.Fatalf("%s = %#v, want %d", label, got, want)
	}
}

func findSkill(t *testing.T, report map[string]any, runtime, name string) map[string]any {
	t.Helper()
	view := report[runtime].(map[string]any)
	for _, raw := range view["skills"].([]any) {
		skill := raw.(map[string]any)
		if skill["name"] == name {
			return skill
		}
	}
	t.Fatalf("skill %s not found in %s", name, runtime)
	return nil
}

func assertSkillPresent(t *testing.T, report map[string]any, runtime, name string, want bool) {
	t.Helper()
	view := report[runtime].(map[string]any)
	found := false
	for _, raw := range view["skills"].([]any) {
		if raw.(map[string]any)["name"] == name {
			found = true
			break
		}
	}
	if found != want {
		t.Fatalf("skill %s present in %s = %v, want %v", name, runtime, found, want)
	}
}
