import Foundation
import AppKit
import CoreGraphics

// Capture, display enumeration, and window/context gathering via CoreGraphics.
//
// Coordinate space: all coordinates crossing the JSON-RPC boundary are LOGICAL
// points in the global display space with a top-left origin — the space used by
// CGDisplayBounds, CGWindowBounds, and CGEvent mouse positions. The TS
// orchestration layer treats this as its "virtual screen" space. Each capture
// reports devicePixelRatio so screenshot pixels map back to logical points.

func cgDisplayList() -> [CGDirectDisplayID] {
    var count: UInt32 = 0
    CGGetActiveDisplayList(0, nil, &count)
    if count == 0 { return [] }
    var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
    CGGetActiveDisplayList(count, &ids, &count)
    return Array(ids.prefix(Int(count)))
}

func displayDevicePixelRatio(_ id: CGDirectDisplayID) -> Double {
    guard let mode = CGDisplayCopyDisplayMode(id) else { return 1.0 }
    let pts = Double(mode.width)
    let px = Double(mode.pixelWidth)
    if pts <= 0 { return 1.0 }
    let r = px / pts
    return r > 0 ? r : 1.0
}

func enumerateMonitors() throws -> [[String: Any]] {
    let ids = cgDisplayList()
    var out: [[String: Any]] = []
    for (i, id) in ids.enumerated() {
        let b = CGDisplayBounds(id)
        out.append([
            "index": i,
            "left": Int(b.origin.x),
            "top": Int(b.origin.y),
            "width": Int(b.size.width),
            "height": Int(b.size.height),
            "primary": CGDisplayIsMain(id) != 0,
            "deviceName": "Display \(id)"
        ])
    }
    return out
}

func virtualScreenBounds() -> CGRect {
    let ids = cgDisplayList()
    if ids.isEmpty { return CGRect(x: 0, y: 0, width: 0, height: 0) }
    var union = CGDisplayBounds(ids[0])
    for id in ids.dropFirst() {
        union = union.union(CGDisplayBounds(id))
    }
    return union
}

func windowInfoList() -> [[String: Any]] {
    let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let info = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
        return []
    }
    var out: [[String: Any]] = []
    for w in info {
        // Only normal application windows (layer 0).
        let layer = (w[kCGWindowLayer as String] as? Int) ?? -1
        if layer != 0 { continue }
        let pid = (w[kCGWindowOwnerPID as String] as? Int) ?? 0
        let number = (w[kCGWindowNumber as String] as? Int) ?? 0
        let owner = (w[kCGWindowOwnerName as String] as? String) ?? ""
        let title = (w[kCGWindowName as String] as? String) ?? ""
        let app = pid > 0 ? NSRunningApplication(processIdentifier: pid_t(pid)) : nil
        let displayName = app?.localizedName ?? owner
        let bundleId = app?.bundleIdentifier ?? ""
        let bundleURL = app?.bundleURL?.path ?? ""
        var left = 0, top = 0, width = 0, height = 0
        if let bdict = w[kCGWindowBounds as String] as? [String: Any],
           let b = CGRect(dictionaryRepresentation: bdict as CFDictionary) {
            left = Int(b.origin.x); top = Int(b.origin.y)
            width = Int(b.size.width); height = Int(b.size.height)
        }
        // Skip tiny/offscreen helper windows.
        if width < 1 || height < 1 { continue }
        out.append([
            "pid": pid,
            "processName": owner,
            "appDisplayName": displayName,
            "bundleId": bundleId,
            "appPath": bundleURL,
            "title": title,
            "handle": number,
            "left": left, "top": top, "width": width, "height": height
        ])
    }
    return out
}

