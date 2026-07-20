package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

const (
	claudeListingCap = 1536
	skillBodyLineCap = 500
)

var (
	knownFields = map[string]struct{}{
		"name": {}, "description": {}, "when_to_use": {}, "argument-hint": {},
		"arguments": {}, "disable-model-invocation": {}, "user-invocable": {},
		"allowed-tools": {}, "model": {}, "effort": {}, "context": {},
		"agent": {}, "hooks": {}, "paths": {}, "shell": {},
	}
	requiredLocalFields = []string{"name", "description", "disable-model-invocation"}
	resourcePrefixes    = []string{"references/", "scripts/", "assets/"}
	namePattern         = regexp.MustCompile(`^[a-z0-9-]{1,64}$`)
	inlineCodePattern   = regexp.MustCompile("`([^`\\n]+)`")
	markdownLinkPattern = regexp.MustCompile(`\]\(([^)]+)\)`)
)

type diagnostic struct {
	Severity   string `json:"severity"`
	Code       string `json:"code"`
	Path       string `json:"path"`
	Message    string `json:"message"`
	Suggestion string `json:"suggestion"`
	Field      string `json:"field,omitempty"`
	Runtime    string `json:"runtime,omitempty"`
}

type skillRecord struct {
	Name                 string `json:"name"`
	Path                 string `json:"path"`
	SourceTier           string `json:"source_tier"`
	TopLevelKey          string `json:"top_level_key"`
	Nested               bool   `json:"nested"`
	DescriptionChars     int    `json:"description_chars"`
	WhenToUseChars       int    `json:"when_to_use_chars"`
	CombinedListingChars int    `json:"combined_listing_chars"`
	BodyLines            int    `json:"body_lines"`
	ManualOnly           bool   `json:"manual_only"`
}

type runtimeSkill struct {
	skillRecord
	Listed       bool `json:"listed,omitempty"`
	ListingChars int  `json:"listing_chars,omitempty"`
}

type rootSpec struct {
	tier      string
	key       string
	directory string
	records   []skillRecord
}

type authoringView struct {
	SkillCount int           `json:"skill_count"`
	FailCount  int           `json:"fail_count"`
	WarnCount  int           `json:"warn_count"`
	Skills     []skillRecord `json:"skills"`
}

type claudeView struct {
	DeployedSkillCount  int            `json:"deployed_skill_count"`
	ListedSkillCount    int            `json:"listed_skill_count"`
	ListingChars        int            `json:"listing_chars"`
	ManualExcludedChars int            `json:"manual_excluded_chars"`
	Skills              []runtimeSkill `json:"skills"`
}

type codexView struct {
	DeployedSkillCount int            `json:"deployed_skill_count"`
	DescriptionChars   int            `json:"description_chars"`
	Skills             []runtimeSkill `json:"skills"`
}

type structureView struct {
	NestedSkillCount     int `json:"nested_skill_count"`
	BrokenReferenceCount int `json:"broken_reference_count"`
	OverlayShadowCount   int `json:"overlay_shadow_count"`
}

type summary struct {
	Fail int `json:"fail"`
	Warn int `json:"warn"`
	Info int `json:"info"`
}

type report struct {
	SchemaVersion int               `json:"schema_version"`
	Root          string            `json:"root"`
	Metrics       map[string]string `json:"metrics"`
	Authoring     authoringView     `json:"authoring"`
	Claude        claudeView        `json:"claude"`
	Codex         codexView         `json:"codex"`
	Structure     structureView     `json:"structure"`
	Diagnostics   []diagnostic      `json:"diagnostics"`
	Summary       summary           `json:"summary"`
}

type catalog struct {
	root        string
	diagnostics []diagnostic
}

func newCatalog(root string) (*catalog, error) {
	resolved, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, err
	}
	resolved, err = filepath.Abs(resolved)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("root is not a directory: %s", root)
	}
	return &catalog{root: resolved}, nil
}

