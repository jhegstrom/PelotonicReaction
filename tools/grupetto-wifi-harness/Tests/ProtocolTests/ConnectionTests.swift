import XCTest
import Network
@testable import GrupettoWiFi

// Real loopback TCP tests exercise Monitor's callbacks, re-subscription and timers.
final class ConnectionTests: XCTestCase {
    func testAutomaticBonjourConnection() throws {
        let server = try TestBike()
        let name = "Grupetto Test " + UUID().uuidString
        server.listener.service = NWListener.Service(name: name, type: "_wahoo-fitness-tnp._tcp")
        let defaults = UserDefaults(suiteName: "GrupettoDiscoveryTests-\(UUID())")!
        defaults.set(name, forKey: "grupetto.serviceName")
        let monitor = Monitor(defaults: defaults)
        defer { monitor.disconnect(); server.stop() }
        let subscribed = expectation(description: "Bonjour auto-connect and subscribe")
        server.onSubscribe = { subscribed.fulfill() }
        server.listener.start(queue: .main)
        monitor.start()
        wait(for: [subscribed], timeout: 10)
        XCTAssertTrue(monitor.active)
        XCTAssertFalse(monitor.showConnectionDialog)
        XCTAssertEqual(server.accepted, 1)
    }
    func testIdleConnectionRecoveryAndExplicitStop() throws {
        let server = try TestBike()
        let listening = expectation(description: "Server listening")
        server.listener.stateUpdateHandler = { state in if case .ready = state { listening.fulfill() } }
        server.listener.start(queue: .main)
        wait(for: [listening], timeout: 5)
        let defaults = UserDefaults(suiteName: "GrupettoHarnessTests-\(UUID())")!
        defaults.set("127.0.0.1", forKey: "grupetto.host")
        defaults.set(Int(server.listener.port!.rawValue), forKey: "grupetto.port")
        let monitor = Monitor(defaults: defaults)
        defer { monitor.disconnect(); server.stop() }
        let subscribed = expectation(description: "Initial subscription")
        server.onSubscribe = { subscribed.fulfill() }
        monitor.start()
        wait(for: [subscribed], timeout: 5)
        // A malformed measurement must be discarded, not treated as a transport failure.
        server.notify([0x40, 0, 0])
        let idle = expectation(description: "Idle beyond old timeout")
        DispatchQueue.main.asyncAfter(deadline: .now() + 17) { idle.fulfill() }
        wait(for: [idle], timeout: 20)
        XCTAssertEqual(server.accepted, 1, "Metric silence must not reconnect")
        XCTAssertTrue(monitor.active)
        XCTAssertFalse(monitor.showConnectionDialog)
        XCTAssertTrue(monitor.metrics.isEmpty)
        XCTAssertTrue(monitor.log.contains { $0.contains("Discarded malformed payload") })

        let resubscribed = expectation(description: "Automatic recovery and re-subscription")
        server.onSubscribe = {
            server.notify([0x40, 0, 0, 0, 200, 0])
            resubscribed.fulfill()
        }
        server.clients.last?.cancel()
        wait(for: [resubscribed], timeout: 10)
        let received = expectation(description: "Metrics resume")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { received.fulfill() }
        wait(for: [received], timeout: 2)
        XCTAssertEqual(monitor.metrics["Power"]?.value, 200)
        XCTAssertFalse(monitor.showConnectionDialog)
        monitor.disconnect()
        let stopped = expectation(description: "Explicit stop remains stopped")
        let count = server.accepted
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { stopped.fulfill() }
        wait(for: [stopped], timeout: 5)
        XCTAssertEqual(server.accepted, count)
        XCTAssertFalse(monitor.active)
    }
}
private final class TestBike {
    let listener: NWListener
    var clients: [NWConnection] = []
    var accepted = 0
    var onSubscribe: (() -> Void)?
    init() throws {
        listener = try NWListener(using: .tcp, on: .any)
        listener.newConnectionHandler = { [weak self] c in
            guard let self else { return }
            self.accepted += 1; self.clients.append(c)
            c.start(queue: .main)
            self.receive(c, DirConFramer())
        }
    }
    func stop() { listener.cancel(); clients.forEach { $0.cancel() } }
    func notify(_ bytes: [UInt8]) {
        guard let c = clients.last else { return }
        send(c, Frame(type: 6, sequence: 0, status: 0, payload: bluetoothUUID(0x2ad2) + bytes))
    }
    private func send(_ c: NWConnection, _ f: Frame) {
        c.send(content: Data(f.bytes), completion: .contentProcessed { _ in })
    }
    private func receive(_ c: NWConnection, _ parser: DirConFramer) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] data, _, done, error in
            guard let self else { return }
            var parser = parser
            if let data, let frames = try? parser.append(Array(data)) {
                for f in frames {
                    switch f.type {
                    case 1: self.send(c, Frame(type: 1, sequence: f.sequence, status: 0, payload: bluetoothUUID(0x1826)))
                    case 2: self.send(c, Frame(type: 2, sequence: f.sequence, status: 0, payload: bluetoothUUID(0x1826) + bluetoothUUID(0x2ad2) + [4]))
                    case 5:
                        self.send(c, Frame(type: 5, sequence: f.sequence, status: 0, payload: bluetoothUUID(0x2ad2)))
                        self.onSubscribe?()
                    default: break
                    }
                }
            }
            if !done && error == nil { self.receive(c, parser) }
        }
    }
}
