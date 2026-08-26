package com.nuvirajuice.app;

import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.wallet.IsReadyToPayRequest;
import com.google.android.gms.wallet.PaymentsClient;
import com.google.android.gms.wallet.Wallet;
import com.google.android.gms.wallet.WalletConstants;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Native Google Pay bridge for NuVira's Capacitor Android app.
 *
 * The web checkout keeps Stripe Express Checkout. Android uses Stripe's native
 * GooglePayLauncher because wallet popups have limited support in app webviews.
 * Payment amounts remain server-authoritative in the existing PaymentIntent.
 */
@CapacitorPlugin(name = "NativeGooglePay")
public class NativeGooglePayPlugin extends Plugin {
    @PluginMethod
    public void isAvailable(PluginCall call) {
        String publishableKey = clean(call.getString("publishableKey"), 256);
        if (!validPublishableKey(publishableKey)) {
            resolveAvailability(call, false, "publishable_key_unavailable");
            return;
        }

        try {
            PaymentsClient paymentsClient = Wallet.getPaymentsClient(
                getActivity(),
                new Wallet.WalletOptions.Builder()
                    .setEnvironment(walletEnvironment(publishableKey))
                    .build()
            );
            IsReadyToPayRequest request = IsReadyToPayRequest.fromJson(readyToPayRequestJson().toString());
            if (request == null) {
                resolveAvailability(call, false, "wallet_readiness_request_unavailable");
                return;
            }

            paymentsClient.isReadyToPay(request).addOnCompleteListener(task -> {
                if (!task.isSuccessful()) {
                    resolveAvailability(call, false, "wallet_readiness_check_failed");
                    return;
                }
                resolveAvailability(call, Boolean.TRUE.equals(task.getResult()),
                    Boolean.TRUE.equals(task.getResult()) ? null : "google_pay_not_ready");
            });
        } catch (Exception error) {
            resolveAvailability(call, false, "native_google_pay_unavailable");
        }
    }

    @PluginMethod
    public void confirmPayment(PluginCall call) {
        String clientSecret = clean(call.getString("clientSecret"), 512);
        String publishableKey = clean(call.getString("publishableKey"), 256);
        if (!validClientSecret(clientSecret)) {
            call.reject("A valid PaymentIntent client secret is required.", "INVALID_CLIENT_SECRET");
            return;
        }
        if (!validPublishableKey(publishableKey)) {
            call.reject("A valid Stripe publishable key is required.", "INVALID_PUBLISHABLE_KEY");
            return;
        }
        try {
            Intent intent = new Intent(getContext(), NativeGooglePayActivity.class)
                .putExtra(NativeGooglePayActivity.EXTRA_PAYMENT_INTENT_REFERENCE, clientSecret)
                .putExtra(NativeGooglePayActivity.EXTRA_PUBLISHABLE_KEY, publishableKey);
            startActivityForResult(call, intent, "handleGooglePayResult");
        } catch (Exception error) {
            call.reject("Google Pay could not be opened. Card checkout remains available.", "GOOGLE_PAY_LAUNCH_FAILED");
        }
    }

    @ActivityCallback
    private void handleGooglePayResult(PluginCall call, ActivityResult activityResult) {
        if (call == null) return;
        Intent data = activityResult.getData();
        String status = data == null ? "failed" : clean(data.getStringExtra(NativeGooglePayActivity.EXTRA_STATUS), 40);
        if ("success".equals(status)) {
            JSObject response = new JSObject();
            response.put("status", "success");
            response.put("platform", "android");
            call.resolve(response);
            return;
        }
        if ("canceled".equals(status)) {
            call.reject("Google Pay was canceled.", "USER_CANCELED");
            return;
        }

        call.reject("Google Pay could not complete the payment. Please try again or use a card.", "GOOGLE_PAY_FAILED");
    }

    private static JSONObject readyToPayRequestJson() throws Exception {
        JSONObject cardParameters = new JSONObject()
            .put("allowedAuthMethods", new JSONArray()
                .put("PAN_ONLY")
                .put("CRYPTOGRAM_3DS"))
            .put("allowedCardNetworks", new JSONArray()
                .put("AMEX")
                .put("DISCOVER")
                .put("MASTERCARD")
                .put("VISA"));

        JSONObject cardMethod = new JSONObject()
            .put("type", "CARD")
            .put("parameters", cardParameters);

        return new JSONObject()
            .put("apiVersion", 2)
            .put("apiVersionMinor", 0)
            .put("existingPaymentMethodRequired", true)
            .put("allowedPaymentMethods", new JSONArray().put(cardMethod));
    }

    private static void resolveAvailability(PluginCall call, boolean available, String reason) {
        JSObject result = new JSObject();
        result.put("available", available);
        result.put("platform", "android");
        result.put("native", true);
        if (reason != null) result.put("reason", reason);
        call.resolve(result);
    }

    private static int walletEnvironment(String publishableKey) {
        return publishableKey.startsWith("pk_live_")
            ? WalletConstants.ENVIRONMENT_PRODUCTION
            : WalletConstants.ENVIRONMENT_TEST;
    }

    private static boolean validPublishableKey(String value) {
        return value.startsWith("pk_live_") || value.startsWith("pk_test_");
    }

    private static boolean validClientSecret(String value) {
        return value.startsWith("pi_") && value.contains("_secret_") && value.length() <= 512;
    }

    private static String clean(String value, int max) {
        String text = value == null ? "" : value.trim().replaceAll("\\s+", " ");
        return text.length() <= max ? text : text.substring(0, max);
    }
}
