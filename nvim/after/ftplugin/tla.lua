-- :TLC [cfg] model-checks the current spec with the TLA+ tools the project pins in
-- .mise.toml ("http:tla2tools"), using <spec>.cfg beside it unless a cfg is given.
vim.api.nvim_buf_create_user_command(0, "TLC", function(opts)
  local spec = vim.api.nvim_buf_get_name(0)
  local dir = vim.fs.dirname(spec)
  local cfg = opts.args ~= "" and vim.fn.fnamemodify(opts.args, ":p") or spec:gsub("%.tla$", ".cfg")
  local where = vim.system({ "mise", "where", "http:tla2tools" }, { cwd = dir, text = true }):wait()
  if where.code ~= 0 then
    vim.notify("TLC: pin http:tla2tools in the project's .mise.toml and run `mise install`", vim.log.levels.ERROR)
    return
  end
  local jar = vim.trim(where.stdout) .. "/tla2tools.jar"
  local meta = vim.fn.tempname()
  vim.cmd("botright new | resize 15")
  vim.fn.jobstart({
    "mise",
    "exec",
    "--",
    "java",
    "-XX:+UseParallelGC",
    "-cp",
    jar,
    "tlc2.TLC",
    "-workers",
    "auto",
    "-metadir",
    meta,
    "-config",
    cfg,
    spec,
  }, {
    cwd = dir,
    term = true,
    on_exit = function()
      vim.fn.delete(meta, "rf")
    end,
  })
end, { nargs = "?", complete = "file", desc = "Model-check this spec with TLC" })
