; Dockerfile shell injection — highlights RUN/COPY heredoc blocks as bash.
; Upstream fix pending: nvim-treesitter#6574, tree-sitter-dockerfile#52

((comment) @injection.content
  (#set! injection.language "comment"))

((shell_command) @injection.content
  (#set! injection.language "bash")
  (#set! injection.include-children))

((run_instruction
  (heredoc_block) @injection.content)
  (#set! injection.language "bash")
  (#set! injection.include-children))
