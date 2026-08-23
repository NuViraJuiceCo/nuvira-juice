import ActivityKit
import Capacitor
import CoreLocation
import Foundation

enum NuViraPendingNavigationStore {
    private static let storageKey = "nuvira_pending_delivery_navigation_v1"
    private static let allowedPathPattern = #"^/(order-tracker/[^/?#]+|account/orders)(?:[/?#].*)?$"#

    static func capture(url: URL) {
        guard allowedRoute(from: url) != nil else { return }
        UserDefaults.standard.set(url.absoluteString, forKey: storageKey)
    }

    static func consume() -> String? {
        let value = UserDefaults.standard.string(forKey: storageKey)
        UserDefaults.standard.removeObject(forKey: storageKey)
        return value
    }

    private static func allowedRoute(from url: URL) -> String? {
        let route: String
        if url.scheme?.lowercased() == "nuvira", url.host?.lowercased() == "open" {
            guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
                  let path = components.queryItems?.first(where: { $0.name == "path" })?.value else { return nil }
            route = path
        } else if url.scheme?.lowercased() == "https",
                  ["nuvirajuice.com", "www.nuvirajuice.com"].contains(url.host?.lowercased() ?? "") {
            route = url.path + (url.query.map { "?\($0)" } ?? "") + (url.fragment.map { "#\($0)" } ?? "")
        } else {
            return nil
        }
        return route.range(of: allowedPathPattern, options: .regularExpression) == nil ? nil : route
    }
}

