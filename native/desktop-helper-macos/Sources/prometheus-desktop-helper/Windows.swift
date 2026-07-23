import Foundation
import AppKit
import CoreGraphics
import ApplicationServices

// Window focus / control + accessibility tree via the Accessibility (AX) API.
// All require Accessibility permission.

private func requireAX() throws {
    if !accessibilityTrusted(prompt: true) {
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

private func axBool(_ element: AXUIElement, _ attr: String) -> Bool? {
    guard let value = axCopy(element, attr) else { return nil }
    if CFGetTypeID(value) == CFBooleanGetTypeID() {
        return CFBooleanGetValue((value as! CFBoolean))
    }
    return nil
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

private func resolveTargetWindow(windowName: String) -> (pid: Int, bounds: CGRect, title: String)? {
    let windows = windowInfoList()
    if !windowName.isEmpty {
        if let match = windows.first(where: {
            (($0["title"] as? String) ?? "").localizedCaseInsensitiveContains(windowName)
            || (($0["processName"] as? String) ?? "").localizedCaseInsensitiveContains(windowName)
            || (($0["appDisplayName"] as? String) ?? "").localizedCaseInsensitiveContains(windowName)
            || (($0["bundleId"] as? String) ?? "").localizedCaseInsensitiveContains(windowName)
        }) {
            let pid = (match["pid"] as? Int) ?? 0
            let title = (match["title"] as? String) ?? ""
            let left = (match["left"] as? Int) ?? 0
            let top = (match["top"] as? Int) ?? 0
            let width = (match["width"] as? Int) ?? 0
            let height = (match["height"] as? Int) ?? 0
            return (pid, CGRect(x: left, y: top, width: width, height: height), title)
        }
        return nil
    }

    if let front = NSWorkspace.shared.frontmostApplication {
        let pid = Int(front.processIdentifier)
        if let match = windows.first(where: { ($0["pid"] as? Int) == pid }) {
            let title = (match["title"] as? String) ?? ""
            let left = (match["left"] as? Int) ?? 0
            let top = (match["top"] as? Int) ?? 0
            let width = (match["width"] as? Int) ?? 0
            let height = (match["height"] as? Int) ?? 0
            return (pid, CGRect(x: left, y: top, width: width, height: height), title)
        }
        return (pid, .zero, front.localizedName ?? "")
    }
    return nil
}

func focusWindow(_ params: [String: Any]) throws -> Bool {
    try requireAX()
    let handle = paramInt(params, "handle") ?? 0
    guard let (pid, bounds) = windowPidAndBounds(handle) else { return false }

    // NSRunningApplication.activate() alone is unreliable when the caller is a
    // background CLI helper (no activation policy): macOS cooperative activation
    // often ignores the request, so the app reports "activated" but never comes
    // to the foreground. The reliable path with Accessibility permission is to
    // set the AX frontmost attribute on the app and raise + main the window.
    let appElement = AXUIElementCreateApplication(pid_t(pid))

    var raised = false
    if let win = findAXWindow(pid: pid, bounds: bounds) {
        AXUIElementPerformAction(win, kAXRaiseAction as CFString)
        AXUIElementSetAttributeValue(win, kAXMainAttribute as CFString, kCFBooleanTrue)
        AXUIElementSetAttributeValue(win, kAXFocusedAttribute as CFString, kCFBooleanTrue)
        raised = true
    }

    // Make the whole app frontmost (this is what actually flips the active app).
    AXUIElementSetAttributeValue(appElement, kAXFrontmostAttribute as CFString, kCFBooleanTrue)

    // Belt-and-suspenders: also issue the NSRunningApplication activation.
    if let app = NSRunningApplication(processIdentifier: pid_t(pid)) {
        if #available(macOS 14.0, *) {
            app.activate(options: [.activateAllWindows])
        } else {
            app.activate(options: [.activateIgnoringOtherApps])
        }
    }

    // Give the window server a moment to flip the active app before the caller
    // checks foreground state.
    usleep(120_000)
    return raised
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
    let focused = axBool(element, kAXFocusedAttribute as String)
    let enabled = axBool(element, kAXEnabledAttribute as String)
    let indent = String(repeating: "  ", count: depth)
    let titleClip = title.count > 60 ? String(title.prefix(60)) + "…" : title
    let flags = [
        focused == true ? "focused" : nil,
        enabled == false ? "disabled" : nil,
    ].compactMap { $0 }.joined(separator: ",")
    let flagSuffix = flags.isEmpty ? "" : " {\(flags)}"
    lines.append("\(indent)[\(role)] \"\(titleClip)\" @(\(Int(p.x)),\(Int(p.y))) \(Int(s.width))x\(Int(s.height))\(flagSuffix)")
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

    guard let target = resolveTargetWindow(windowName: windowName) else {
        return windowName.isEmpty
            ? "ERROR: No target application for accessibility tree."
            : "ERROR: No window matching \"\(windowName)\" found."
    }
    let root = findAXWindow(pid: target.pid, bounds: target.bounds) ?? AXUIElementCreateApplication(pid_t(target.pid))
    var nodeCount = 0
    let targetTitle = target.title.isEmpty ? "(untitled)" : target.title
    var lines: [String] = ["=== Accessibility Tree (pid=\(target.pid), window=\"\(targetTitle)\", depth=\(maxDepth), max=\(maxNodes)) ==="]
    walkAX(root, depth: 0, maxDepth: maxDepth, nodeCount: &nodeCount, maxNodes: maxNodes, lines: &lines)
    lines.append("=== captured \(nodeCount) node(s) ===")
    return lines.joined(separator: "\n")
}
