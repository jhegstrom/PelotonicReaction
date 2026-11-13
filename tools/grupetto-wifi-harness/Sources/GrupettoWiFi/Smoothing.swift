import Foundation

// Time-weighted rolling mean: packet bursts do not receive extra weight.
// Missing telemetry is excluded rather than held indefinitely or replaced with zero.
struct DisplaySmoother {
    static let maximumWindow: Double = 300
    static let freshness: Double = 5
    static let smoothedFields: Set<String> = ["Power"]
    struct Sample { let time: Double; let value: Double }
    private var samples: [String: [Sample]] = [:]

    mutating func add(_ values: [String: Reading], at time: Double) {
        for (name, reading) in values where Self.smoothedFields.contains(name) {
            var history = samples[name] ?? []
            if let last = history.last, time - last.time > Self.freshness || time < last.time { history = [] }
            if history.last?.time == time { history.removeLast() }
            history.append(Sample(time: time, value: reading.value))
            let cutoff = time - Self.maximumWindow
            // Keep the predecessor to interpolate the left edge of the window.
            if let first = history.firstIndex(where: { $0.time >= cutoff }), first > 1 {
                history.removeFirst(first - 1)
            }
            samples[name] = history
        }
    }
    func display(_ raw: Reading, name: String, window: Double, at time: Double) -> Reading {
        guard window > 0, let history = samples[name], let last = history.last,
              time >= last.time, time - last.time < Self.freshness else { return raw }
        let start = time - min(window, Self.maximumWindow)
        var integral = 0.0
        var duration = 0.0
        for (index, sample) in history.enumerated() {
            let next = index + 1 < history.count ? history[index + 1].time : time
            let left = max(start, sample.time)
            let right = min(time, next, sample.time + Self.freshness)
            if right > left {
                integral += sample.value * (right - left)
                duration += right - left
            }
        }
        return Reading(value: duration > 0 ? integral / duration : last.value, unit: raw.unit)
    }
}
