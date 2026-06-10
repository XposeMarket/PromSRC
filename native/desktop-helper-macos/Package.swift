// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "prometheus-desktop-helper",
    platforms: [
        .macOS(.v11)
    ],
    targets: [
        .executableTarget(
            name: "prometheus-desktop-helper",
            path: "Sources/prometheus-desktop-helper"
        )
    ]
)
