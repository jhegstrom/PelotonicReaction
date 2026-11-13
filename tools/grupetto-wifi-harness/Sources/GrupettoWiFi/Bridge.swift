import Foundation

// NDJSON over stdio keeps the native network client independent of the web server.
// stdout contains machine-readable snapshots only. The same Monitor powers both UIs.
enum TelemetryBridge {
    static func snapshot(_ monitor: Monitor, averagingSeconds: Int, epoch: String) -> [String: Any] {
        var readings: [String: Any] = [:]
        for (name, reading) in monitor.metrics {
            readings[name] = ["value": reading.value, "unit": reading.unit,
                              "at": (monitor.updated[name]?.timeIntervalSince1970 ?? 0) * 1000]
        }
        var value: [String: Any] = ["status": monitor.status, "connected": monitor.active,
            "epoch": epoch, "noBike": monitor.showConnectionDialog, "metrics": readings,
            "powerAverage": NSNull(), "averagingSeconds": averagingSeconds,
            "notificationCount": monitor.packets]
        if let average = monitor.displayReading("Power", averagingSeconds: averagingSeconds) { value["powerAverage"] = average.value }
        return value
    }
    static func run() {
        let monitor = Monitor()
        var commandBuffer = Data()
        var averagingSeconds = 3
        var wasActive = false
        var epoch = UUID().uuidString
        func emit() {
            if !monitor.active && wasActive { epoch = UUID().uuidString }
            wasActive = monitor.active
            let value = snapshot(monitor, averagingSeconds: averagingSeconds, epoch: epoch)
            if let data = try? JSONSerialization.data(withJSONObject: value) {
                FileHandle.standardOutput.write(data + Data([10]))
            }
        }
        FileHandle.standardInput.readabilityHandler = { handle in
            let data = handle.availableData
            DispatchQueue.main.async {
                if data.isEmpty { monitor.disconnect(); exit(0) }
                commandBuffer.append(data)
                while let end = commandBuffer.firstIndex(of: 10) {
                    let line = commandBuffer.prefix(upTo: end)
                    commandBuffer.removeSubrange(...end)
                    guard let object = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
                          let action = object["action"] as? String else { continue }
                    switch action {
                    case "start": monitor.start()
                    case "stop": monitor.disconnect()
                    case "address":
                        if let host = object["host"] as? String, let port = object["port"] as? String {
                            monitor.connect(host: host, port: port)
                        }
                    case "average":
                        if let seconds = object["seconds"] as? Int { averagingSeconds = max(0, min(300, seconds)) }
                    default: break
                    }
                    emit()
                }
            }
        }
        _ = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { _ in emit() }
        emit()
        RunLoop.main.run()
    }
}
