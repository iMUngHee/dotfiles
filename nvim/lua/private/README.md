# private/

This directory is git-ignored. Create the following files locally.

## ai_config.lua

Used by `plugins/95_ai_completion.lua` (minuet-ai.nvim).

```lua
return {
  api_key  = "your-api-key",
  base_url = "https://your-api-endpoint.example.com",  -- without trailing slash
  model    = "model-name",
  name     = "ProviderName",                            -- display name for the provider
}
```

The `base_url` is joined with `/completions` to form the full endpoint.
