return {
  -- Harpoon: pin a handful of files, jump by muscle memory (<leader>j group)
  {
    "ThePrimeagen/harpoon",
    branch = "harpoon2",
    dependencies = { "nvim-lua/plenary.nvim" },
    keys = {
      {
        "<leader>ja",
        function()
          require("harpoon"):list():add()
        end,
        desc = "Harpoon add file",
      },
      {
        "<leader>jh",
        function()
          local harpoon = require("harpoon")
          harpoon.ui:toggle_quick_menu(harpoon:list())
        end,
        desc = "Harpoon quick menu",
      },
      {
        "<leader>j1",
        function()
          require("harpoon"):list():select(1)
        end,
        desc = "Harpoon to file 1",
      },
      {
        "<leader>j2",
        function()
          require("harpoon"):list():select(2)
        end,
        desc = "Harpoon to file 2",
      },
      {
        "<leader>j3",
        function()
          require("harpoon"):list():select(3)
        end,
        desc = "Harpoon to file 3",
      },
      {
        "<leader>j4",
        function()
          require("harpoon"):list():select(4)
        end,
        desc = "Harpoon to file 4",
      },
    },
    config = function()
      require("harpoon"):setup()
    end,
  },

  -- Flash: jump anywhere on screen with 2-char labels (s overrides substitute)
  {
    "folke/flash.nvim",
    event = "VeryLazy",
    opts = {},
    keys = {
      {
        "s",
        mode = { "n", "x", "o" },
        function()
          require("flash").jump()
        end,
        desc = "Flash",
      },
      {
        "S",
        mode = { "n", "x", "o" },
        function()
          require("flash").treesitter()
        end,
        desc = "Flash Treesitter",
      },
      {
        "r",
        mode = "o",
        function()
          require("flash").remote()
        end,
        desc = "Remote Flash",
      },
      {
        "R",
        mode = { "o", "x" },
        function()
          require("flash").treesitter_search()
        end,
        desc = "Treesitter Search",
      },
      {
        "<c-s>",
        mode = { "c" },
        function()
          require("flash").toggle()
        end,
        desc = "Toggle Flash Search",
      },
    },
  },

  -- vim-tmux-navigator: seamless C-hjkl across nvim splits and tmux panes
  {
    "christoomey/vim-tmux-navigator",
    cmd = {
      "TmuxNavigateLeft",
      "TmuxNavigateDown",
      "TmuxNavigateUp",
      "TmuxNavigateRight",
      "TmuxNavigatePrevious",
      "TmuxNavigatorProcessList",
    },
    keys = {
      { "<M-h>", "<cmd>TmuxNavigateLeft<cr>", desc = "Navigate left (tmux/nvim)" },
      { "<M-j>", "<cmd>TmuxNavigateDown<cr>", desc = "Navigate down (tmux/nvim)" },
      { "<M-k>", "<cmd>TmuxNavigateUp<cr>", desc = "Navigate up (tmux/nvim)" },
      { "<M-l>", "<cmd>TmuxNavigateRight<cr>", desc = "Navigate right (tmux/nvim)" },
      { "<c-\\>", "<cmd>TmuxNavigatePrevious<cr>", desc = "Navigate previous (tmux/nvim)" },
    },
  },
}
