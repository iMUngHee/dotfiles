-- Keep only your personal keybinding overrides here. Add new bindings or
-- unbind defaults before replacing them.

-- See current bindings and descriptions:
--   omarchy menu keybindings --print

-- To disable every Omarchy default binding, set this in
-- ~/.config/hypr/hyprland.lua before require("default.hypr.omarchy"), then add
-- only the bindings you want below:
--   omarchy_default_bindings = false

-- To disable all preinstalled app/webapp bindings, set:
--   omarchy_preinstalled_bindings = false

-- Add a new binding.
-- o.bind("SUPER + SHIFT + R", "SSH", "alacritty -e ssh your-server")

-- Change an existing binding by unbinding it first, then binding the key again.
-- This example changes SUPER+SPACE from the launcher to the Omarchy root menu.
-- hl.unbind("SUPER + SPACE")
-- o.bind("SUPER + SPACE", "Omarchy menu", "omarchy-menu toggle root")

-- Disable a default binding without replacing it.
-- hl.unbind("SUPER + SHIFT + B")

-- Logitech MX Keys examples:
-- o.bind("SUPER + SHIFT + S", nil, "omarchy-capture-screenshot")
-- o.bind("SUPER + H", nil, "voxtype record toggle")
-- o.bind("SUPER + PERIOD", nil, "omarchy-shell shell toggle omarchy.emojis")

-- ── Capture keys: PRINT → SUPER + SHIFT + <letter> ──────────────────────────
-- This keyboard (Wobkey Rainy75 RT, a 75% board) has no dedicated Print key,
-- and Omarchy puts four bindings on it — screenshot, screen recording, colour
-- picker and OCR. Reaching them through a firmware Fn layer is not worth it, so
-- they move to letters: S/R/C/T for screenshot, record, colour, text.
--
-- S and C were Google Maps and Calendar webapps. Both were removed from this
-- machine, but the bindings survive them: default/hypr/bindings/applications.lua
-- opens a URL rather than launching an installed app, so nothing checks whether
-- the app is still there. Unbinding them costs nothing here.
--
-- Each PRINT binding is released first. hl.unbind is required before rebinding
-- a key Omarchy already took, and the defaults load before this file.
hl.unbind("PRINT")
hl.unbind("ALT + PRINT")
hl.unbind("SUPER + PRINT")
hl.unbind("SUPER + CTRL + PRINT")
hl.unbind("SUPER + SHIFT + S")
hl.unbind("SUPER + SHIFT + C")

o.bind("SUPER + SHIFT + S", "Screenshot", "omarchy-capture-screenshot")
o.bind("SUPER + SHIFT + R", "Screenrecording", "omarchy-capture-screenrecording --stop-recording || omarchy-menu toggle trigger.capture.screenrecord")
o.bind("SUPER + SHIFT + C", "Color picker", "pkill hyprpicker || hyprpicker -a")
o.bind("SUPER + SHIFT + T", "Extract text (OCR) from screenshot", "omarchy-capture-text")

-- ── Webapp bindings: all off ────────────────────────────────────────────────
-- default/hypr/bindings/applications.lua binds twelve keys to webapps. They do
-- not launch an installed app — helpers.lua turns { webapp = url } into
-- `omarchy-launch-webapp <url>`, so nothing consults the desktop entry and
-- removing the app leaves the key opening a browser exactly as before. That
-- surprise is the reason these go rather than the apps.
--
-- Not done with omarchy_preinstalled_bindings = false: that flag also drops the
-- real application bindings in the same block — terminal, browser, Obsidian,
-- 1Password — which are wanted.
--
-- SUPER+SHIFT+S and +C were Google Maps and Calendar; they are unbound above
-- and rebound to screenshot and colour picker, so they are not repeated here.
hl.unbind("SUPER + SHIFT + A")          -- ChatGPT
hl.unbind("SUPER + SHIFT + ALT + A")    -- Grok
hl.unbind("SUPER + SHIFT + E")          -- Email
hl.unbind("SUPER + SHIFT + ALT + E")    -- New email
hl.unbind("SUPER + SHIFT + Y")          -- YouTube
hl.unbind("SUPER + SHIFT + ALT + G")    -- WhatsApp
hl.unbind("SUPER + SHIFT + CTRL + G")   -- Google Messages
hl.unbind("SUPER + SHIFT + P")          -- Google Photos
hl.unbind("SUPER + SHIFT + X")          -- X
hl.unbind("SUPER + SHIFT + ALT + X")    -- X Post
