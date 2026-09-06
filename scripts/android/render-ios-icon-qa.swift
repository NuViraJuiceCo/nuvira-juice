// Read-only asset QA: render the existing iOS source through rounded-square
// approximations at common icon sizes. This does not replace shipped artwork.
import AppKit
import ImageIO
let input = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
let source = CGImageSourceCreateWithURL(input as CFURL, nil)!
let image = CGImageSourceCreateImageAtIndex(source, 0, nil)!
precondition(image.width == 1024 && image.height == 1024)
var files: [String] = []
for size in [20, 29, 40, 58, 60, 76, 80, 87, 120, 152, 167, 180, 1024] {
    let canvas = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
        bytesPerRow: size * 4, space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    let bounds = CGRect(x: 0, y: 0, width: size, height: size)
    let radius = CGFloat(size) * 0.225
    canvas.addPath(CGPath(roundedRect: bounds, cornerWidth: radius, cornerHeight: radius, transform: nil))
    canvas.clip()
    canvas.interpolationQuality = .high
    canvas.draw(image, in: bounds)
    let png = NSBitmapImageRep(cgImage: canvas.makeImage()!).representation(using: .png, properties: [:])!
    let name = "ios-icon-\(size).png"
    try png.write(to: output.appendingPathComponent(name))
    files.append(name)
}
print("iOS original source retained; 13 rounded-square mask previews rendered: \(files.joined(separator: ", "))")
print("These are geometric QA previews, not physical-device or App Store evidence.")
