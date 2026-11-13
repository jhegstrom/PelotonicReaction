// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "GrupettoWiFi", platforms: [.macOS(.v13)], products: [.executable(name: "GrupettoWiFi", targets: ["GrupettoWiFi"])], targets: [.executableTarget(name: "GrupettoWiFi"), .testTarget(name: "ProtocolTests", dependencies: ["GrupettoWiFi"])])