func gatherContext() throws -> [String: Any] {
    let monitors = try enumerateMonitors()
    let vs = virtualScreenBounds()
    let windows = windowInfoList()

    var activeWindow: [String: Any]? = nil
    if let frontPid = NSWorkspace.shared.frontmostApplication?.processIdentifier {
        // CGWindowList is front-to-back; first window of the frontmost pid is active.
        activeWindow = windows.first(where: { ($0["pid"] as? Int) == Int(frontPid) })
    }

    return [
        "monitors": monitors,
        "virtualScreen": [
            "left": Int(vs.origin.x), "top": Int(vs.origin.y),
            "width": Int(vs.size.width), "height": Int(vs.size.height)
        ],
        "windows": windows,
        "activeWindow": activeWindow as Any
    ]
}

private func pngBase64(from cgImage: CGImage) -> String? {
    let rep = NSBitmapImageRep(cgImage: cgImage)
    guard let data = rep.representation(using: .png, properties: [:]) else { return nil }
    return data.base64EncodedString()
}

func capture(_ params: [String: Any]) throws -> [String: Any] {
    let kind = paramString(params, "kind") ?? "all"

    // Screen Recording gate — fail clearly instead of returning a black frame.
    if #available(macOS 10.15, *), !CGPreflightScreenCaptureAccess() {
        throw HelperError.permission(
            "Screen Recording",
            remedy: "System Settings > Privacy & Security > Screen Recording — enable for this app, then restart it."
        )
    }

    var rect = CGRect.infinite
    var dprHint: Double = 1.0
    var listOption: CGWindowListOption = [.optionOnScreenOnly]
    var windowID: CGWindowID = kCGNullWindowID

    switch kind {
    case "all":
        rect = CGRect.infinite
        dprHint = displayDevicePixelRatio(CGMainDisplayID())
    case "primary":
        rect = CGDisplayBounds(CGMainDisplayID())
        dprHint = displayDevicePixelRatio(CGMainDisplayID())
    case "monitor":
        let idx = paramInt(params, "index") ?? 0
        let ids = cgDisplayList()
        guard idx >= 0 && idx < ids.count else {
            throw HelperError.generic("invalid monitor index \(idx) (have \(ids.count))")
        }
        rect = CGDisplayBounds(ids[idx])
        dprHint = displayDevicePixelRatio(ids[idx])
    case "region":
        let l = paramDouble(params, "left") ?? 0
        let t = paramDouble(params, "top") ?? 0
        let w = paramDouble(params, "width") ?? 0
        let h = paramDouble(params, "height") ?? 0
        rect = CGRect(x: l, y: t, width: w, height: h)
        dprHint = displayDevicePixelRatio(CGMainDisplayID())
    case "window":
        let handle = paramInt(params, "handle") ?? 0
        windowID = CGWindowID(handle)
        listOption = [.optionIncludingWindow]
        rect = CGRect.null
        dprHint = displayDevicePixelRatio(CGMainDisplayID())
    default:
        throw HelperError.generic("unknown capture kind: \(kind)")
    }

    guard let image = CGWindowListCreateImage(rect, listOption, windowID, [.boundsIgnoreFraming]) else {
        throw HelperError.generic("capture failed (CGWindowListCreateImage returned nil)")
    }

    // Logical bounds covered by the image. For window/all captures CG reports the
    // pixel rect; derive logical bounds from the image and the DPR.
    let pxW = Double(image.width)
    let pxH = Double(image.height)
    var boundsRect = rect
    if rect.isInfinite || rect.isNull {
        boundsRect = virtualScreenBounds()
    }
    let dpr = boundsRect.size.width > 0 ? (pxW / Double(boundsRect.size.width)) : dprHint
    let effectiveDpr = dpr > 0 ? dpr : dprHint

    guard let b64 = pngBase64(from: image) else {
        throw HelperError.generic("failed to PNG-encode capture")
    }

    return [
        "pngBase64": b64,
        "bounds": [
            "left": Int(boundsRect.origin.x),
            "top": Int(boundsRect.origin.y),
            "width": Int(boundsRect.size.width > 0 ? boundsRect.size.width : pxW),
            "height": Int(boundsRect.size.height > 0 ? boundsRect.size.height : pxH)
        ],
        "devicePixelRatio": effectiveDpr
    ]
}
