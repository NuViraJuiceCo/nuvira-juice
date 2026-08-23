import ActivityKit
import Foundation

@available(iOS 16.2, *)
struct NuViraDeliveryAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var status: String
        var statusLabel: String
        var etaStartEpoch: Int
        var etaEndEpoch: Int
        var stopsAhead: Int
        var stopsDelivered: Int
        var stopsTotal: Int
        var progressPercent: Int
        var updatedAtEpoch: Int
        var isDelayed: Bool
        var message: String
    }

    var orderId: String
    var orderNumber: String
    var deepLink: String
}
