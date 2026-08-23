import ActivityKit
import SwiftUI
import WidgetKit

@available(iOSApplicationExtension 16.2, *)
struct NuViraDeliveryActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: NuViraDeliveryAttributes.self) { context in
            DeliveryLockScreenView(context: context)
                .activityBackgroundTint(Color.nuviraInk)
                .activitySystemActionForegroundColor(.white)
                .widgetURL(deepLinkURL(context.attributes.deepLink))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    NuViraBrandLockup(size: .expanded)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    EtaCompactView(state: context.state)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.statusLabel)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 8) {
                        DeliveryProgressTrack(value: progress(context.state))
                        HStack {
                            Label(stopsLabel(context.state), systemImage: "truck.box.fill")
                            Spacer()
                            Text("Order \(context.attributes.orderNumber)")
                        }
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.white.opacity(0.7))
                    }
                }
            } compactLeading: {
                NuViraBrandLockup(size: .compact)
            } compactTrailing: {
                Text(compactStopLabel(context.state))
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
            } minimal: {
                NuViraBrandLockup(size: .minimal)
            }
            .widgetURL(deepLinkURL(context.attributes.deepLink))
            .keylineTint(Color.nuviraLime)
        }
    }
}

@available(iOSApplicationExtension 16.2, *)
private struct DeliveryLockScreenView: View {
    let context: ActivityViewContext<NuViraDeliveryAttributes>

    var body: some View {
        VStack(spacing: 0) {
            Color.clear.frame(height: 14)

            VStack(spacing: 9) {
                HStack(alignment: .top) {
                    NuViraBrandLockup(size: .lockScreen)
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("ORDER \(context.attributes.orderNumber)")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.white.opacity(0.48))
                        Text(context.state.statusLabel)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Color.nuviraLime)
                    }
                }

                HStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("EXPECTED ARRIVAL")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.white.opacity(0.48))
                        EtaWindowView(state: context.state)
                    }
                    Spacer()
                    StopsAheadView(state: context.state)
                }

                VStack(spacing: 5) {
                    DeliveryProgressTrack(value: progress(context.state))
                    HStack {
                        Label(context.state.message, systemImage: "location.fill")
                            .lineLimit(1)
                        Spacer()
                        Text("Updated \(relativeUpdate(context.state.updatedAtEpoch))")
                    }
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.white.opacity(0.55))
                }
            }

            Color.clear.frame(height: 14)
        }
        .padding(.horizontal, 18)
    }
}

@available(iOSApplicationExtension 16.2, *)
private struct DeliveryProgressTrack: View {
    let value: Double

    var body: some View {
        GeometryReader { proxy in
            let clamped = min(max(value, 0), 1)
            let markerWidth: CGFloat = 30
            let markerHeight: CGFloat = 20
            let travel = max(0, proxy.size.width - markerWidth)

            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.white.opacity(0.12))
                    .frame(height: 5)
                Capsule()
                    .fill(Color.nuviraLime)
                    .frame(width: proxy.size.width * clamped, height: 5)
                ZStack {
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(Color.nuviraLime)
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .stroke(Color.nuviraInk, lineWidth: 2)
                    Image(systemName: "car.side.fill")
                        .font(.system(size: 14, weight: .bold))
                        .scaleEffect(x: -1, y: 1)
                        .foregroundStyle(Color.nuviraInk)
                }
                .frame(width: markerWidth, height: markerHeight)
                .offset(x: travel * clamped)
            }
            .frame(maxHeight: .infinity)
        }
        .frame(height: 20)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Delivery route progress")
        .accessibilityValue("\(Int(min(max(value, 0), 1) * 100)) percent")
    }
}

@available(iOSApplicationExtension 16.2, *)
private struct NuViraBrandLockup: View {
    enum Size {
        case minimal
        case compact
        case expanded
        case lockScreen

        var frame: CGSize {
            switch self {
            case .minimal: return CGSize(width: 20, height: 20)
            case .compact: return CGSize(width: 24, height: 24)
            case .expanded: return CGSize(width: 40, height: 40)
            case .lockScreen: return CGSize(width: 36, height: 36)
            }
        }

        var cornerRadius: CGFloat {
            switch self {
            case .minimal, .compact: return 6
            case .expanded: return 10
            case .lockScreen: return 10
            }
        }

