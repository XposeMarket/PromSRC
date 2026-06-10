import Foundation
import AppKit
import CoreGraphics
import ApplicationServices

// Window focus / control + accessibility tree via the Accessibility (AX) API.
// All require Accessibility permission.

private func requireAX() throws {
    if !AXIsProcessTrusted() {
        throw HelperError.permission(
            "Accessibility",
            remedy: "System Settings > Privacy & Security > Accessibility — enable for this app, then restart it."
        )
    }
}

/// Look up a window in the CGWindowList by its window number; return (pid, bounds).
private func windowPidAndBounds(_ handle: Int) -> (pid: Int, bounds: CGRect)? {
    guard let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] else {
        return nil
    }
    for w in info {
        if (w[kCGWindowNumber as String] as? Int) == handle {
            let pid = (w[kCGWindowOwnerPID as String] as? Int) ?? 0
            var rect = CGRect.zero
            if let bdict = w[kCGWindowBounds as String] as? [String: Any],
               let b = CGRect(dictionaryRepresentation: bdict as CFDictionary) {
                rect = b
            }
            return (pid, rect)
        }
    }
    return nil
}

private func axCopy(_ element: AXUIElement, _ attr: String) -> CFTypeRef? {
    var value: CFTypeRef?
    let err = AXUIElementCopyAttributeValue(element, attr as CFString, &value)
    return err == .success ? value : nil
}

private func axString(_ element: AXUIElement, _ attr: String) -> String {
    return (axCopy(element, attr) as? String) ?? ""
}

private func axPoint(_ element: AXUIElement) -> CGPoint {
    guard let v = axCopy(element, kAXPositionAttribute as String) else { return .zero }
    var p = CGPoint.zero
    AXValueGetValue(v as! AXValue, .cgPoint, &p)
    return p
}

private func axSize(_ element: AXUIElement) -> CGSize {
    guard let v = axCopy(element, kAXSizeAttribute as String) else { return .zero }
    var s = CGSize.zero
    AXValueGetValue(v as! AXValue, .cgSize, &s)
    return s
}

/// Find the AX window element for a given pid whose frame best matches `bounds`.
private func findAXWindow(pid: Int, bounds: CGRect) -> AXUIElement? {
    let app = AXUIElementCreateApplication(pid_t(pid))
    guard let windows = axCopy(app, kAXWindowsAttribute as String) as? [AXUIElement] else { return nil }
    if windows.isEmpty { return nil }
    var best: AXUIElement? = nil
    var bestScore = Double.greatestFiniteMagnitude
    for w in windows {
        let p = axPoint(w)
        let s = axSize(w)
        let score = abs(p.x - bounds.origin.x) + abs(p.y - bounds.origin.y)
            + abs(s.width - bounds.size.width) + abs(s.height - bounds.size.height)
        if score < bestScore { bestScore = score; best = w }
    }
    // If bounds were unknown (zero), fall back to the first/main window.
    return best ?? windows.first
}

func focusWindow(_ params: [String: Any]) throws -> Bool {
    try requireAX()
    let handle = paramInt(params, "handle") ?? 0
    guard let (pid, bounds) = windowPidAndBounds(handle) else { return false }
    var ok = false
    if let app = NSRunningApplication(processIdentifier: pid_t(pid)) {
        ok = app.activate(options: [.activateIgnoringOtherApps])
    }
    if let win = findAXWindow(pid: pid, bounds: bounds) {
        AXUIElementPerformAction(win, kAXRaiseAction as CFString)
        ok = true
    }
    return ok
}

func windowControl(_ params: [String: Any]) throws {
    try requireAX()
    let handle = paramInt(params, "handle") ?? 0
    let action = paramString(params, "action") ?? ""
    guard let (pid, bounds) = windowPidAndBounds(handle) else {
        throw HelperError.generic("window \(handle) not found")
    }
    guard let win = findAXWindow(pid: pid, bounds: bounds) else {
        throw HelperError.generic("AX window not found for pid \(pid)")
    }

    switch action {
    case "minimize":
        AXUIElementSetAttributeValue(win, kAXMinimizedAttribute as CFString, kCFBooleanTrue)
    case "restore":
        AXUIElementSetAttributeValue(win, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
    case "maximize":
        if let zoom = axCopy(win, kAXZoomButtonAttribute as String) {
            AXUIElementPerformAction(zoom as! AXUIElement, kAXPressAction as CFString)
        }
    case "close":
        if let close = axCopy(win, kAXCloseButtonAttribute as String) {
            AXUIElementPerformAction(close as! AXUIElement, kAXPressAction as CFString)
        } else {
            throw HelperError.generic("no close button on window \(handle)")
        }
    default:
        throw HelperError.generic("unknown window action: \(action)")
    }
}

private func walkAX(_ element: AXUIElement, depth: Int, maxDepth: Int,
                    nodeCount: inout Int, maxNodes: Int, lines: inout [String]) {
    if depth > maxDepth || nodeCount >= maxNodes { return }
    let role = axString(element, kAXRoleAttribute as String)
    var title = axString(element, kAXTitleAttribute as String)
    if title.isEmpty { title = axString(element, kAXValueAttribute as String) }
    if title.isEmpty { title = axString(element, kAXDescriptionAttribute as String) }
    let p = axPoint(element)
    let s = axSize(element)
    let indent = String(repeating: "  ", count: depth)
    let titleClip = title.count > 60 ? String(title.prefix(60)) + "…" : title
    lines.append("\(indent)[\(role)] \"\(titleClip)\" @(\(Int(p.x)),\(Int(p.y))) \(Int(s.width))x\(Int(s.height))")
    nodeCount += 1

    if let children = axCopy(element, kAXChildrenAttribute as String) as? [AXUIElement] {
        for child in children {
            if nodeCount >= maxNodes { break }
            walkAX(child, depth: depth + 1, maxDepth: maxDepth,
                   nodeCount: &nodeCount, maxNodes: maxNodes, lines: &lines)
        }
    }
}

func getAccessibilityTree(_ params: [String: Any]) throws -> String {
    try requireAX()
    let windowName = paramString(params, "windowName") ?? ""
    let maxDepth = min(max(paramInt(params, "depth") ?? 5, 1), 10)
    let maxNodes = min(max(paramInt(params, "maxNodes") ?? 300, 10), 1000)

    // Determine the target pid: window match by title, else frontmost app.
    var pid: Int = 0
    if !windowName.isEmpty {
        let windows = windowInfoList()
        if let match = windows.first(where: {
            (($0["title"] as? String) ?? "").localizedCaseInsensitiveContains(windowName)
            || (($0["processName"] as? String) ?? "").localizedCaseInsensitiveContains(windowName)
        }) {
            pid = (match["pid"] as? Int) ?? 0
        } else {
            return "ERROR: No window matching \"\(windowName)\" found."
        }
    } else if let front = NSWorkspace.shared.frontmostApplication {
        pid = Int(front.processIdentifier)
    }
    if pid == 0 { return "ERROR: No target application for accessibility tree." }

    let app = AXUIElementCreateApplication(pid_t(pid))
    var nodeCount = 0
    var lines: [String] = ["=== Accessibility Tree (pid=\(pid), depth=\(maxDepth), max=\(maxNodes)) ==="]
    walkAX(app, depth: 0, maxDepth: maxDepth, nodeCount: &nodeCount, maxNodes: maxNodes, lines: &lines)
    lines.append("=== captured \(nodeCount) node(s) ===")
    return lines.joined(separator: "\n")
}
