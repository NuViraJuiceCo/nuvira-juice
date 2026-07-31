import Capacitor
import Contacts
import Foundation
import PassKit
import StripeApplePay
import UIKit

@objc(NativeApplePay)
public class NativeApplePayPlugin: CAPPlugin, CAPBridgedPlugin, ApplePayContextDelegate {
    public let identifier = "NativeApplePay"
    public let jsName = "NativeApplePay"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "confirmPayment", returnType: CAPPluginReturnPromise)
    ]

    private var pendingCall: CAPPluginCall?
    private var pendingClientSecret: String?
    private var pendingPaymentIntentId: String?
    private var applePayContext: STPApplePayContext?

    @objc public func isAvailable(_ call: CAPPluginCall) {
        let merchantIdentifier = resolveMerchantIdentifier(call)
        let deviceSupportsApplePay = StripeAPI.deviceSupportsApplePay()
        let canMakePayments = PKPaymentAuthorizationController.canMakePayments()
        let canMakeCardPayments = PKPaymentAuthorizationController.canMakePayments(usingNetworks: supportedNetworks())

        call.resolve([
            "available": deviceSupportsApplePay && canMakePayments && canMakeCardPayments && !merchantIdentifier.isEmpty,
            "deviceSupportsApplePay": deviceSupportsApplePay,
            "canMakePayments": canMakePayments,
            "canMakeCardPayments": canMakeCardPayments,
            "merchantIdentifierConfigured": !merchantIdentifier.isEmpty,
            "merchantIdentifier": merchantIdentifier
        ])
    }

    @objc public func confirmPayment(_ call: CAPPluginCall) {
        guard pendingCall == nil else {
            call.reject("Apple Pay is already in progress.", "APPLE_PAY_IN_PROGRESS")
            return
        }

        guard let clientSecret = call.getString("clientSecret"), !clientSecret.isEmpty else {
            call.reject("Missing PaymentIntent client secret.", "MISSING_CLIENT_SECRET")
            return
        }

        guard let publishableKey = call.getString("publishableKey"), publishableKey.hasPrefix("pk_") else {
            call.reject("Missing Stripe publishable key.", "MISSING_PUBLISHABLE_KEY")
            return
        }

        let merchantIdentifier = resolveMerchantIdentifier(call)
        guard !merchantIdentifier.isEmpty else {
            call.reject("Missing Apple Pay merchant identifier.", "MISSING_MERCHANT_IDENTIFIER")
            return
        }

        let amount = call.getDouble("total") ?? 0
        guard amount >= 0.5 else {
            call.reject("Apple Pay amount must be at least $0.50.", "INVALID_AMOUNT")
            return
        }

        guard StripeAPI.deviceSupportsApplePay(), PKPaymentAuthorizationController.canMakePayments(usingNetworks: supportedNetworks()) else {
            call.reject("Apple Pay is not available on this device.", "APPLE_PAY_UNAVAILABLE")
            return
        }

        StripeAPI.defaultPublishableKey = publishableKey
        pendingCall = call
        pendingClientSecret = clientSecret
        pendingPaymentIntentId = call.getString("paymentIntentId") ?? paymentIntentId(from: clientSecret)

        DispatchQueue.main.async {
            let request = StripeAPI.paymentRequest(
                withMerchantIdentifier: merchantIdentifier,
                country: "US",
                currency: "USD"
            )
            request.supportedNetworks = self.supportedNetworks()
            request.merchantCapabilities = [.capability3DS, .capabilityCredit, .capabilityDebit]
            request.billingContact = self.customerContact(from: call)
            request.paymentSummaryItems = [
                PKPaymentSummaryItem(
                    label: call.getString("merchantDisplayName") ?? "NuVira Juice Company",
                    amount: NSDecimalNumber(value: amount)
                )
            ]

            guard let context = STPApplePayContext(paymentRequest: request, delegate: self) else {
                self.rejectPendingCall("Apple Pay is not configured for this app.", code: "APPLE_PAY_CONFIGURATION_ERROR")
                return
            }

            self.applePayContext = context
            context.presentApplePay(on: self.bridge?.viewController ?? UIViewController())
        }
    }

    public func applePayContext(
        _ context: STPApplePayContext,
        didCreatePaymentMethod paymentMethod: StripeAPI.PaymentMethod,
        paymentInformation: PKPayment
    ) async throws -> String {
        guard let clientSecret = pendingClientSecret else {
            throw NativeApplePayError.missingClientSecret
        }
        return clientSecret
    }

    public func applePayContext(
        _ context: STPApplePayContext,
        didCompleteWith status: STPApplePayContext.PaymentStatus,
        error: Error?
    ) {
        switch status {
        case .success:
            pendingCall?.resolve([
                "status": "success",
                "paymentIntentId": pendingPaymentIntentId ?? ""
            ])
        case .userCancellation:
            pendingCall?.reject("Apple Pay was cancelled.", "USER_CANCELED", error)
        case .error:
            pendingCall?.reject(error?.localizedDescription ?? "Apple Pay failed.", "APPLE_PAY_FAILED", error)
        @unknown default:
            pendingCall?.reject("Apple Pay ended with an unknown status.", "APPLE_PAY_UNKNOWN_STATUS", error)
        }

        pendingCall = nil
        pendingClientSecret = nil
        pendingPaymentIntentId = nil
        applePayContext = nil
    }

    private func supportedNetworks() -> [PKPaymentNetwork] {
        return [.amex, .discover, .masterCard, .visa]
    }

    private func resolveMerchantIdentifier(_ call: CAPPluginCall) -> String {
        if let value = call.getString("merchantIdentifier"), !value.isEmpty {
            return value
        }
        return (Bundle.main.object(forInfoDictionaryKey: "NuViraApplePayMerchantIdentifier") as? String) ?? ""
    }

    private func paymentIntentId(from clientSecret: String) -> String? {
        return clientSecret.components(separatedBy: "_secret_").first
    }

    private func customerContact(from call: CAPPluginCall) -> PKContact? {
        let name = call.getString("customerName")?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let email = call.getString("customerEmail")?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let phone = call.getString("customerPhone")?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !name.isEmpty || !email.isEmpty || !phone.isEmpty else {
            return nil
        }

        let contact = PKContact()
        if !name.isEmpty {
            let components = name.split(separator: " ", maxSplits: 1).map(String.init)
            var personName = PersonNameComponents()
            personName.givenName = components.first
            personName.familyName = components.count > 1 ? components[1] : nil
            contact.name = personName
        }
        if !email.isEmpty {
            contact.emailAddress = email
        }
        if !phone.isEmpty {
            contact.phoneNumber = CNPhoneNumber(stringValue: phone)
        }
        return contact
    }

    private func rejectPendingCall(_ message: String, code: String) {
        pendingCall?.reject(message, code)
        pendingCall = nil
        pendingClientSecret = nil
        pendingPaymentIntentId = nil
        applePayContext = nil
    }
}

private enum NativeApplePayError: LocalizedError {
    case missingClientSecret

    var errorDescription: String? {
        switch self {
        case .missingClientSecret:
            return "Missing PaymentIntent client secret."
        }
    }
}
