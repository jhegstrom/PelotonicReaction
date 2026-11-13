import Foundation

enum WireError: Error { case malformed }
struct Frame {
    let type: UInt8
    let sequence: UInt8
    let status: UInt8
    let payload: [UInt8]
    var bytes: [UInt8] { [1, type, sequence, status, UInt8(payload.count >> 8), UInt8(payload.count & 255)] + payload }
}
struct DirConFramer {
    var buffer: [UInt8] = []
    mutating func append(_ bytes: [UInt8]) throws -> [Frame] {
        buffer += bytes
        var frames: [Frame] = []
        while buffer.count >= 6 {
            guard buffer[0] == 1 else { throw WireError.malformed }
            let count = Int(buffer[4]) * 256 + Int(buffer[5])
            guard count <= 8192 else { throw WireError.malformed }
            guard buffer.count >= count + 6 else { break }
            frames.append(Frame(type: buffer[1], sequence: buffer[2], status: buffer[3], payload: Array(buffer[6..<(6 + count)])))
            buffer.removeFirst(6 + count)
        }
        return frames
    }
}
func bluetoothUUID(_ short: UInt16) -> [UInt8] {
    [0, 0, UInt8(short >> 8), UInt8(short & 255), 0, 0, 0x10, 0, 0x80, 0, 0, 0x80, 0x5f, 0x9b, 0x34, 0xfb]
}
struct Cursor {
    let bytes: [UInt8]
    var offset = 0
    mutating func unsigned(_ count: Int) throws -> Int {
        guard offset + count <= bytes.count else { throw WireError.malformed }
        var value = 0
        for i in 0..<count { value |= Int(bytes[offset + i]) << (8 * i) }
        offset += count
        return value
    }
    mutating func signed16() throws -> Int { Int(Int16(bitPattern: UInt16(try unsigned(2)))) }
}
enum SpeedUnit: String, CaseIterable {
    case kilometresPerHour = "km/h"
    case milesPerHour = "mph"
    func display(_ reading: Reading) -> Reading {
        guard reading.unit == "km/h", self == .milesPerHour else { return reading }
        return Reading(value: reading.value / 1.609344, unit: rawValue)
    }
}
struct Reading {
    let value: Double
    let unit: String
}
// Parse only measured fields; an absent field never becomes a fabricated zero.
func decodeMetrics(characteristic: [UInt8], bytes: [UInt8]) throws -> [String: Reading] {
    var c = Cursor(bytes: bytes)
    var result: [String: Reading] = [:]
    func reading(_ value: Double, _ unit: String) -> Reading { Reading(value: value, unit: unit) }
    if characteristic == bluetoothUUID(0x2ad2) {
        let flags = try c.unsigned(2)
        if flags & 1 == 0 { result["Speed"] = reading(Double(try c.unsigned(2)) / 100, "km/h") }
        if flags & 2 != 0 { _ = try c.unsigned(2) }
        if flags & 4 != 0 { result["Cadence"] = reading(Double(try c.unsigned(2)) / 2, "rpm") }
        if flags & 8 != 0 { _ = try c.unsigned(2) }
        if flags & 16 != 0 { result["Distance"] = reading(Double(try c.unsigned(3)) / 1000, "km") }
        if flags & 32 != 0 { result["Resistance"] = reading(Double(try c.signed16()), "0–100") }
        if flags & 64 != 0 { result["Power"] = reading(Double(try c.signed16()), "W") }
        if flags & 128 != 0 { _ = try c.unsigned(2) }
        if flags & 256 != 0 {
            result["Energy"] = reading(Double(try c.unsigned(2)), "kcal")
            _ = try c.unsigned(2); _ = try c.unsigned(1)
        }
        if flags & 512 != 0 { result["Heart rate"] = reading(Double(try c.unsigned(1)), "bpm") }
        if flags & 1024 != 0 { _ = try c.unsigned(1) }
        if flags & 2048 != 0 { result["Bike elapsed"] = reading(Double(try c.unsigned(2)), "s") }
        if flags & 4096 != 0 { _ = try c.unsigned(2) }
    } else if characteristic == bluetoothUUID(0x2a63) {
        _ = try c.unsigned(2)
        result["Power"] = reading(Double(try c.signed16()), "W")
    } else if characteristic == bluetoothUUID(0x2a37) {
        let flags = try c.unsigned(1)
        result["Heart rate"] = reading(Double(try c.unsigned(flags & 1 == 0 ? 1 : 2)), "bpm")
    }
    return result
}
