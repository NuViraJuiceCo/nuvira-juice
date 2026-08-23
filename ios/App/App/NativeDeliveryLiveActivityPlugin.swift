import ActivityKit
import Capacitor
import Foundation

@objc(DeliveryLiveActivity)
public class NativeDeliveryLiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DeliveryLiveActivity"
    public let jsName = "DeliveryLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise)
    ]

    private var monitorTasks: [Task<Void, Never>] = []
    private var monitoredActivityIds = Set<String>()

    public override func load() {
        super.load()
        guard #available(iOS 16.2, *) else { return }
        monitorExistingActivities()
        if #available(iOS 17.2, *) {
            monitorTasks.append(Task { [weak self] in
                for await token in Activity<NuViraDeliveryAttributes>.pushToStartTokenUpdates {
                    guard !Task.isCancelled else { return }
                    self?.notifyListeners("deliveryLiveActivityCapabilityChanged", data: [
                        "available": true,
                        "pushToStartToken": token.hexString,
                        "apnsEnvironment": Self.apnsEnvironment
                    ])
                }
            })
            monitorTasks.append(Task { [weak self] in
                for await activity in Activity<NuViraDeliveryAttributes>.activityUpdates {
                    guard !Task.isCancelled else { return }
                    self?.monitorPushToken(for: activity)
                }
            })
        }
    }

    deinit {
        monitorTasks.forEach { $0.cancel() }
    }

    @objc public func isAvailable(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["available": false, "reason": "ios_16_2_required"])
            return
        }

        let authorization = ActivityAuthorizationInfo()
        var response: JSObject = [
            "available": authorization.areActivitiesEnabled,
            "reason": authorization.areActivitiesEnabled ? NSNull() : "live_activities_disabled",
            "apnsEnvironment": Self.apnsEnvironment,
            "activeActivities": activeActivityDescriptors()
        ]
        if #available(iOS 17.2, *), let token = Activity<NuViraDeliveryAttributes>.pushToStartToken {
            response["pushToStartToken"] = token.hexString
        }
        call.resolve(response)
    }

    @objc public func sync(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.reject("Live Activities require iOS 16.2 or later.", "LIVE_ACTIVITY_UNAVAILABLE")
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            call.reject("Live Activities are disabled for NuVira.", "LIVE_ACTIVITY_DISABLED")
            return
        }
        guard let snapshot = call.getObject("snapshot") else {
            call.reject("A delivery snapshot is required.", "SNAPSHOT_REQUIRED")
            return
        }

        do {
            let parsed = try parseSnapshot(snapshot)
            Task { [weak self] in
                guard let self else { return }
                if let activity = Activity<NuViraDeliveryAttributes>.activities.first(where: { $0.attributes.orderId == parsed.attributes.orderId }) {
                    await activity.update(parsed.content)
                    monitorPushToken(for: activity)
                    call.resolve(activityDescriptor(activity))
                    return
                }

                do {
                    let activity = try Activity.request(
                        attributes: parsed.attributes,
                        content: parsed.content,
                        pushType: .token
                    )
                    monitorPushToken(for: activity)
                    call.resolve(activityDescriptor(activity))
                } catch {
                    call.reject("NuVira could not start the delivery Live Activity.", "LIVE_ACTIVITY_START_FAILED")
                }
            }
        } catch let error as SnapshotError {
            call.reject(error.message, "INVALID_DELIVERY_SNAPSHOT")
        } catch {
            call.reject("The delivery snapshot is invalid.", "INVALID_DELIVERY_SNAPSHOT")
        }
    }

    @objc public func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["success": true, "ended": 0])
            return
        }
        guard let snapshot = call.getObject("snapshot") else {
            call.reject("A delivery snapshot is required.", "SNAPSHOT_REQUIRED")
            return
        }

        do {
            let parsed = try parseSnapshot(snapshot)
            let matching = Activity<NuViraDeliveryAttributes>.activities.filter { $0.attributes.orderId == parsed.attributes.orderId }
            Task { [weak self] in
                for activity in matching {
                    await activity.end(parsed.content, dismissalPolicy: .after(Date().addingTimeInterval(3600)))
                    self?.notifyListeners("deliveryLiveActivityEnded", data: [
                        "orderId": parsed.attributes.orderId,
                        "activityId": activity.id
                    ])
                }
                call.resolve([
                    "success": true,
                    "ended": matching.count,
                    "activityId": matching.first?.id ?? ""
                ])
            }
        } catch let error as SnapshotError {
            call.reject(error.message, "INVALID_DELIVERY_SNAPSHOT")
        } catch {
            call.reject("The delivery snapshot is invalid.", "INVALID_DELIVERY_SNAPSHOT")
        }
    }

    @available(iOS 16.2, *)
    private func monitorExistingActivities() {
        Activity<NuViraDeliveryAttributes>.activities.forEach { monitorPushToken(for: $0) }
    }

    @available(iOS 16.2, *)
    private func monitorPushToken(for activity: Activity<NuViraDeliveryAttributes>) {
        guard monitoredActivityIds.insert(activity.id).inserted else { return }
        monitorTasks.append(Task { [weak self] in
            for await token in activity.pushTokenUpdates {
                guard !Task.isCancelled else { return }
                self?.notifyListeners("deliveryLiveActivityTokenChanged", data: [
                    "orderId": activity.attributes.orderId,
                    "activityId": activity.id,
                    "activityPushToken": token.hexString,
                    "apnsEnvironment": Self.apnsEnvironment
                ])
            }
        })
    }

    @available(iOS 16.2, *)
    private func activeActivityDescriptors() -> JSArray {
        Activity<NuViraDeliveryAttributes>.activities.map { activityDescriptor($0) }
    }

    @available(iOS 16.2, *)
    private func activityDescriptor(_ activity: Activity<NuViraDeliveryAttributes>) -> JSObject {
        var descriptor: JSObject = [
            "success": true,
            "orderId": activity.attributes.orderId,
            "activityId": activity.id,
            "apnsEnvironment": Self.apnsEnvironment
        ]
        if let token = activity.pushToken {
            descriptor["activityPushToken"] = token.hexString
        }
        return descriptor
    }

    @available(iOS 16.2, *)
    private func parseSnapshot(_ snapshot: JSObject) throws -> (
        attributes: NuViraDeliveryAttributes,
        content: ActivityContent<NuViraDeliveryAttributes.ContentState>
    ) {
        let orderId = string(snapshot, "orderId", maxLength: 160)
        let orderNumber = string(snapshot, "orderNumber", maxLength: 80)
        guard !orderId.isEmpty, !orderNumber.isEmpty else {
            throw SnapshotError("Order information is missing from the delivery snapshot.")
        }
        let deepLink = safeDeepLink(string(snapshot, "deepLink", maxLength: 400), orderNumber: orderNumber)
        let state = NuViraDeliveryAttributes.ContentState(
            status: string(snapshot, "status", maxLength: 40, fallback: "out_for_delivery"),
            statusLabel: string(snapshot, "statusLabel", maxLength: 80, fallback: "On the way"),
            etaStartEpoch: integer(snapshot, "etaStartEpoch"),
            etaEndEpoch: integer(snapshot, "etaEndEpoch"),
            stopsAhead: integer(snapshot, "stopsAhead"),
            stopsDelivered: integer(snapshot, "stopsDelivered"),
            stopsTotal: integer(snapshot, "stopsTotal"),
            progressPercent: min(100, integer(snapshot, "progressPercent")),
            updatedAtEpoch: integer(snapshot, "updatedAtEpoch", fallback: Int(Date().timeIntervalSince1970)),
            isDelayed: (snapshot["isDelayed"] as? Bool) == true,
            message: string(snapshot, "message", maxLength: 160)
        )
        let staleEpoch = integer(snapshot, "staleAtEpoch")
        let staleDate = staleEpoch > 0 ? Date(timeIntervalSince1970: TimeInterval(staleEpoch)) : nil
        return (
            NuViraDeliveryAttributes(orderId: orderId, orderNumber: orderNumber, deepLink: deepLink),
            ActivityContent(state: state, staleDate: staleDate)
        )
    }

    private func string(_ object: JSObject, _ key: String, maxLength: Int, fallback: String = "") -> String {
        let value = String(describing: object[key] ?? fallback)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        return String(value.prefix(maxLength))
    }

    private func integer(_ object: JSObject, _ key: String, fallback: Int = 0) -> Int {
        if let value = object[key] as? Int { return max(0, value) }
        if let value = object[key] as? NSNumber { return max(0, value.intValue) }
        return max(0, Int(String(describing: object[key] ?? "")) ?? fallback)
    }

    private func safeDeepLink(_ value: String, orderNumber: String) -> String {
        if value.range(of: #"^/(order-tracker/[^/?#]+|account/orders)(?:[/?#].*)?$"#, options: .regularExpression) != nil {
            return value
        }
        return "/order-tracker/\(orderNumber.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? orderNumber)"
    }

    private static var apnsEnvironment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }
}

private struct SnapshotError: Error {
    let message: String
    init(_ message: String) { self.message = message }
}

private extension Data {
    var hexString: String { map { String(format: "%02x", $0) }.joined() }
}
