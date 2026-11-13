import SwiftUI
import AppKit
import Network

final class Monitor: ObservableObject {
    @Published var devices: [NWEndpoint] = []
    @Published var status = "Disconnected"
    @Published var log: [String] = []
    @Published var metrics: [String: Reading] = [:]
    @Published var updated: [String: Date] = [:]
    @Published var packets = 0
    @Published var active = false
    @Published var scanning = false
    @Published var showConnectionDialog = false
    private var wantsConnection = false
    private var target: NWEndpoint?
    private let defaults: UserDefaults
    private var preferredName: String?
    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        preferredName = defaults.string(forKey: "grupetto.serviceName")
    }
    private var retryAt = Date.distantPast
    private var failures = 0
    private var housekeeping: Timer?
    private var searchStarted = Date()
    private var attemptedConnection = false
    private var offeredDialog = false
    private var ready = false
    private var discoveredServices = false
    private var lastTraffic = Date()
    private var lastProbe = Date()
    private var attemptStarted = Date()
    private var browserRetryAt = Date.distantPast
    private var browser: NWBrowser?
    private var connection: NWConnection?
    @Published var ftmsFields: Set<String>?
    private var smoother = DisplaySmoother()
    private var framer = DirConFramer()
    private var sequence: UInt8 = 0
    private var generation = UUID()
    func note(_ text: String) {
        log.append("\(Date().formatted(date: .omitted, time: .standard))  \(text)")
        if log.count > 500 { log.removeFirst(log.count - 500) }
    }
    // All callbacks and state transitions run on the main queue.
    func start() {
        guard housekeeping == nil else { return }
        wantsConnection = true
        searchStarted = Date()
        if let host = defaults.string(forKey: "grupetto.host"),
           let port = NWEndpoint.Port(rawValue: UInt16(clamping: defaults.integer(forKey: "grupetto.port"))), port.rawValue > 0 {
            target = .hostPort(host: .init(host), port: port)
        }
        scan()
        housekeeping = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
        tick()
    }
    private func tick() {
        guard wantsConnection else { return }
        let now = Date()
        if browser == nil && now >= browserRetryAt { scan() }
        if connection == nil, now >= retryAt {
            if let target { open(target) }
            else { chooseBike() }
        }
        // Probe the protocol, not metric freshness. A stopped rider can be silent forever.
        if ready {
            if now.timeIntervalSince(lastTraffic) > 35 { recover("DirCon stopped responding to probes") }
            else if now.timeIntervalSince(lastProbe) >= 10 { lastProbe = now; send(1) }
        } else if connection != nil && now.timeIntervalSince(attemptStarted) > 15 {
            recover("Transport/handshake pending; retrying")
        }
        if !attemptedConnection && !offeredDialog && now.timeIntervalSince(searchStarted) >= 8 {
            offeredDialog = true; showConnectionDialog = true
        }
    }
    private func chooseBike() {
        guard wantsConnection, target == nil, connection == nil, Date() >= retryAt else { return }
        let candidate = devices.first { endpoint in
            guard case .service(let name, _, _, _) = endpoint else { return false }
            if let preferredName { return name == preferredName }
            return name.localizedCaseInsensitiveContains("grupetto")
        }
        if let candidate { connect(candidate) }
        else { status = attemptedConnection ? "Reconnecting…" : "Looking for Grupetto…" }
    }
    func scan() {
        browser?.cancel()
        scanning = true
        let b = NWBrowser(for: .bonjour(type: "_wahoo-fitness-tnp._tcp", domain: "local."), using: .tcp)
        browser = b
        b.stateUpdateHandler = { [weak self, weak b] state in
            guard let self, self.browser === b else { return }
            self.note("Discovery: \(state)")
            if case .failed = state {
                self.browser?.cancel(); self.browser = nil; self.scanning = false
                self.browserRetryAt = Date().addingTimeInterval(3)
            }
        }
        b.browseResultsChangedHandler = { [weak self, weak b] results, _ in
            guard let self, self.browser === b else { return }
            self.devices = results.map(\.endpoint).sorted { "\($0)" < "\($1)" }
            self.chooseBike()
        }
        b.start(queue: .main)
    }
    func connect(host: String, port: String) {
        guard !host.trimmingCharacters(in: .whitespaces).isEmpty, let p = UInt16(port), p > 0 else {
            note("Enter a hostname/IP and a port from 1–65535."); return
        }
        connect(.hostPort(host: .init(host.trimmingCharacters(in: .whitespaces)), port: .init(rawValue: p)!))
    }
    func connect(_ endpoint: NWEndpoint) {
        wantsConnection = true; failures = 0; retryAt = .distantPast
        target = endpoint
        if case .service(let name, _, _, _) = endpoint {
            preferredName = name
            defaults.set(name, forKey: "grupetto.serviceName")
            defaults.removeObject(forKey: "grupetto.host")
        } else if case .hostPort(let host, let port) = endpoint {
            defaults.set(host.debugDescription, forKey: "grupetto.host")
            defaults.set(Int(port.rawValue), forKey: "grupetto.port")
        }
        showConnectionDialog = false
        metrics = [:]; updated = [:]; packets = 0; ftmsFields = nil
        open(endpoint)
    }
    private func closeTransport() {
        generation = UUID()
        connection?.cancel(); connection = nil; framer = DirConFramer()
        ready = false; discoveredServices = false; active = false
        smoother = DisplaySmoother()
    }
    private func open(_ endpoint: NWEndpoint) {
        closeTransport()
        attemptedConnection = true; showConnectionDialog = false
        sequence = 0; attemptStarted = Date()
        let token = generation
        status = failures == 0 ? "Connecting…" : "Reconnecting…"
        note("Connecting to \(endpoint)")
        let tcp = NWProtocolTCP.Options(); tcp.noDelay = true; tcp.enableKeepalive = true
        tcp.keepaliveIdle = 15; tcp.keepaliveInterval = 5; tcp.keepaliveCount = 3
        let c = NWConnection(to: endpoint, using: NWParameters(tls: nil, tcp: tcp))
        connection = c
        c.stateUpdateHandler = { [weak self, weak c] state in
            guard let self, let c, self.generation == token else { return }
            switch state {
            case .ready:
                self.active = true
                self.lastTraffic = Date(); self.lastProbe = Date()
                self.status = "Connected · discovering services"
                self.note("TCP ready"); self.send(1); self.receive(c, token)
            case .waiting(let error): self.note("Transport waiting: \(error)"); self.recover("Network temporarily unavailable")
            case .failed(let error): self.recover("Connection failed: \(error)")
            default: break
            }
        }
        c.start(queue: .main)
    }
    private func recover(_ reason: String) {
        note(reason)
        closeTransport()
        guard wantsConnection else { return }
        failures += 1
        retryAt = Date().addingTimeInterval(min(5, pow(2, Double(min(failures - 1, 3)))))
        status = "Reconnecting…"
        // Resolve the Bonjour service again on each attempt; do not cache its IP address.
    }
    func disconnect() {
        wantsConnection = false
        closeTransport(); status = "Disconnected"
        showConnectionDialog = false
        browser?.cancel(); browser = nil; scanning = false
        housekeeping?.invalidate(); housekeeping = nil
    }
    private func send(_ type: UInt8, _ payload: [UInt8] = []) {
        sequence &+= 1
        let frame = Frame(type: type, sequence: sequence, status: 0, payload: payload)
        note("TX \(frame.bytes.hex)")
        let token = generation
        connection?.send(content: Data(frame.bytes), completion: .contentProcessed { [weak self] error in
            guard let self, self.generation == token else { return }
            if let error { self.recover("Send failed: \(error)") }
        })
    }
    private func receive(_ c: NWConnection, _ token: UUID) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 16384) { [weak self] data, _, done, error in
            guard let self, self.generation == token else { return }
            do {
                if let data {
                    for frame in try self.framer.append(Array(data)) {
                        self.lastTraffic = Date()
                        // An invalid measurement is dropped without tearing down a healthy socket.
                        do { try self.handle(frame) }
                        catch { self.note("Discarded malformed payload: \(error)") }
                    }
                }
            } catch {
                self.recover("Invalid DirCon framing: \(error)"); return
            }
            if let error { self.note("Receive failed: \(error)") }
            if done || error != nil { self.recover("Connection closed"); return }
            self.receive(c, token)
        }
    }
    private func handle(_ f: Frame) throws {
        note("RX \(f.bytes.hex)")
        guard f.status == 0 else { note("DirCon error \(f.status), request \(f.type)"); return }
        switch f.type {
        case 1:
            ready = true; failures = 0
            guard !discoveredServices else { return }
            guard f.payload.count % 16 == 0 else { throw WireError.malformed }
            discoveredServices = true
            for start in stride(from: 0, to: f.payload.count, by: 16) {
                send(2, Array(f.payload[start..<start + 16]))
            }
        case 2:
            guard f.payload.count >= 16, (f.payload.count - 16) % 17 == 0 else { throw WireError.malformed }
            for start in stride(from: 16, to: f.payload.count, by: 17) {
                let uuid = Array(f.payload[start..<start + 16])
                let supported = [UInt16(0x2ad2), 0x2a63, 0x2a37].contains { uuid == bluetoothUUID($0) }
                if supported && f.payload[start + 16] & 4 != 0 { send(5, uuid + [1]) }
            }
        case 5: if metrics.isEmpty { status = "Subscribed · waiting for metrics (no timeout)" }
        case 6:
            guard f.payload.count >= 16 else { throw WireError.malformed }
            let uuid = Array(f.payload.prefix(16))
            let values = try decodeMetrics(characteristic: uuid, bytes: Array(f.payload.dropFirst(16)))
            if uuid == bluetoothUUID(0x2ad2) {
                let fields = Set(values.keys)
                if ftmsFields != fields {
                    note("Indoor Bike Data fields: " + fields.sorted().joined(separator: ", "))
                    let missing = ["Distance", "Energy", "Bike elapsed"].filter { !fields.contains($0) }
                    if !missing.isEmpty { note("Not included in this packet: " + missing.joined(separator: ", ")) }
                    ftmsFields = fields
                }
            }
            packets += 1
            if !values.isEmpty {
                status = "Receiving metrics"
                smoother.add(values, at: ProcessInfo.processInfo.systemUptime)
                for (key, value) in values { metrics[key] = value; updated[key] = Date() }
            }
        default: break
        }
    }
    func displayReading(_ name: String, averagingSeconds: Int) -> Reading? {
        metrics[name].map {
            smoother.display($0, name: name, window: Double(averagingSeconds), at: ProcessInfo.processInfo.systemUptime)
        }
    }
    func copyLog() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(log.joined(separator: "\n"), forType: .string)
    }
}
extension Array where Element == UInt8 {
    var hex: String { map { String(format: "%02x", $0) }.joined(separator: " ") }
}