func (c *catalog) buildReport() (report, error) {
	roots, err := c.discoverRoots()
	if err != nil {
		return report{}, err
	}
	authoringRecords := flattenRoots(roots)
	claudeRecords := flattenRoots(c.effectiveRoots(roots, "claude"))
	codexRecords := flattenRoots(c.effectiveRoots(roots, "codex"))
	c.diagnoseDuplicateNames(claudeRecords, "claude")
	c.diagnoseDuplicateNames(codexRecords, "codex")
	c.sortDiagnostics()

	result := report{
		SchemaVersion: 1,
		Root:          c.root,
		Metrics:       map[string]string{"unit": "characters"},
		Authoring:     c.makeAuthoringView(authoringRecords),
		Claude:        makeClaudeView(claudeRecords),
		Codex:         makeCodexView(codexRecords),
		Structure:     c.makeStructureView(authoringRecords),
		Diagnostics:   append([]diagnostic{}, c.diagnostics...),
		Summary:       c.makeSummary(),
	}
	return result, nil
}

func (c *catalog) discoverRoots() ([]rootSpec, error) {
	specs := []struct {
		tier    string
		pattern string
	}{
		{"shared", "ai/skills/*"},
		{"private", "ai/skills/private/*"},
		{"claude", "claude/skills/*"},
		{"codex", "codex/skills/*"},
	}
	var roots []rootSpec
	for _, spec := range specs {
		matches, err := filepath.Glob(filepath.Join(c.root, filepath.FromSlash(spec.pattern)))
		if err != nil {
			return nil, err
		}
		sort.Strings(matches)
		for _, directory := range matches {
			info, err := os.Stat(directory)
			if err != nil || !info.IsDir() {
				continue
			}
			if _, err := os.Stat(filepath.Join(directory, "SKILL.md")); err != nil {
				continue
			}
			records, err := c.discoverSkills(directory, spec.tier)
			if err != nil {
				return nil, err
			}
			roots = append(roots, rootSpec{
				tier: spec.tier, key: filepath.Base(directory), directory: directory, records: records,
			})
		}
	}
	return roots, nil
}

func (c *catalog) discoverSkills(topDirectory, tier string) ([]skillRecord, error) {
	var paths []string
	err := filepath.WalkDir(topDirectory, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() && entry.Name() == ".git" {
			return filepath.SkipDir
		}
		if !entry.IsDir() && entry.Name() == "SKILL.md" {
			paths = append(paths, path)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(paths)
	records := make([]skillRecord, 0, len(paths))
	for _, path := range paths {
		record, err := c.parseSkill(path, tier, topDirectory)
		if err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, nil
}

func (c *catalog) parseSkill(path, tier, topDirectory string) (skillRecord, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return skillRecord{}, err
	}
	relativePath := c.relative(path)
	metadata, body := c.parseFrontmatter(string(content), relativePath)
	c.diagnoseFields(metadata, relativePath)

	name, ok := metadata["name"].(string)
	if !ok || name == "" {
		name = filepath.Base(filepath.Dir(path))
	}
	description, ok := metadata["description"].(string)
	if !ok {
		description = firstParagraph(body)
	}
	whenToUse, _ := metadata["when_to_use"].(string)
	manualOnly, _ := metadata["disable-model-invocation"].(bool)
	combined := len([]rune(description)) + len([]rune(whenToUse))
	if !manualOnly && combined > claudeListingCap {
		c.addDiagnostic(diagnostic{
			Severity: "warn", Code: "claude-listing-cap", Path: relativePath,
			Message:    fmt.Sprintf("description + when_to_use is %d characters; Claude Code's default per-skill listing cap is %d", combined, claudeListingCap),
			Suggestion: "Shorten the leading routing text or verify an intentional maxSkillDescriptionChars override.",
		})
	}
	bodyLines := countLines(body)
	if bodyLines > skillBodyLineCap {
		c.addDiagnostic(diagnostic{
			Severity: "warn", Code: "skill-body-lines", Path: relativePath,
			Message:    fmt.Sprintf("SKILL.md body is %d lines; Claude Code recommends keeping it under %d", bodyLines, skillBodyLineCap),
			Suggestion: "Move conditional detail into an explicitly referenced supporting file.",
		})
	}
	c.diagnoseResources(body, path, relativePath)

	return skillRecord{
		Name: name, Path: relativePath, SourceTier: tier, TopLevelKey: filepath.Base(topDirectory),
		Nested:           filepath.Clean(path) != filepath.Join(filepath.Clean(topDirectory), "SKILL.md"),
		DescriptionChars: len([]rune(description)), WhenToUseChars: len([]rune(whenToUse)),
		CombinedListingChars: combined, BodyLines: bodyLines, ManualOnly: manualOnly,
	}, nil
}

func (c *catalog) parseFrontmatter(content, relativePath string) (map[string]any, string) {
	lines := strings.Split(content, "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		c.addDiagnostic(diagnostic{
			Severity: "fail", Code: "frontmatter-yaml", Path: relativePath,
			Message:    "SKILL.md does not start with a YAML frontmatter delimiter",
			Suggestion: "Add a leading --- block containing Claude Code skill metadata.",
		})
		return map[string]any{}, content
	}
	closing := -1
	for index := 1; index < len(lines); index++ {
		if strings.TrimSpace(lines[index]) == "---" {
			closing = index
			break
		}
	}
	if closing < 0 {
		c.addDiagnostic(diagnostic{
			Severity: "fail", Code: "frontmatter-yaml", Path: relativePath,
			Message:    "SKILL.md frontmatter has no closing delimiter",
			Suggestion: "Close the YAML frontmatter with a standalone --- line.",
		})
		return map[string]any{}, strings.Join(lines[1:], "\n")
	}

	yamlText := strings.Join(lines[1:closing], "\n")
	body := strings.Join(lines[closing+1:], "\n")
	var node yaml.Node
	if err := yaml.Unmarshal([]byte(yamlText), &node); err != nil {
		c.addDiagnostic(diagnostic{
			Severity: "fail", Code: "frontmatter-yaml", Path: relativePath,
			Message:    "frontmatter YAML cannot be parsed: " + firstLine(err.Error()),
			Suggestion: "Correct the YAML syntax before measuring this skill.",
		})
		return map[string]any{}, body
	}
	if len(node.Content) > 0 && node.Content[0].Kind != yaml.MappingNode {
		c.addDiagnostic(diagnostic{
			Severity: "fail", Code: "frontmatter-type", Path: relativePath,
			Message:    "frontmatter root must be a mapping",
			Suggestion: "Use key-value YAML fields between the delimiters.",
		})
		return map[string]any{}, body
	}
	metadata := map[string]any{}
	if err := yaml.Unmarshal([]byte(yamlText), &metadata); err != nil {
		c.addDiagnostic(diagnostic{
			Severity: "fail", Code: "frontmatter-yaml", Path: relativePath,
			Message:    "frontmatter YAML cannot be parsed: " + firstLine(err.Error()),
			Suggestion: "Correct the YAML syntax before measuring this skill.",
		})
		return map[string]any{}, body
	}
	return metadata, body
}

