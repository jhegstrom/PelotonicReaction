import XCTest
@testable import GrupettoWiFi
final class SmoothingTests: XCTestCase {
    private func power(_ value: Double) -> [String: Reading] { ["Power": Reading(value: value, unit: "W")] }
    private let raw = Reading(value: 300, unit: "W")
    func testTimeWeightedAverageAndPacketBursts() {
        var s = DisplaySmoother()
        for t in stride(from: 0.0, through: 9, by: 1) { s.add(power(100), at: t) }
        for t in stride(from: 10.0, through: 19, by: 0.1) { s.add(power(300), at: t) }
        XCTAssertEqual(s.display(raw, name: "Power", window: 30, at: 20).value, 200, accuracy: 0.001)
        XCTAssertEqual(s.display(raw, name: "Power", window: 5, at: 20).value, 300, accuracy: 0.001)
    }
    func testStartupAndDisabledSmoothing() {
        var s = DisplaySmoother()
        s.add(power(100), at: 0)
        XCTAssertEqual(s.display(raw, name: "Power", window: 30, at: 0).value, 100)
        XCTAssertEqual(s.display(raw, name: "Power", window: 30, at: 1).value, 100)
        XCTAssertEqual(s.display(raw, name: "Power", window: 0, at: 1).value, 300)
    }
    func testGapStartsFreshAndStaleDataIsNotInvented() {
        var s = DisplaySmoother()
        s.add(power(100), at: 0)
        XCTAssertEqual(s.display(raw, name: "Power", window: 30, at: 10).value, 300)
        s.add(power(300), at: 20)
        XCTAssertEqual(s.display(raw, name: "Power", window: 30, at: 21).value, 300)
    }
    func testTotalsAndUnitsRemainUnchanged() {
        var s = DisplaySmoother()
        s.add(["Distance": Reading(value: 1, unit: "km")], at: 0)
        let total = Reading(value: 2, unit: "km")
        XCTAssertEqual(s.display(total, name: "Distance", window: 30, at: 1).value, 2)
        s.add(["Speed": Reading(value: 100, unit: "km/h")], at: 0)
        let speed = s.display(Reading(value: 100, unit: "km/h"), name: "Speed", window: 30, at: 1)
        XCTAssertEqual(SpeedUnit.milesPerHour.display(speed).value, 62.1371192, accuracy: 0.000001)
    }
    func testOnlyPowerIsSmoothedAndRawReadingsArePreserved() {
        var s = DisplaySmoother()
        let names = ["Power", "Cadence", "Speed", "Heart rate", "Resistance"]
        let before = Dictionary(uniqueKeysWithValues: names.map { ($0, Reading(value: 100, unit: "test")) })
        let current = Dictionary(uniqueKeysWithValues: names.map { ($0, Reading(value: 200, unit: "test")) })
        s.add(before, at: 0)
        s.add(current, at: 2)
        XCTAssertEqual(s.display(current["Power"]!, name: "Power", window: 3, at: 3).value, 400.0 / 3, accuracy: 0.001)
        for name in names where name != "Power" {
            XCTAssertEqual(s.display(current[name]!, name: name, window: 3, at: 3).value, 200)
        }
        XCTAssertEqual(current["Power"]?.value, 200, "Display averaging must never mutate raw metrics")
    }
    func testWindowUsesPredecessorAndHistoryRemainsUsable() {
        var s = DisplaySmoother()
        for t in 0...400 { s.add(power(t < 390 ? 100 : 300), at: Double(t)) }
        XCTAssertEqual(s.display(raw, name: "Power", window: 30, at: 400).value, 500.0 / 3, accuracy: 0.001)
        XCTAssertEqual(s.display(raw, name: "Power", window: 10.5, at: 400).value, 3050.0 / 10.5, accuracy: 0.001)
    }
}
