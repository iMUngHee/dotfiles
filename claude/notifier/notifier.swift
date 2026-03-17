import Foundation
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

    // MARK: - UNUserNotificationCenterDelegate

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let tag = response.notification.request.content.userInfo["tag"] as? String ?? ""
        focusGhostty(tag: tag)
        completionHandler()
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    // MARK: - Focus

    private func focusGhostty(tag: String) {
        run("/usr/bin/osascript", ["-e", "tell application \"Ghostty\" to activate"])
        let target = tag.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        guard !target.isEmpty else { return }
        // switch-client is ineffective in daemon context (no attached client)
        // select-window / select-pane talk directly to the tmux server, so they work from daemons
        run(tmuxPath, ["select-window", "-t", target])
        run(tmuxPath, ["select-pane",   "-t", target])
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

    // MARK: - Unix Domain Socket Server

    private func startSocketServer() {
        let socketPath = "/tmp/claude-notifier.sock"
        try? FileManager.default.removeItem(atPath: socketPath)

        let serverFD = socket(AF_UNIX, SOCK_STREAM, 0)
        guard serverFD >= 0 else { return }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
            socketPath.withCString { src in
                _ = strncpy(
                    UnsafeMutableRawPointer(ptr).assumingMemoryBound(to: CChar.self),
                    src, 104
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

        let title = json["title"] ?? "Claude Code"
        let body  = json["body"]  ?? ""
        let sound = json["sound"] ?? "Glass"
        let tag   = json["tag"]   ?? ""

        DispatchQueue.main.async {
            let content = UNMutableNotificationContent()
            content.title = title
            content.body  = body
            content.sound = UNNotificationSound(named: UNNotificationSoundName(rawValue: sound))
            content.userInfo = ["tag": tag]
            let req = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
            UNUserNotificationCenter.current().add(req, withCompletionHandler: nil)
        }
    }
}

let delegate = NotifierDelegate()
delegate.start()
RunLoop.main.run()