        var assetName: String {
            switch self {
            case .minimal, .compact: return "NuViraDeliveryAppLogoSmall"
            case .expanded, .lockScreen: return "NuViraDeliveryAppLogo"
            }
        }
    }

    let size: Size

    var body: some View {
        logoImage
            .scaledToFill()
            .frame(width: size.frame.width, height: size.frame.height)
            .clipShape(RoundedRectangle(cornerRadius: size.cornerRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: size.cornerRadius, style: .continuous)
                    .stroke(Color.white.opacity(0.14), lineWidth: 0.5)
            }
            .privacySensitive(false)
            .unredacted()
            .accessibilityLabel("NuVira Juice Company")
    }

    @ViewBuilder
    private var logoImage: some View {
        if #available(iOSApplicationExtension 18.0, *) {
            Image(size.assetName)
                .resizable()
                .renderingMode(.original)
                .interpolation(.high)
                .widgetAccentedRenderingMode(.fullColor)
        } else {
            Image(size.assetName)
                .resizable()
                .renderingMode(.original)
                .interpolation(.high)
        }
    }
}

@available(iOSApplicationExtension 16.2, *)
private struct EtaWindowView: View {
    let state: NuViraDeliveryAttributes.ContentState

    var body: some View {
        if state.status == "delivered" {
            Text("Delivered")
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
        } else if state.etaStartEpoch > 0 && state.etaEndEpoch > 0 {
            Text("\(time(state.etaStartEpoch))-\(time(state.etaEndEpoch))")
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
        } else {
            Text("Updating")
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
        }
    }
}

@available(iOSApplicationExtension 16.2, *)
private struct EtaCompactView: View {
    let state: NuViraDeliveryAttributes.ContentState

    var body: some View {
        VStack(alignment: .trailing, spacing: 1) {
            Text(state.status == "delivered" ? "Complete" : compactStopLabel(state))
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(Color.nuviraLime)
            Text(state.status == "delivered" ? "Delivered" : "stops ahead")
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(.white.opacity(0.5))
        }
    }
}

@available(iOSApplicationExtension 16.2, *)
private struct StopsAheadView: View {
    let state: NuViraDeliveryAttributes.ContentState

    var body: some View {
        VStack(alignment: .trailing, spacing: 3) {
            Text(state.stopsAhead == 0 ? "ROUTE POSITION" : "STOPS AHEAD")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(.white.opacity(0.48))
            Text(state.stopsAhead == 0 ? "You're next" : "\(state.stopsAhead)")
                .font(.system(size: state.stopsAhead == 0 ? 17 : 26, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
        }
    }
}

@available(iOSApplicationExtension 16.2, *)
private func progress(_ state: NuViraDeliveryAttributes.ContentState) -> Double {
    min(1, max(0, Double(state.progressPercent) / 100))
}

@available(iOSApplicationExtension 16.2, *)
private func compactStopLabel(_ state: NuViraDeliveryAttributes.ContentState) -> String {
    state.status == "delivered" ? "Done" : "\(state.stopsAhead)"
}

@available(iOSApplicationExtension 16.2, *)
private func stopsLabel(_ state: NuViraDeliveryAttributes.ContentState) -> String {
    state.status == "delivered"
        ? "Delivery complete"
        : state.stopsAhead == 0
            ? "Your stop is next"
            : "\(state.stopsAhead) stop\(state.stopsAhead == 1 ? "" : "s") ahead"
}

@available(iOSApplicationExtension 16.2, *)
private func time(_ epoch: Int) -> String {
    guard epoch > 0 else { return "--" }
    return Date(timeIntervalSince1970: TimeInterval(epoch)).formatted(date: .omitted, time: .shortened)
}

@available(iOSApplicationExtension 16.2, *)
private func relativeUpdate(_ epoch: Int) -> String {
    guard epoch > 0 else { return "now" }
    let seconds = max(0, Int(Date().timeIntervalSince1970) - epoch)
    if seconds < 60 { return "now" }
    return "\(seconds / 60)m ago"
}

@available(iOSApplicationExtension 16.2, *)
private func deepLinkURL(_ path: String) -> URL? {
    var components = URLComponents()
    components.scheme = "nuvira"
    components.host = "open"
    components.queryItems = [URLQueryItem(name: "path", value: path)]
    return components.url
}

private extension Color {
    static let nuviraInk = Color(red: 0.02, green: 0.18, blue: 0.13)
    static let nuviraLime = Color(red: 0.67, green: 0.91, blue: 0.34)
}