func (c *catalog) diagnoseFields(metadata map[string]any, relativePath string) {
	for _, field := range requiredLocalFields {
		if _, ok := metadata[field]; ok {
			continue
		}
		c.addDiagnostic(diagnostic{
			Severity: "warn", Code: "explicit-local-field", Path: relativePath, Field: field,
			Message:    "local authoring convention expects an explicit " + field + " field",
			Suggestion: "Add " + field + " using Claude Code semantics.",
		})
	}
	fields := make([]string, 0, len(metadata))
	for field := range metadata {
		fields = append(fields, field)
	}
	sort.Strings(fields)
	for _, field := range fields {
		value := metadata[field]
		if _, ok := knownFields[field]; !ok {
			c.addDiagnostic(diagnostic{
				Severity: "warn", Code: "unknown-field", Path: relativePath, Field: field,
				Message:    field + " is not in the checked Claude Code skill field set",
				Suggestion: "Verify the current Claude Code documentation; keep the field if it is intentional.",
			})
			continue
		}
		if validFieldType(field, value) {
			continue
		}
		c.addDiagnostic(diagnostic{
			Severity: "fail", Code: "frontmatter-type", Path: relativePath, Field: field,
			Message:    fmt.Sprintf("%s has an invalid value type %T", field, value),
			Suggestion: "Use the Claude Code-supported type for " + field + ".",
		})
	}
	if name, ok := metadata["name"].(string); ok && !namePattern.MatchString(name) {
		c.addDiagnostic(diagnostic{
			Severity: "fail", Code: "skill-name", Path: relativePath, Field: "name",
			Message:    "name must contain only lowercase letters, numbers, and hyphens and be at most 64 characters",
			Suggestion: "Rename the display name to the Claude Code-supported format.",
		})
	}
}

