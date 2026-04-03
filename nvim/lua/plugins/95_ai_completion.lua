local ok, ai_config = pcall(require, "private.ai_config")

return {
  {
    "milanglacier/minuet-ai.nvim",
    event = "VeryLazy",
    dependencies = { "nvim-lua/plenary.nvim" },
    config = function()
      if not ok then
        vim.notify("minuet-ai: lua/private/ai_config.lua not found", vim.log.levels.WARN)
        return
      end

      require("minuet").setup({
        provider = "openai_fim_compatible",
        notify = "warn",
        n_completions = 1,
        throttle = 300,
        debounce = 150,
        context_window = 32000,
        request_timeout = 5,
        provider_options = {
          openai_fim_compatible = {
            api_key = function()
              return ai_config.api_key
            end,
            end_point = ai_config.base_url .. "/completions",
            model = ai_config.model,
            name = ai_config.name or "CustomAI",
            stream = true,
            template = {
              prompt = function(before, after, _)
                local utils = require("minuet.utils")
                local language = utils.add_language_comment()
                local tab = utils.add_tab_comment()
                local cs = vim.bo.commentstring
                local english = cs:find("%%s") and cs:gsub("%%s", "All comments in English")
                  or (cs .. " All comments in English")
                local filename = vim.fn.expand("%:t")
                local hints = (
                  filename ~= ""
                    and (cs:find("%%s") and cs:gsub("%%s", "File: " .. filename) or (cs .. " File: " .. filename)) .. "\n"
                  or ""
                )
                  .. (language ~= "" and language .. "\n" or "")
                  .. (tab ~= "" and tab .. "\n" or "")
                  .. english
                  .. "\n"
                -- Strip pipe chars from <|...|> patterns in code context so tokenizer
                -- doesn't treat them as special tokens (e.g. <|fim_prefix|> → <fim_prefix>)
                local sanitize = function(s)
                  return s:gsub("<|(.-)|>", "<%1>")
                end
                return "<|fim_prefix|>"
                  .. hints
                  .. sanitize(before)
                  .. "<|fim_suffix|>"
                  .. sanitize(after)
                  .. "<|fim_middle|>"
              end,
              suffix = false,
            },
            optional = {
              max_tokens = 512,
              temperature = 0,
              stop = {
                "<|endoftext|>",
                "<|im_start|>",
                "<|im_end|>",
                "<|fim_prefix|>",
                "<|fim_suffix|>",
                "<|fim_middle|>",
                "<|repo_name|>",
                "<|file_sep|>",
                "<think>",
                "</think>",
              },
            },
          },
        },
        virtualtext = {
          auto_trigger_ft = { "*" },
          show_on_completion_menu = true,
          keymap = {
            accept = "<M-l>",
            accept_line = "<M-j>",
            prev = "<M-p>",
            next = "<M-n>",
            dismiss = "<M-e>",
          },
        },
      })

      -- At VeryLazy, FileType events have already fired; force-enable for the
      -- current buffer and all future buffers via BufEnter autocmd.
      vim.b.minuet_virtual_text_auto_trigger = vim.bo.buftype == ""
      vim.api.nvim_create_autocmd("BufEnter", {
        group = vim.api.nvim_create_augroup("minuet_buf_trigger", { clear = true }),
        callback = function()
          vim.schedule(function()
            vim.b.minuet_virtual_text_auto_trigger = vim.bo.buftype == ""
          end)
        end,
      })
    end,
  },
}