struct MonitorView: View {
    @StateObject private var model = Monitor()
    @AppStorage("grupetto.speedUnit") private var speedUnit: SpeedUnit = .kilometresPerHour
    @AppStorage("grupetto.averagingSeconds") private var averagingSeconds = 3
    @AppStorage("grupetto.threeSecondDefaultApplied") private var threeSecondDefaultApplied = false
    @State private var host = ""
    @State private var port = "8081"
    private let names = ["Power", "Cadence", "Resistance", "Heart rate", "Speed", "Distance", "Energy", "Bike elapsed"]
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Grupetto Wi-Fi Test").font(.largeTitle.bold())
            Text("Start Grupetto’s DirCon/Wi-Fi broadcast on the bike. Keep both devices on the same local network.").foregroundStyle(.secondary)
            HStack {
                Text(model.status).fontWeight(.semibold)
                Spacer()
                Picker("Speed units", selection: $speedUnit) {
                    ForEach(SpeedUnit.allCases, id: \.self) { unit in Text(unit.rawValue).tag(unit) }
                }.frame(width: 190)
                Button("Disconnect") { model.disconnect() }
                Button("Resume automatic connection") { model.start() }.disabled(model.scanning)
            }
            HStack {
                Stepper(value: $averagingSeconds, in: 0...300) {
                    Text(averagingSeconds == 0 ? "Power average: Off" : "Power average: \(averagingSeconds) seconds")
                }.frame(width: 300)
                Text("Current watts and rolling average · other metrics are current").font(.caption).foregroundStyle(.secondary)
            }
            TimelineView(.periodic(from: .now, by: 1)) { context in
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    ForEach(names, id: \.self) { name in
                        let age = model.updated[name].map { context.date.timeIntervalSince($0) }
                        let reading = model.metrics[name].map { name == "Speed" ? speedUnit.display($0) : $0 }
                        VStack(alignment: .leading, spacing: 6) {
                            Text(name == "Power" ? "Current power" : name).foregroundStyle(.secondary)
                            Text(reading.map { String(format: name == "Resistance" ? "%.0f" : "%.1f", $0.value) } ?? "—").font(.system(size: 32, weight: .semibold, design: .rounded)).monospacedDigit()
                            Text(reading?.unit ?? " ")
                            if name == "Power" {
                                Text(averagingSeconds == 0 ? "Average off" : "\(averagingSeconds)s average")
                                    .font(.caption).foregroundStyle(.secondary)
                                Text(averagingSeconds == 0 ? "—" : model.displayReading("Power", averagingSeconds: averagingSeconds).map { String(format: "%.1f W", $0.value) } ?? "—")
                                    .font(.system(size: 24, weight: .semibold, design: .rounded)).monospacedDigit()
                            }
                            Text(age.map { model.active && $0 < 5 ? "Live" : "Stale · \(max(0, Int($0)))s ago" } ?? (model.ftmsFields.map { $0.contains(name) ? "No data" : "Not in bike packet" } ?? "Waiting for data"))
                                .font(.caption).foregroundStyle(model.active && (age ?? 999) < 5 ? .green : .secondary)
                        }.frame(maxWidth: .infinity, alignment: .leading).padding().background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
                    }
                }
            }
            HStack {
                Text("\(model.packets) notifications · read-only telemetry").font(.caption)
                Spacer(); Button("Copy log") { model.copyLog() }; Button("Clear log") { model.log = [] }
            }
            ScrollView {
                Text(model.log.joined(separator: "\n")).font(.system(.caption, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
            }.frame(minHeight: 100).padding(10).background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
        }.padding(24).frame(minWidth: 850, minHeight: 650)
        .onAppear {
            // Migrate the mistaken old default once; retain other customized windows.
            if !threeSecondDefaultApplied {
                if averagingSeconds == 30 { averagingSeconds = 3 }
                threeSecondDefaultApplied = true
            }
            model.start()
        }
        .sheet(isPresented: $model.showConnectionDialog) {
            VStack(alignment: .leading, spacing: 16) {
                Text("Looking for your bike").font(.title2.bold())
                Text("No Grupetto bike was found. Automatic discovery continues. Check that Grupetto’s Wi-Fi broadcast is running on the same network, or enter its address.")
                ForEach(model.devices, id: \.self) { endpoint in
                    HStack { Text(endpoint.debugDescription); Spacer(); Button("Connect") { model.connect(endpoint) } }
                }
                HStack {
                    TextField("Bike IP address or hostname", text: $host)
                    TextField("Port", text: $port).frame(width: 80)
                    Button("Connect address") { model.connect(host: host, port: port) }
                }
                Button("Keep looking") { model.showConnectionDialog = false }
            }.padding(24).frame(width: 650)
        }
    }
}
@main struct GrupettoWiFiApp: App {
    init() {
        if CommandLine.arguments.contains("--bridge") { TelemetryBridge.run(); exit(0) }
        NSApplication.shared.setActivationPolicy(.regular)
    }
    var body: some Scene { WindowGroup { MonitorView() } }
}