func validFieldType(field string, value any) bool {
	switch field {
	case "name", "description", "when_to_use", "argument-hint", "model", "effort", "context", "agent", "shell":
		_, ok := value.(string)
		return ok
	case "disable-model-invocation", "user-invocable":
		_, ok := value.(bool)
		return ok
	case "arguments", "allowed-tools", "paths":
		if _, ok := value.(string); ok {
			return true
		}
		return stringSlice(value)
	case "hooks":
		switch value.(type) {
		case map[string]any, []any:
			return true
		default:
			return false
		}
	default:
		return true
	}
}

func stringSlice(value any) bool {
	items, ok := value.([]any)
	if !ok {
		return false
	}
	for _, item := range items {
		if _, ok := item.(string); !ok {
			return false
		}
	}
	return true
}

func (c *catalog) diagnoseResources(body, skillPath, relativePath string) {
	for _, token := range resourceTokens(body) {
		target := filepath.Join(filepath.Dir(skillPath), filepath.FromSlash(token))
		exists := false
		if strings.ContainsAny(token, "*?[") {
			matches, _ := filepath.Glob(target)
			exists = len(matches) > 0
		} else if _, err := os.Stat(target); err == nil {
			exists = true
		}
		if exists {
			continue
		}
		c.addDiagnostic(diagnostic{
			Severity: "fail", Code: "broken-resource", Path: relativePath,
			Message:    "referenced resource does not exist: " + token,
			Suggestion: "Create the resource or correct the relative path.",
		})
	}
}

func resourceTokens(body string) []string {
	var candidates []string
	for _, match := range inlineCodePattern.FindAllStringSubmatch(body, -1) {
		candidates = append(candidates, match[1])
	}
	for _, match := range markdownLinkPattern.FindAllStringSubmatch(body, -1) {
		candidates = append(candidates, strings.Fields(match[1])[0])
	}
	seen := map[string]struct{}{}
	var tokens []string
	for _, raw := range candidates {
		token := strings.TrimSpace(raw)
		token = strings.TrimPrefix(token, "<")
		token = strings.TrimSuffix(token, ">")
		token = strings.SplitN(token, "#", 2)[0]
		for _, prefix := range resourcePrefixes {
			if strings.HasPrefix(token, prefix) {
				if _, ok := seen[token]; !ok {
					seen[token] = struct{}{}
					tokens = append(tokens, token)
				}
				break
			}
		}
	}
	sort.Strings(tokens)
	return tokens
}

func (c *catalog) effectiveRoots(roots []rootSpec, runtimeName string) []rootSpec {
	accepted := map[string]bool{"shared": true, "private": true, runtimeName: true}
	selected := map[string]rootSpec{}
	for _, entry := range roots {
		if !accepted[entry.tier] {
			continue
		}
		if previous, ok := selected[entry.key]; ok {
			c.addDiagnostic(diagnostic{
				Severity: "warn", Code: "overlay-shadow", Path: c.relative(entry.directory), Runtime: runtimeName,
				Message:    fmt.Sprintf("%s overlay key %s replaces %s", runtimeName, entry.key, c.relative(previous.directory)),
				Suggestion: "Keep the shadow only when the tool-native override is intentional.",
			})
		}
		selected[entry.key] = entry
	}
	keys := make([]string, 0, len(selected))
	for key := range selected {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]rootSpec, 0, len(keys))
	for _, key := range keys {
		result = append(result, selected[key])
	}
	return result
}

func (c *catalog) diagnoseDuplicateNames(records []skillRecord, runtimeName string) {
	grouped := map[string][]skillRecord{}
	for _, record := range records {
		grouped[record.Name] = append(grouped[record.Name], record)
	}
	names := make([]string, 0, len(grouped))
	for name := range grouped {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		matches := grouped[name]
		if len(matches) < 2 {
			continue
		}
		paths := make([]string, 0, len(matches))
		for _, match := range matches {
			paths = append(paths, match.Path)
		}
		sort.Strings(paths)
		c.addDiagnostic(diagnostic{
			Severity: "fail", Code: "duplicate-name", Path: paths[0], Runtime: runtimeName,
			Message:    fmt.Sprintf("%s deployment contains duplicate skill name %s: %s", runtimeName, name, strings.Join(paths, ", ")),
			Suggestion: "Give each effective skill a unique frontmatter name.",
		})
	}
}

