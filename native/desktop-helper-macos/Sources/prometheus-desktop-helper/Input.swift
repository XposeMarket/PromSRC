import Foundation
import CoreGraphics

// Mouse + keyboard input via CGEvent. All require Accessibility permission to
// affect the system; we preflight and throw a clear permission error otherwise.

private func requireAccessibility() throws {
    if !AXIsProcessTrusted() {
        throw HelperError.permission(
            "Accessibility",
            remedy: "System Settings > Privacy & Security > Accessibility — enable for this app, then restart it."
        )
    }
}

private func currentMouseLocation() -> CGPoint {
    return CGEvent(source: nil)?.location ?? .zero
}

func movePointer(_ params: [String: Any]) throws {
    try requireAccessibility()
    let x = paramDouble(params, "x") ?? 0
    let y = paramDouble(params, "y") ?? 0
    let pt = CGPoint(x: x, y: y)
    CGWarpMouseCursorPosition(pt)
    if let ev = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: pt, mouseButton: .left) {
        ev.post(tap: .cghidEventTap)
    }
}

func click(_ params: [String: Any]) throws {
    try requireAccessibility()
    let button = paramString(params, "button") ?? "left"
    let repeatCount = max(1, paramInt(params, "repeat") ?? 1)
    let modifiers = (params["modifiers"] as? [String]) ?? []
    let flags = modifierFlags(modifiers)
    let pt = currentMouseLocation()

    let (downType, upType, cgButton): (CGEventType, CGEventType, CGMouseButton)
    switch button {
    case "right": (downType, upType, cgButton) = (.rightMouseDown, .rightMouseUp, .right)
    case "middle": (downType, upType, cgButton) = (.otherMouseDown, .otherMouseUp, .center)
    default: (downType, upType, cgButton) = (.leftMouseDown, .leftMouseUp, .left)
    }

    for i in 1...repeatCount {
        guard let down = CGEvent(mouseEventSource: nil, mouseType: downType, mouseCursorPosition: pt, mouseButton: cgButton),
              let up = CGEvent(mouseEventSource: nil, mouseType: upType, mouseCursorPosition: pt, mouseButton: cgButton) else {
            throw HelperError.generic("failed to create mouse event")
        }
        if !flags.isEmpty { down.flags = flags; up.flags = flags }
        // Encode multi-click count so the OS recognizes double/triple clicks.
        down.setIntegerValueField(.mouseEventClickState, value: Int64(i))
        up.setIntegerValueField(.mouseEventClickState, value: Int64(i))
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
        if i < repeatCount { usleep(80_000) }
    }
}

func scroll(_ params: [String: Any]) throws {
    try requireAccessibility()
    let dx = paramInt(params, "deltaX") ?? 0
    let dy = paramInt(params, "deltaY") ?? 0
    if let ev = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2,
                        wheel1: Int32(dy), wheel2: Int32(dx), wheel3: 0) {
        ev.post(tap: .cghidEventTap)
    }
}

func drag(_ params: [String: Any]) throws {
    try requireAccessibility()
    let fx = paramDouble(params, "fromX") ?? 0
    let fy = paramDouble(params, "fromY") ?? 0
    let tx = paramDouble(params, "toX") ?? 0
    let ty = paramDouble(params, "toY") ?? 0
    let steps = max(2, min(100, paramInt(params, "steps") ?? 20))
    let from = CGPoint(x: fx, y: fy)

    CGWarpMouseCursorPosition(from)
    usleep(30_000)
    if let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: from, mouseButton: .left) {
        down.post(tap: .cghidEventTap)
    }
    for i in 1...steps {
        let x = fx + (tx - fx) * Double(i) / Double(steps)
        let y = fy + (ty - fy) * Double(i) / Double(steps)
        let pt = CGPoint(x: x, y: y)
        if let move = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: pt, mouseButton: .left) {
            move.post(tap: .cghidEventTap)
        }
        usleep(8_000)
    }
    let to = CGPoint(x: tx, y: ty)
    if let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: to, mouseButton: .left) {
        up.post(tap: .cghidEventTap)
    }
}

func typeText(_ params: [String: Any]) throws {
    try requireAccessibility()
    let text = paramString(params, "text") ?? ""
    for ch in text {
        let s = String(ch)
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else { continue }
        let utf16 = Array(s.utf16)
        down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
        up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
        usleep(2_000)
    }
}

func pressKey(_ params: [String: Any]) throws {
    try requireAccessibility()
    let key = (paramString(params, "key") ?? "").lowercased()
    let modifiers = (params["modifiers"] as? [String]) ?? []
    let flags = modifierFlags(modifiers)

    guard let code = keyCodeMap[key] else {
        // Unknown named key with no keycode: fall back to typing it literally if
        // there are no modifiers (e.g. a stray character).
        if modifiers.isEmpty && key.count == 1 {
            try typeText(["text": key])
            return
        }
        throw HelperError.generic("unmapped key: '\(key)'")
    }

    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true),
          let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false) else {
        throw HelperError.generic("failed to create key event")
    }
    if !flags.isEmpty { down.flags = flags; up.flags = flags }
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
}
