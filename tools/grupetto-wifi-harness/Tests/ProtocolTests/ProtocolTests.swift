import XCTest
@testable import GrupettoWiFi
final class ProtocolTests: XCTestCase {
    func testFragmentedAndCombinedFrames() throws {
        let a = Frame(type: 1, sequence: 3, status: 0, payload: bluetoothUUID(0x1826))
        let b = Frame(type: 5, sequence: 4, status: 0, payload: bluetoothUUID(0x2ad2))
        var parser = DirConFramer()
        XCTAssertTrue(try parser.append(Array(a.bytes.prefix(5))).isEmpty)
        let frames = try parser.append(Array(a.bytes.dropFirst(5)) + b.bytes)
        XCTAssertEqual(frames.count, 2)
        XCTAssertEqual(frames[0].payload, bluetoothUUID(0x1826))
        XCTAssertEqual(frames[1].sequence, 4)
        XCTAssertTrue(parser.buffer.isEmpty)
    }
    func testFTMSFieldsAndScaling() throws {
        // speed, cadence, distance, resistance, power, HR, elapsed
        let bytes: [UInt8] = [0x74, 0x0a, 0xc4, 0x09, 180, 0, 0x39, 0x30, 0, 42, 0, 200, 0, 145, 60, 0]
        let m = try decodeMetrics(characteristic: bluetoothUUID(0x2ad2), bytes: bytes)
        XCTAssertEqual(m["Power"]?.value, 200)
        XCTAssertEqual(m["Cadence"]?.value, 90)
        XCTAssertEqual(m["Resistance"]?.value, 42)
        XCTAssertEqual(m["Speed"]?.value, 25)
        XCTAssertEqual(m["Distance"]?.value, 12.345)
        XCTAssertEqual(m["Heart rate"]?.value, 145)
        XCTAssertEqual(m["Bike elapsed"]?.value, 60)
    }
    func testTruncationAndAbsentFields() throws {
        XCTAssertThrowsError(try decodeMetrics(characteristic: bluetoothUUID(0x2ad2), bytes: [0x40, 0, 0]))
        let m = try decodeMetrics(characteristic: bluetoothUUID(0x2ad2), bytes: [1, 0])
        XCTAssertTrue(m.isEmpty)
        var parser = DirConFramer()
        XCTAssertThrowsError(try parser.append([2, 1, 0, 0, 0, 0]))
    }
    func testOptionalTotalsAbsentFromBasicBikePacket() throws {
        let m = try decodeMetrics(characteristic: bluetoothUUID(0x2ad2), bytes: [0x64, 0, 0xc4, 0x09, 180, 0, 40, 0, 200, 0])
        XCTAssertEqual(Set(m.keys), Set(["Speed", "Cadence", "Resistance", "Power"]))
        XCTAssertNil(m["Distance"])
        XCTAssertNil(m["Energy"])
        XCTAssertNil(m["Bike elapsed"])
    }
    func testEnergyDoesNotShiftHeartRateOrElapsed() throws {
        let m = try decodeMetrics(characteristic: bluetoothUUID(0x2ad2), bytes: [1, 0x0b, 100, 0, 200, 0, 3, 145, 60, 0])
        XCTAssertEqual(m["Energy"]?.value, 100)
        XCTAssertEqual(m["Heart rate"]?.value, 145)
        XCTAssertEqual(m["Bike elapsed"]?.value, 60)
    }
    func testSpeedDisplayConversionPreservesRawMeasurement() {
        let raw = Reading(value: 100, unit: "km/h")
        XCTAssertEqual(SpeedUnit.milesPerHour.display(raw).value, 62.1371192, accuracy: 0.000001)
        XCTAssertEqual(SpeedUnit.milesPerHour.display(raw).unit, "mph")
        XCTAssertEqual(SpeedUnit.kilometresPerHour.display(raw).value, 100)
        XCTAssertEqual(raw.value, 100)
    }
    func testGrupettoResistanceWholeLevels() throws {
        for level: UInt8 in [0, 42, 100] {
            let m = try decodeMetrics(characteristic: bluetoothUUID(0x2ad2), bytes: [0x21, 0, level, 0])
            XCTAssertEqual(m["Resistance"]?.value, Double(level))
        }
    }
    func testBridgeSerializesPopulatedMetricsAsNumbers() throws {
        let monitor = Monitor(defaults: UserDefaults(suiteName: "BridgeSnapshotTests-\(UUID())")!)
        monitor.metrics = ["Power": Reading(value: 222, unit: "W"), "Speed": Reading(value: 25.5, unit: "km/h")]
        monitor.updated = ["Power": Date(timeIntervalSince1970: 1234), "Speed": Date(timeIntervalSince1970: 1234)]
        monitor.active = true; monitor.packets = 3
        let data = try JSONSerialization.data(withJSONObject: TelemetryBridge.snapshot(monitor, averagingSeconds: 3, epoch: "test"))
        let decoded = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(decoded["powerAverage"] as? Double, 222)
        XCTAssertEqual(decoded["notificationCount"] as? Int, 3)
        let metrics = try XCTUnwrap(decoded["metrics"] as? [String: [String: Any]])
        XCTAssertEqual(metrics["Speed"]?["value"] as? Double, 25.5)
        XCTAssertEqual(metrics["Power"]?["at"] as? Double, 1234000)
    }
    func testOtherCharacteristics() throws {
        let power = try decodeMetrics(characteristic: bluetoothUUID(0x2a63), bytes: [0, 0, 0xff, 0xff])
        XCTAssertEqual(power["Power"]?.value, -1)
        let hr = try decodeMetrics(characteristic: bluetoothUUID(0x2a37), bytes: [1, 0x2c, 1])
        XCTAssertEqual(hr["Heart rate"]?.value, 300)
    }
}