func (c *catalog) makeAuthoringView(records []skillRecord) authoringView {
	sortSkills(records)
	view := authoringView{SkillCount: len(records), Skills: records}
	for _, item := range c.diagnostics {
		switch item.Severity {
		case "fail":
			view.FailCount++
		case "warn":
			view.WarnCount++
		}
	}
	return view
}

func makeClaudeView(records []skillRecord) claudeView {
	view := claudeView{DeployedSkillCount: len(records)}
	for _, record := range records {
		skill := runtimeSkill{skillRecord: record, Listed: !record.ManualOnly}
		if record.ManualOnly {
			view.ManualExcludedChars += record.CombinedListingChars
		} else {
			skill.ListingChars = record.CombinedListingChars
			view.ListedSkillCount++
			view.ListingChars += skill.ListingChars
		}
		view.Skills = append(view.Skills, skill)
	}
	sortRuntimeSkills(view.Skills)
	return view
}

func makeCodexView(records []skillRecord) codexView {
	view := codexView{DeployedSkillCount: len(records)}
	for _, record := range records {
		view.Skills = append(view.Skills, runtimeSkill{skillRecord: record})
		view.DescriptionChars += record.DescriptionChars
	}
	sortRuntimeSkills(view.Skills)
	return view
}

func (c *catalog) makeStructureView(records []skillRecord) structureView {
	view := structureView{}
	for _, record := range records {
		if record.Nested {
			view.NestedSkillCount++
		}
	}
	for _, item := range c.diagnostics {
		switch item.Code {
		case "broken-resource":
			view.BrokenReferenceCount++
		case "overlay-shadow":
			view.OverlayShadowCount++
		}
	}
	return view
}

func (c *catalog) makeSummary() summary {
	var result summary
	for _, item := range c.diagnostics {
		switch item.Severity {
		case "fail":
			result.Fail++
		case "warn":
			result.Warn++
		case "info":
			result.Info++
		}
	}
	return result
}

func (c *catalog) addDiagnostic(item diagnostic) {
	c.diagnostics = append(c.diagnostics, item)
}

func (c *catalog) sortDiagnostics() {
	severity := map[string]int{"fail": 0, "warn": 1, "info": 2}
	sort.Slice(c.diagnostics, func(i, j int) bool {
		left, right := c.diagnostics[i], c.diagnostics[j]
		leftKey := fmt.Sprintf("%02d\x00%s\x00%s\x00%s\x00%s", severity[left.Severity], left.Path, left.Code, left.Field, left.Runtime)
		rightKey := fmt.Sprintf("%02d\x00%s\x00%s\x00%s\x00%s", severity[right.Severity], right.Path, right.Code, right.Field, right.Runtime)
		return leftKey < rightKey
	})
}

func (c *catalog) relative(path string) string {
	relative, err := filepath.Rel(c.root, path)
	if err != nil {
		return filepath.ToSlash(path)
	}
	return filepath.ToSlash(relative)
}

func flattenRoots(roots []rootSpec) []skillRecord {
	var records []skillRecord
	for _, root := range roots {
		records = append(records, root.records...)
	}
	return records
}

func sortSkills(skills []skillRecord) {
	sort.Slice(skills, func(i, j int) bool {
		if skills[i].Path == skills[j].Path {
			return skills[i].Name < skills[j].Name
		}
		return skills[i].Path < skills[j].Path
	})
}

func sortRuntimeSkills(skills []runtimeSkill) {
	sort.Slice(skills, func(i, j int) bool {
		if skills[i].Name == skills[j].Name {
			return skills[i].Path < skills[j].Path
		}
		return skills[i].Name < skills[j].Name
	})
}

func firstParagraph(body string) string {
	parts := regexp.MustCompile(`\n\s*\n`).Split(body, 2)
	if len(parts) == 0 {
		return ""
	}
	return strings.TrimSpace(parts[0])
}

func countLines(body string) int {
	body = strings.TrimSuffix(body, "\n")
	if body == "" {
		return 0
	}
	return strings.Count(body, "\n") + 1
}

func firstLine(value string) string {
	if index := strings.IndexByte(value, '\n'); index >= 0 {
		return value[:index]
	}
	return value
}

func validRoot(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return errors.New("not a directory")
	}
	return nil
}

