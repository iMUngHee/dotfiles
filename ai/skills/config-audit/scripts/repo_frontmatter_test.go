package main

import (
	"errors"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

// Every Markdown file under ai/, claude/ and codex/ that opens with a
// frontmatter block must parse as a YAML mapping. Memory, rule and agent files
// are read by nothing else here, so an unquoted ": " in a description (a new
// mapping to strict parsers such as GitHub's renderer) once went unnoticed in
// four memory files. Both Stop gates run this module when such a file changes,
// tracked or not yet added, so new files are listed alongside tracked ones.
func TestRepoFrontmatterParses(t *testing.T) {
	// git resolves the physical working directory, so this also holds when the
	// module is run through the deployed ~/.claude/skills symlink.
	top, err := exec.Command("git", "rev-parse", "--show-toplevel").Output()
	if err != nil {
		t.Skipf("not inside a git work tree: %v", err)
	}
	root := strings.TrimSpace(string(top))
	out, err := exec.Command("git", "-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard",
		"--", "ai/*.md", "claude/*.md", "codex/*.md").Output()
	if err != nil {
		t.Fatalf("git ls-files in %s: %v", root, err)
	}

	checked := 0
	for _, relativePath := range strings.Split(strings.TrimRight(string(out), "\x00"), "\x00") {
		if relativePath == "" {
			continue
		}
		content, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(relativePath)))
		if errors.Is(err, fs.ErrNotExist) {
			continue // deleted in the working tree, not yet staged
		}
		if err != nil {
			t.Errorf("%s: %v", relativePath, err)
			continue
		}
		yamlText, found, err := leadingFrontmatter(string(content))
		if !found {
			continue
		}
		checked++
		if err != nil {
			t.Errorf("%s: %v", relativePath, err)
			continue
		}
		var node yaml.Node
		if err := yaml.Unmarshal([]byte(yamlText), &node); err != nil {
			t.Errorf("%s: frontmatter YAML cannot be parsed: %s (quote a value that contains \": \" or \" #\")", relativePath, firstLine(err.Error()))
			continue
		}
		if len(node.Content) > 0 && node.Content[0].Kind != yaml.MappingNode {
			t.Errorf("%s: frontmatter root must be a mapping", relativePath)
		}
	}
	if checked == 0 {
		t.Fatalf("found no frontmatter under %s; the repo root is probably wrong", root)
	}
}

// leadingFrontmatter returns the text between a first-line "---" and the next
// "---" line. found is false when the file does not open with one; an opened
// block that never closes is found and reported, as parseFrontmatter does.
func leadingFrontmatter(content string) (yamlText string, found bool, err error) {
	lines := strings.Split(strings.TrimPrefix(content, "\ufeff"), "\n")
	if strings.TrimSpace(lines[0]) != "---" {
		return "", false, nil
	}
	for index := 1; index < len(lines); index++ {
		if strings.TrimSpace(lines[index]) == "---" {
			return strings.Join(lines[1:index], "\n"), true, nil
		}
	}
	return "", true, errors.New("frontmatter has no closing --- line")
}

func TestLeadingFrontmatter(t *testing.T) {
	cases := []struct {
		name, content, want string
		found, failed       bool
	}{
		{"closed", "---\nname: a\n---\nbody", "name: a", true, false},
		{"crlf", "---\r\nname: a\r\n---\r\nbody", "name: a\r", true, false},
		{"bom", "\ufeff---\nname: a\n---\n", "name: a", true, false},
		{"no opening", "# title\n---\n", "", false, false},
		{"never closed", "---\nname: a\n", "", true, true},
	}
	for _, c := range cases {
		got, found, err := leadingFrontmatter(c.content)
		if got != c.want || found != c.found || (err != nil) != c.failed {
			t.Errorf("%s: got (%q, %v, %v), want (%q, %v, failed=%v)", c.name, got, found, err, c.want, c.found, c.failed)
		}
	}
}
