import AppKit

let image = NSImage(size: NSSize(width: 1024, height: 1024))
image.lockFocus()
NSColor(calibratedRed: 0.055, green: 0.11, blue: 0.105, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 64, y: 64, width: 896, height: 896), xRadius: 195, yRadius: 195).fill()
NSColor(calibratedRed: 0.4, green: 0.87, blue: 0.72, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 431, y: 248, width: 162, height: 528), xRadius: 34, yRadius: 34).fill()
NSBezierPath(roundedRect: NSRect(x: 248, y: 431, width: 528, height: 162), xRadius: 34, yRadius: 34).fill()
image.unlockFocus()
guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
      let png = bitmap.representation(using: .png, properties: [:]) else { fatalError("Cannot render app icon") }
try png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
