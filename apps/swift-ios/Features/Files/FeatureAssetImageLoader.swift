import ImageIO
import UIKit

struct FeatureAssetImage {
    let url: URL
    let image: UIImage
}

@MainActor
enum FeatureAssetImageLoader {
    private static let cache: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 64
        cache.totalCostLimit = 32 * 1_024 * 1_024
        return cache
    }()

    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        return URLSession(configuration: configuration)
    }()

    static func load(
        url: URL,
        maxPixelSize: CGFloat? = nil,
        maximumBytes: Int? = nil
    ) async throws -> FeatureAssetImage {
        let cacheKey = NSString(
            string: "\(maxPixelSize.map(String.init) ?? "full")|\(url.absoluteString)"
        )
        if let cached = cache.object(forKey: cacheKey) {
            return FeatureAssetImage(url: url, image: cached)
        }

        let data: Data
        if url.scheme?.lowercased() == "data" {
            guard let comma = url.absoluteString.firstIndex(of: ","),
                  url.absoluteString[..<comma].lowercased().contains(";base64"),
                  let decoded = Data(
                      base64Encoded: String(
                          url.absoluteString[url.absoluteString.index(after: comma)...]
                      )
                  ) else {
                throw FeatureAssetPreviewFailure(
                    kind: .decoding,
                    message: "The embedded image data is invalid."
                )
            }
            data = decoded
        } else {
            let response: URLResponse
            (data, response) = try await session.data(from: url)
            if let response = response as? HTTPURLResponse,
               !(200 ... 299).contains(response.statusCode) {
                throw failure(forHTTPStatus: response.statusCode)
            }
        }
        guard maximumBytes.map({ data.count <= $0 }) ?? true else {
            throw FeatureAssetPreviewFailure(
                kind: .decoding,
                message: "The image is larger than the 64 MB preview limit."
            )
        }
        let decodedImage = await FeatureAssetImageDecoder().decode(
            data,
            maxPixelSize: maxPixelSize
        )
        try Task.checkCancellation()
        guard let decodedImage else {
            throw FeatureAssetPreviewFailure(
                kind: .decoding,
                message: "The file is not a supported image."
            )
        }
        let decoded = UIImage(cgImage: decodedImage)
        let cost = decoded.cgImage.map { $0.bytesPerRow * $0.height } ?? data.count
        cache.setObject(decoded, forKey: cacheKey, cost: cost)
        return FeatureAssetImage(url: url, image: decoded)
    }

    private static func failure(forHTTPStatus status: Int) -> FeatureAssetPreviewFailure {
        let kind: FeatureAssetPreviewFailureKind
        switch status {
        case 401, 403: kind = .authorization
        case 404, 410: kind = .missingFile
        default: kind = .query
        }
        return FeatureAssetPreviewFailure(
            kind: kind,
            message: "The image server returned HTTP \(status)."
        )
    }
}

private actor FeatureAssetImageDecoder {
    func decode(
        _ data: Data,
        maxPixelSize: CGFloat?
    ) -> CGImage? {
        let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else {
            return nil
        }
        let pixelSize: CGFloat
        if let maxPixelSize {
            pixelSize = maxPixelSize
        } else if let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil)
            as? [CFString: Any],
                  let width = properties[kCGImagePropertyPixelWidth] as? NSNumber,
                  let height = properties[kCGImagePropertyPixelHeight] as? NSNumber {
            pixelSize = max(CGFloat(truncating: width), CGFloat(truncating: height))
        } else {
            pixelSize = 0
        }
        guard pixelSize > 0 else {
            return CGImageSourceCreateImageAtIndex(source, 0, nil)
        }
        let options = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: pixelSize,
        ] as CFDictionary
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options) else {
            return nil
        }
        return image
    }
}
