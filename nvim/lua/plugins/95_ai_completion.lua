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
        throttle = 1000,
        debounce = 400,
        provider_options = {
          openai_fim_compatible = {
            api_key = function()
              return ai_config.api_key
            end,
            -- Appends /completions to base_url (see lua/private/README.md for schema)
            end_point = ai_config.base_url .. "/completions",
            model = ai_config.model,
            name = ai_config.name or "CustomAI",
            stream = true,
            -- Build FIM tokens manually (suffix field not supported by this endpoint).
            -- Prepend language/indent hints to improve completion quality.
            template = {
              prompt = function(before, after, _)
                local utils = require("minuet.utils")
                local language = utils.add_language_comment()
                local tab = utils.add_tab_comment()
                local hints = (language ~= "" and language .. "\n" or "") .. (tab ~= "" and tab .. "\n" or "")
                return "<|fim_prefix|>" .. hints .. before .. "<|fim_suffix|>" .. after .. "<|fim_middle|>"
              end,
              suffix = false,
            },
            optional = {
              max_tokens = 512,
              temperature = 0.4,
              top_p = 0.8,
              top_k = 20,
              repetition_penalty = 1.05,
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
      vim.b.minuet_virtual_text_auto_trigger = true
      vim.api.nvim_create_autocmd("BufEnter", {
        group = vim.api.nvim_create_augroup("minuet_buf_trigger", { clear = true }),
        callback = function()
          vim.b.minuet_virtual_text_auto_trigger = true
        end,
      })
    end,
  },
}
