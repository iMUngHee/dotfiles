import AppKit
import UserNotifications

class NotifierDelegate: NSObject, UNUserNotificationCenterDelegate {

    private lazy var tmuxPath: String = {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/which")
        p.arguments = ["tmux"]
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = FileHandle.nullDevice
        try? p.run()
        p.waitUntilExit()
        let out = String(
            data: pipe.fileHandleForReading.readDataToEndOfFile(),
            encoding: .utf8
        )?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return out.isEmpty ? "/opt/homebrew/bin/tmux" : out
    }()

    func start() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
        DispatchQueue.global(qos: .background).async {
            self.startSocketServer()
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let tag = response.notification.request.content.userInfo["tag"] as? String ?? ""
        focusTerminal(tag: tag)
        completionHandler()
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    private func focusTerminal(tag: String) {
        run("/usr/bin/osascript", ["-e", "tell application \"Ghostty\" to activate"])
        let target = tag.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        guard !target.isEmpty else { return }
        run(tmuxPath, ["select-window", "-t", target])
        run(tmuxPath, ["select-pane", "-t", target])
    }

    private func isTerminalFrontmost() -> Bool {
        guard let frontmost = NSWorkspace.shared.frontmostApplication else { return false }
        let names = [
            "Terminal", "iTerm2", "Warp", "kitty", "Alacritty",
            "Hyper", "Ghostty", "ghostty", "WezTerm"
        ]
        let bundleIds = [
            "com.apple.Terminal",
            "com.googlecode.iterm2",
            "dev.warp.Warp-Stable",
            "net.kovidgoyal.kitty",
            "org.alacritty",
            "co.zeit.hyper",
            "com.mitchellh.ghostty",
            "com.github.wez.wezterm"
        ]
        return names.contains(frontmost.localizedName ?? "")
            || bundleIds.contains(frontmost.bundleIdentifier ?? "")
    }

    private func normalizeTmuxTarget(_ target: String) -> String {
        let clean = target.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        guard !clean.isEmpty else { return "" }
        let out = capture(tmuxPath, ["display-message", "-p", "-t", clean, "#S:#I.#P"])
        return out.isEmpty ? clean : out
    }

    private func isWatchingCurrentPane(target: String) -> Bool {
        let normalized = normalizeTmuxTarget(target)
        guard !normalized.isEmpty else { return false }
        let out = capture(tmuxPath, ["list-panes", "-s", "-F", "#{window_active}#{pane_active} #S:#I.#P"])
        for line in out.split(separator: "\n") {
            if line.hasPrefix("11 ") {
                return String(line.dropFirst(3)) == normalized
            }
        }
        return false
    }

    private func displayTmuxMessage(target: String, message: String) {
        let normalized = normalizeTmuxTarget(target)
        let clean = (normalized.isEmpty ? target : normalized)
            .trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        guard !clean.isEmpty else { return }
        let session = clean.split(separator: ":", maxSplits: 1).first.map(String.init) ?? clean
        run(tmuxPath, ["display-message", "-d", "4000", "-t", session, message])
    }

    @discardableResult
    private func run(_ path: String, _ args: [String]) -> Int32 {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: path)
        p.arguments = args
        try? p.run()
        p.waitUntilExit()
        return p.terminationStatus
    }

    private func capture(_ path: String, _ args: [String]) -> String {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: path)
        p.arguments = args
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = FileHandle.nullDevice
        do {
            try p.run()
            p.waitUntilExit()
        } catch {
            return ""
        }
        return String(
            data: pipe.fileHandleForReading.readDataToEndOfFile(),
            encoding: .utf8
        )?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    private func startSocketServer() {
        let socketPath = ProcessInfo.processInfo.environment["AGENT_NOTIFIER_SOCKET"] ?? "/tmp/agent-notifier.sock"
        try? FileManager.default.removeItem(atPath: socketPath)

        let serverFD = socket(AF_UNIX, SOCK_STREAM, 0)
        guard serverFD >= 0 else { return }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
            socketPath.withCString { src in
                _ = strncpy(
                    UnsafeMutableRawPointer(ptr).assumingMemoryBound(to: CChar.self),
                    src,
                    104
                )
            }
        }

        let bound = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(serverFD, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard bound == 0 else { close(serverFD); return }
        guard listen(serverFD, 5) == 0 else { close(serverFD); return }

        while true {
            let clientFD = accept(serverFD, nil, nil)
            guard clientFD >= 0 else { continue }
            DispatchQueue.global().async { self.handleClient(clientFD) }
        }
    }

    private func handleClient(_ fd: Int32) {
        defer { close(fd) }
        var buf = [UInt8](repeating: 0, count: 4096)
        let n = read(fd, &buf, buf.count - 1)
        guard n > 0 else { return }

        let data = Data(buf[..<n])
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: String] else { return }

        let title = json["title"] ?? "Agent"
        let body = json["body"] ?? ""
        let sound = json["sound"] ?? "Glass"
        let tag = json["tag"] ?? ""
        let delivery = json["delivery"] ?? ""
        let tmuxMessage = json["tmuxMessage"] ?? "\(title) - \(body)"

        DispatchQueue.main.async {
            if delivery == "focus-aware", !tag.isEmpty, self.isTerminalFrontmost() {
                if !self.isWatchingCurrentPane(target: tag) {
                    self.displayTmuxMessage(target: tag, message: tmuxMessage)
                }
                return
            }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = UNNotificationSound(named: UNNotificationSoundName(rawValue: sound))
            content.userInfo = ["tag": tag]
            let req = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
            UNUserNotificationCenter.current().add(req, withCompletionHandler: nil)
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let delegate = NotifierDelegate()
delegate.start()
app.run()