func run(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("skill-catalog", flag.ContinueOnError)
	flags.SetOutput(stderr)
	root := flags.String("root", defaultRoot(), "configuration repository root")
	format := flags.String("format", "text", "text or json")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if flags.NArg() != 0 {
		fmt.Fprintf(stderr, "unexpected arguments: %s\n", strings.Join(flags.Args(), " "))
		return 2
	}
	if *format != "text" && *format != "json" {
		fmt.Fprintf(stderr, "format must be text or json: %s\n", *format)
		return 2
	}
	if err := validRoot(*root); err != nil {
		fmt.Fprintf(stderr, "root does not exist or is invalid: %s: %v\n", *root, err)
		return 2
	}

	catalog, err := newCatalog(*root)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	report, err := catalog.buildReport()
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	if *format == "json" {
		encoder := json.NewEncoder(stdout)
		encoder.SetIndent("", "  ")
		if err := encoder.Encode(report); err != nil {
			fmt.Fprintln(stderr, err)
			return 2
		}
	} else {
		renderText(stdout, report)
	}
	if report.Summary.Fail > 0 {
		return 1
	}
	return 0
}

func renderText(output io.Writer, value report) {
	fmt.Fprintln(output, "AUTHORING")
	fmt.Fprintf(output, "  skills: %d\n", value.Authoring.SkillCount)
	fmt.Fprintf(output, "  diagnostics: %d FAIL, %d WARN, %d INFO\n\n", value.Summary.Fail, value.Summary.Warn, value.Summary.Info)
	fmt.Fprintln(output, "CLAUDE")
	fmt.Fprintf(output, "  deployed skills: %d\n", value.Claude.DeployedSkillCount)
	fmt.Fprintf(output, "  listed skills: %d\n", value.Claude.ListedSkillCount)
	fmt.Fprintf(output, "  listing characters: %d\n", value.Claude.ListingChars)
	fmt.Fprintf(output, "  manual-only characters excluded: %d\n\n", value.Claude.ManualExcludedChars)
	fmt.Fprintln(output, "CODEX")
	fmt.Fprintf(output, "  deployed skills: %d\n", value.Codex.DeployedSkillCount)
	fmt.Fprintf(output, "  description characters: %d\n\n", value.Codex.DescriptionChars)
	fmt.Fprintln(output, "STRUCTURE")
	fmt.Fprintf(output, "  nested skills: %d\n", value.Structure.NestedSkillCount)
	fmt.Fprintf(output, "  broken resources: %d\n", value.Structure.BrokenReferenceCount)
	fmt.Fprintf(output, "  overlay shadows: %d\n\n", value.Structure.OverlayShadowCount)
	fmt.Fprintln(output, "TOP CONTRIBUTORS")
	fmt.Fprintln(output, "  Claude listing")
	claudeSkills := append([]runtimeSkill(nil), value.Claude.Skills...)
	sort.Slice(claudeSkills, func(i, j int) bool {
		if claudeSkills[i].ListingChars == claudeSkills[j].ListingChars {
			return claudeSkills[i].Name < claudeSkills[j].Name
		}
		return claudeSkills[i].ListingChars > claudeSkills[j].ListingChars
	})
	for _, skill := range claudeSkills {
		fmt.Fprintf(output, "    %-28s %6d  %s\n", skill.Name, skill.ListingChars, skill.Path)
	}
	fmt.Fprintln(output, "  Codex descriptions")
	codexSkills := append([]runtimeSkill(nil), value.Codex.Skills...)
	sort.Slice(codexSkills, func(i, j int) bool {
		if codexSkills[i].DescriptionChars == codexSkills[j].DescriptionChars {
			return codexSkills[i].Name < codexSkills[j].Name
		}
		return codexSkills[i].DescriptionChars > codexSkills[j].DescriptionChars
	})
	for _, skill := range codexSkills {
		fmt.Fprintf(output, "    %-28s %6d  %s\n", skill.Name, skill.DescriptionChars, skill.Path)
	}
	if len(value.Diagnostics) == 0 {
		return
	}
	fmt.Fprintln(output, "\nDIAGNOSTICS")
	for _, item := range value.Diagnostics {
		fmt.Fprintf(output, "  %s %s %s: %s\n", strings.ToUpper(item.Severity), item.Code, item.Path, item.Message)
		fmt.Fprintf(output, "    Fix: %s\n", item.Suggestion)
	}
}

func defaultRoot() string {
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		return "."
	}
	return filepath.Clean(filepath.Join(filepath.Dir(sourceFile), "../../../.."))
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}
