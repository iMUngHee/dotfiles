# windows/notifier/toast.ps1 - Windows toast sender for the shared AI notifier.
#
# notifier/ ships a Swift app for macOS and a Go daemon for Linux. Windows needs
# neither: the OS already has a notification service, so this is just a sender.
#
# claude/hooks/notify.sh and codex/hooks/notify.sh call
#   "$AGENT_NOTIFIER_SEND" <title> <message> <sound> <tag>
# and skip silently when that path is not executable. deploy-notifier.ps1 puts a
# shim at ~/.agent-notifier/bin/agent-notifier-send that lands here - so the
# shared hooks stay untouched and platform-agnostic.
#
# Run under Windows PowerShell 5.1 on purpose. PowerShell 7 dropped the built-in
# WinRT projection these types need; powershell.exe is present on every Windows
# install, so the shim pins it rather than probing.

param(
    [string]$Title   = 'Claude Code',
    [string]$Message = '',
    [string]$Sound   = 'Glass',      # accepted for signature parity with macOS
    [string]$Tag     = ''
)

$ErrorActionPreference = 'Stop'

try {
    [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
    [void][Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]
    [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]
} catch {
    # No WinRT (Server Core, or a stripped image). Silence beats a hook failure.
    exit 0
}

if ($Tag) { $Title = "$Title $Tag" }
if (-not $Message) { $Message = ' ' }

# Toasts must be raised by a registered AppUserModelID. Windows PowerShell's own
# Start Menu AUMID is registered on every desktop install, which is why it is the
# conventional choice for a script that has no app package of its own.
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'

# The macOS notifier maps "Basso" to an alert and everything else to a soft
# chime; Windows exposes the same split as Reminder vs Default.
if ($Sound -eq 'Basso') {
    $audioSrc = 'ms-winsoundevent:Notification.Looping.Alarm2'
} else {
    $audioSrc = 'ms-winsoundevent:Notification.Default'
}

function ConvertTo-XmlText {
    param([string]$Value)
    return [System.Security.SecurityElement]::Escape($Value)
}

$xml = @"
<toast activationType="foreground">
  <visual>
    <binding template="ToastGeneric">
      <text>$(ConvertTo-XmlText $Title)</text>
      <text>$(ConvertTo-XmlText $Message)</text>
    </binding>
  </visual>
  <audio src="$audioSrc" loop="false"/>
</toast>
"@

try {
    $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
    $doc.LoadXml($xml)
    $toast = New-Object Windows.UI.Notifications.ToastNotification $doc
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
} catch {
    # A hook must never fail the turn it is attached to.
    exit 0
}

exit 0
