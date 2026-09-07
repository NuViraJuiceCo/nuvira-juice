import AuthenticationServices
import Capacitor
import Foundation
import UIKit

@objc(NativeWebAuth)
public class NativeWebAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "NativeWebAuth"
    public let jsName = "NativeWebAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise)
    ]

    private var authenticationSession: ASWebAuthenticationSession?
    private var pendingCall: CAPPluginCall?

    @objc public func authenticate(_ call: CAPPluginCall) {
        guard pendingCall == nil else {
            call.reject("A secure sign-in is already in progress.", "AUTH_IN_PROGRESS")
            return
        }

        guard
            let rawURL = call.getString("url"),
            let url = URL(string: rawURL),
            let scheme = url.scheme?.lowercased(),
            scheme == "https",
            url.host?.lowercased() == "app.base44.com"
        else {
            call.reject("A valid secure sign-in URL is required.", "INVALID_AUTH_URL")
            return
        }

        guard call.getString("callbackScheme")?.lowercased() == "nuvira" else {
            call.reject("The secure sign-in callback is invalid.", "INVALID_CALLBACK_SCHEME")
            return
        }

        pendingCall = call
        DispatchQueue.main.async {
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: "nuvira"
            ) { [weak self] callbackURL, error in
                DispatchQueue.main.async {
                    self?.finish(callbackURL: callbackURL, error: error)
                }
            }
            session.presentationContextProvider = self
            // App sign-out cannot clear Safari's Base44 cookies. Isolate each
            // Google attempt so an earlier browser session cannot be reused.
            session.prefersEphemeralWebBrowserSession = url.path == "/api/apps/auth/login"
            self.authenticationSession = session

            guard session.start() else {
                self.authenticationSession = nil
                self.pendingCall = nil
                call.reject("Secure sign-in could not be opened.", "AUTH_START_FAILED")
                return
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        if let window = bridge?.viewController?.view.window {
            return window
        }

        if let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive }),
           let window = scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first {
            return window
        }

        return UIWindow()
    }

    private func finish(callbackURL: URL?, error: Error?) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        authenticationSession = nil

        if let callbackURL = callbackURL {
            guard callbackURL.scheme?.lowercased() == "nuvira" else {
                call.reject("Secure sign-in returned an unexpected callback.", "INVALID_AUTH_CALLBACK")
                return
            }
            call.resolve(["callbackUrl": callbackURL.absoluteString])
            return
        }

        if let authError = error as? ASWebAuthenticationSessionError,
           authError.code == .canceledLogin {
            call.reject("Sign-in was canceled.", "AUTH_CANCELED")
            return
        }

        call.reject("Secure sign-in did not complete.", "AUTH_FAILED", error)
    }
}
