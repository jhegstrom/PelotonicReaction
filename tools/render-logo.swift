// Render the existing orange PR brand mark as uploadable square app icons.
// Run from the repository root: swift -module-cache-path /tmp/pr-logo-swift-cache tools/render-logo.swift
import AppKit
import Foundation

for size in [512, 124] {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    let context = NSGraphicsContext(bitmapImageRep: bitmap)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    let canvas = CGFloat(size)
    context.cgContext.scaleBy(x: canvas / 512, y: canvas / 512)
    NSColor(srgbRed: 1, green: 152/255, blue: 90/255, alpha: 1).setFill()
    NSRect(x: 0, y: 0, width: 512, height: 512).fill()
    let font = NSFont.systemFont(ofSize: 300, weight: .heavy)
    let letters = NSMutableAttributedString(string: "PR", attributes: [.font: font, .kern: -22,
        .foregroundColor: NSColor(srgbRed: 23/255, green: 32/255, blue: 40/255, alpha: 1)])
    letters.addAttribute(.foregroundColor, value: NSColor.white, range: NSRange(location: 1, length: 1))
    let bounds = letters.size()
    // The web mark uses an eight-degree forward lean.
    context.cgContext.translateBy(x: 256, y: 256)
    context.cgContext.concatenate(CGAffineTransform(a: 1, b: 0, c: 0.14054, d: 1, tx: 0, ty: 0))
    letters.draw(at: NSPoint(x: -bounds.width / 2, y: -bounds.height / 2))
    NSGraphicsContext.restoreGraphicsState()
    let stem = "public/assets/pelotonicreaction-logo-\(size)"
    try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: stem + ".png"))
    try bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.95])!.write(to: URL(fileURLWithPath: stem + ".jpg"))
}