@objc(DeliveryLiveActivity)
public class NativeDeliveryLiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DeliveryLiveActivity"
    public let jsName = "DeliveryLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumePendingNavigation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startRouteTracking", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopRouteTracking", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getRouteTrackingStatus", returnType: CAPPluginReturnPromise)
    ]

    private var monitorTasks: [Task<Void, Never>] = []
    private var monitoredActivityIds = Set<String>()
    private let routeTracker = NuViraDriverRouteTracker()

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

    @objc public func consumePendingNavigation(_ call: CAPPluginCall) {
        if let url = NuViraPendingNavigationStore.consume() {
            call.resolve(["url": url])
        } else {
            call.resolve(["url": NSNull()])
        }
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

    @objc public func startRouteTracking(_ call: CAPPluginCall) {
        routeTracker.start(call)
    }

    @objc public func stopRouteTracking(_ call: CAPPluginCall) {
        routeTracker.stop(reason: "operator_stopped")
        call.resolve(routeTracker.status())
    }

    @objc public func getRouteTrackingStatus(_ call: CAPPluginCall) {
        call.resolve(routeTracker.status())
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
            statusLabel: string(snapshot, "statusLabel", maxLength: 80, fallback: "Out for Delivery"),
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

private final class NuViraDriverRouteTracker: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private let uploadQueue = DispatchQueue(label: "com.nuvira.driver-route-upload", qos: .utility)
    private var pendingCall: CAPPluginCall?
    private var endpoint: URL?
    private var sessionId = ""
    private var sessionToken = ""
    private var sequence = 0
    private var active = false
    private var lastUploadAt: Date?
    private var minimumUpdateInterval: TimeInterval = 30
    private var lastError = ""

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager.distanceFilter = 75
        manager.activityType = .automotiveNavigation
        manager.pausesLocationUpdatesAutomatically = false
    }

    func start(_ call: CAPPluginCall) {
        guard let candidateEndpoint = URL(string: call.getString("endpoint") ?? ""),
              candidateEndpoint.scheme?.lowercased() == "https",
              ["nuvirajuice.com", "www.nuvirajuice.com", "nuvira-fresh-flow.base44.app"].contains(candidateEndpoint.host?.lowercased() ?? ""),
              candidateEndpoint.path == "/functions/getAdminOperationsDashboardSummary" else {
            call.reject("The route tracking endpoint is invalid.", "INVALID_ROUTE_ENDPOINT")
            return
        }
        let nextSessionId = clean(call.getString("sessionId"), max: 180)
        let nextToken = clean(call.getString("sessionToken"), max: 256)
        guard !nextSessionId.isEmpty, !nextToken.isEmpty else {
            call.reject("The route session is invalid.", "INVALID_ROUTE_SESSION")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.stop(reason: "superseded")
            self.endpoint = candidateEndpoint
            self.sessionId = nextSessionId
            self.sessionToken = nextToken
            self.minimumUpdateInterval = TimeInterval(max(15, min(120, call.getInt("minimumUpdateIntervalSeconds") ?? 30)))
            self.manager.distanceFilter = CLLocationDistance(max(25, min(500, call.getInt("minimumDistanceMeters") ?? 75)))

            switch self.manager.authorizationStatus {
            case .authorizedAlways, .authorizedWhenInUse:
                self.begin(call)
            case .notDetermined:
                self.pendingCall = call
                self.manager.requestWhenInUseAuthorization()
            case .denied, .restricted:
                self.clearCredentials()
                call.reject("Location access is required while an active delivery route is being tracked.", "LOCATION_PERMISSION_REQUIRED")
            @unknown default:
                self.clearCredentials()
                call.reject("Location access is unavailable.", "LOCATION_PERMISSION_UNAVAILABLE")
            }
        }
    }

    func stop(reason: String) {
        manager.stopUpdatingLocation()
        active = false
        lastError = reason == "operator_stopped" || reason == "superseded" ? "" : clean(reason, max: 80)
        pendingCall = nil
        clearCredentials()
    }

    func status() -> JSObject {
        var result: JSObject = [
            "platform": "ios",
            "active": active,
            "authorization": authorizationLabel(manager.authorizationStatus),
            "lastSampleAt": lastUploadAt?.iso8601String ?? NSNull(),
            "reason": lastError.isEmpty ? NSNull() : lastError
        ]
        if active { result["sessionId"] = sessionId }
        return result
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard let call = pendingCall else { return }
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            pendingCall = nil
            begin(call)
        case .denied, .restricted:
            pendingCall = nil
            clearCredentials()
            call.reject("Location access is required while an active delivery route is being tracked.", "LOCATION_PERMISSION_REQUIRED")
        default:
            break
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard active, let location = locations.last, location.horizontalAccuracy >= 0 else { return }
        let now = Date()
        if let previous = lastUploadAt, now.timeIntervalSince(previous) < minimumUpdateInterval { return }
        lastUploadAt = now
        sequence += 1
        upload(location: location, sequence: sequence)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        lastError = "location_update_unavailable"
    }

    private func begin(_ call: CAPPluginCall) {
        guard endpoint != nil, !sessionId.isEmpty, !sessionToken.isEmpty else {
            call.reject("The route session is unavailable.", "INVALID_ROUTE_SESSION")
            return
        }
        if #available(iOS 9.0, *) {
            manager.allowsBackgroundLocationUpdates = true
        }
        if #available(iOS 11.0, *) {
            manager.showsBackgroundLocationIndicator = true
        }
        active = true
        lastError = ""
        manager.startUpdatingLocation()
        call.resolve(status())
    }

    private func upload(location: CLLocation, sequence: Int) {
        guard let endpoint, !sessionId.isEmpty, !sessionToken.isEmpty else { return }
        let body: [String: Any] = [
            "gateway_action": "manageDriverRouteTelemetry",
            "payload": [
                "action": "ingest",
                "session_id": sessionId,
                "sequence": sequence,
                "latitude": location.coordinate.latitude,
                "longitude": location.coordinate.longitude,
                "accuracy_meters": location.horizontalAccuracy,
                "captured_at": location.timestamp.iso8601String
            ]
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        let token = sessionToken
        uploadQueue.async { [weak self] in
            var request = URLRequest(url: endpoint)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("69d48d0c39891f7945481152", forHTTPHeaderField: "X-App-Id")
            request.setValue(token, forHTTPHeaderField: "X-Route-Session-Token")
            request.httpBody = data
            let configuration = URLSessionConfiguration.ephemeral
            configuration.waitsForConnectivity = true
            URLSession(configuration: configuration).dataTask(with: request) { _, response, _ in
                let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
                DispatchQueue.main.async {
                    guard let self else { return }
                    if statusCode == 410 {
                        self.stop(reason: "route_session_ended")
                    } else if !(200...299).contains(statusCode) {
                        self.lastError = "route_update_unavailable"
                    } else {
                        self.lastError = ""
                    }
                }
            }.resume()
        }
    }

    private func clearCredentials() {
        endpoint = nil
        sessionId = ""
        sessionToken = ""
        sequence = 0
    }

    private func clean(_ value: String?, max: Int) -> String {
        String((value ?? "").trimmingCharacters(in: .whitespacesAndNewlines).prefix(max))
    }

    private func authorizationLabel(_ status: CLAuthorizationStatus) -> String {
        switch status {
        case .authorizedAlways: return "always"
        case .authorizedWhenInUse: return "when_in_use"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "not_determined"
        @unknown default: return "unknown"
        }
    }
}

private extension Date {
    var iso8601String: String { ISO8601DateFormatter().string(from: self) }
}

private struct SnapshotError: Error {
    let message: String
    init(_ message: String) { self.message = message }
}

private extension Data {
    var hexString: String { map { String(format: "%02x", $0) }.joined() }
}
