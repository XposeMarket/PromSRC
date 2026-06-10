import Foundation
import AppKit
import CoreGraphics

// prometheus-desktop-helper
//
// A persistent macOS helper that implements the Prometheus DesktopBackend
// primitives behind a newline-delimited JSON-RPC 2.0 protocol over stdin/stdout.
// One process == one TCC permission identity (Screen Recording + Accessibility).
//
// Contract mirror: src/gateway/desktop-backend.ts (HelperRequest/HelperResponse).
// Apple APIs: CoreGraphics (capture/input/displays), AppKit (clipboard/launch),
// ApplicationServices/AX (window control + accessibility tree).

let HELPER_VERSION = "0.1.0"

/// Structured error that maps to the JSON-RPC error codes the TS adapter expects.
struct HelperError: Error {
    let code: Int
    let message: String
    let remedy: String?
    init(_ code: Int, _ message: String, remedy: String? = nil) {
        self.code = code
        self.message = message
        self.remedy = remedy
    }
    static func unsupported(_ what: String) -> HelperError {
        HelperError(1, "Primitive not supported on macOS: \(what)")
    }
    static func permission(_ what: String, remedy: String) -> HelperError {
        HelperError(2, "Permission denied: \(what)", remedy: remedy)
    }
    static func generic(_ message: String) -> HelperError {
        HelperError(3, message)
    }
}

// ─── JSON helpers ──────────────────────────────────────────────────────────────

func paramString(_ params: [String: Any], _ key: String) -> String? {
    return params[key] as? String
}
func paramDouble(_ params: [String: Any], _ key: String) -> Double? {
    if let d = params[key] as? Double { return d }
    if let i = params[key] as? Int { return Double(i) }
    if let n = params[key] as? NSNumber { return n.doubleValue }
    return nil
}
func paramInt(_ params: [String: Any], _ key: String) -> Int? {
    if let i = params[key] as? Int { return i }
    if let d = params[key] as? Double { return Int(d) }
    if let n = params[key] as? NSNumber { return n.intValue }
    return nil
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

func dispatch(method: String, params: [String: Any]) throws -> Any {
    switch method {
    case "ping":
        return ["pong": true, "version": HELPER_VERSION]
    case "checkPermissions":
        return checkPermissions()
    case "enumerateMonitors":
        return try enumerateMonitors()
    case "gatherContext":
        return try gatherContext()
    case "capture":
        return try capture(params)
    case "movePointer":
        try movePointer(params); return [:]
    case "click":
        try click(params); return [:]
    case "scroll":
        try scroll(params); return [:]
    case "drag":
        try drag(params); return [:]
    case "typeText":
        try typeText(params); return [:]
    case "pressKey":
        try pressKey(params); return [:]
    case "getClipboard":
        return ["text": getClipboard()]
    case "setClipboard":
        setClipboard(paramString(params, "text") ?? ""); return [:]
    case "focusWindow":
        return ["ok": try focusWindow(params)]
    case "windowControl":
        try windowControl(params); return [:]
    case "launchApp":
        try launchApp(params); return [:]
    case "getAccessibilityTree":
        return ["tree": try getAccessibilityTree(params)]
    default:
        throw HelperError(-32601, "Method not found: \(method)")
    }
}

// ─── Easy primitives (no capture/input/AX) ─────────────────────────────────────

func checkPermissions() -> [[String: Any]] {
    var out: [[String: Any]] = []

    // Screen Recording (required for capture).
    let screenOk: Bool
    if #available(macOS 10.15, *) {
        screenOk = CGPreflightScreenCaptureAccess()
    } else {
        screenOk = true
    }
    out.append([
        "name": "Screen Recording",
        "granted": screenOk,
        "remedy": "System Settings > Privacy & Security > Screen Recording — enable for this app, then restart it."
    ])

    // Accessibility (required for input + window control + a11y tree).
    let axOk = AXIsProcessTrusted()
    out.append([
        "name": "Accessibility",
        "granted": axOk,
        "remedy": "System Settings > Privacy & Security > Accessibility — enable for this app, then restart it."
    ])

    return out
}

func getClipboard() -> String {
    return NSPasteboard.general.string(forType: .string) ?? ""
}

func setClipboard(_ text: String) {
    let pb = NSPasteboard.general
    pb.clearContents()
    pb.setString(text, forType: .string)
}

func launchApp(_ params: [String: Any]) throws {
    guard let name = paramString(params, "name"), !name.isEmpty else {
        throw HelperError.generic("launchApp requires 'name'")
    }
    // Absolute path to a .app bundle, or an application name resolved via `open -a`.
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    if name.hasPrefix("/") {
        proc.arguments = [name]
    } else {
        proc.arguments = ["-a", name]
    }
    let err = Pipe()
    proc.standardError = err
    do {
        try proc.run()
        proc.waitUntilExit()
    } catch {
        throw HelperError.generic("Failed to launch \(name): \(error.localizedDescription)")
    }
    if proc.terminationStatus != 0 {
        let data = err.fileHandleForReading.readDataToEndOfFile()
        let msg = String(data: data, encoding: .utf8) ?? "unknown error"
        throw HelperError.generic("open failed for \(name): \(msg.trimmingCharacters(in: .whitespacesAndNewlines))")
    }
}

// ─── stdin/stdout JSON-RPC loop ────────────────────────────────────────────────

func writeResponse(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj, options: []) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a])) // newline
}

func handleLine(_ line: String) {
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return }
    guard let data = trimmed.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        writeResponse(["jsonrpc": "2.0", "id": NSNull(),
                       "error": ["code": -32700, "message": "Parse error"]])
        return
    }
    let id = obj["id"] ?? NSNull()
    let method = obj["method"] as? String ?? ""
    let params = obj["params"] as? [String: Any] ?? [:]

    do {
        let result = try dispatch(method: method, params: params)
        writeResponse(["jsonrpc": "2.0", "id": id, "result": result])
    } catch let e as HelperError {
        var err: [String: Any] = ["code": e.code, "message": e.message]
        if let remedy = e.remedy { err["data"] = ["remedy": remedy] }
        writeResponse(["jsonrpc": "2.0", "id": id, "error": err])
    } catch {
        writeResponse(["jsonrpc": "2.0", "id": id,
                       "error": ["code": 3, "message": error.localizedDescription]])
    }
}

// Main loop: read newline-delimited requests until stdin closes.
while let line = readLine(strippingNewline: true) {
    handleLine(line)
}
