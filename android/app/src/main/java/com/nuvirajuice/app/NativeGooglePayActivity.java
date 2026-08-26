package com.nuvirajuice.app;

import android.content.Intent;
import android.os.Bundle;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import com.stripe.android.PaymentConfiguration;
import com.stripe.android.googlepaylauncher.GooglePayEnvironment;
import com.stripe.android.googlepaylauncher.GooglePayLauncher;

/**
 * Short-lived native host for Stripe's public GooglePayLauncher API.
 *
 * GooglePayLauncher must register its result contract during Activity creation.
 * This private host keeps that lifecycle out of the Capacitor WebView bridge.
 */
public final class NativeGooglePayActivity extends AppCompatActivity {
    static final String EXTRA_PAYMENT_INTENT_REFERENCE = "nuvira_google_pay_payment_intent_reference";
    static final String EXTRA_PUBLISHABLE_KEY = "nuvira_google_pay_publishable_key";
    static final String EXTRA_STATUS = "nuvira_google_pay_status";

    private GooglePayLauncher googlePayLauncher;
    private String clientSecret = "";
    private boolean presented = false;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        clientSecret = clean(getIntent().getStringExtra(EXTRA_PAYMENT_INTENT_REFERENCE), 512);
        String publishableKey = clean(getIntent().getStringExtra(EXTRA_PUBLISHABLE_KEY), 256);
        if (!validClientSecret(clientSecret) || !validPublishableKey(publishableKey)) {
            finishWith("failed");
            return;
        }

        try {
            PaymentConfiguration.init(this, publishableKey);
            GooglePayLauncher.Config config = new GooglePayLauncher.Config(
                publishableKey.startsWith("pk_live_") ? GooglePayEnvironment.Production : GooglePayEnvironment.Test,
                "US",
                "NuVira Juice Company"
            );
            googlePayLauncher = new GooglePayLauncher(
                this,
                config,
                this::handleReady,
                this::handleResult
            );
        } catch (Exception error) {
            finishWith("failed");
        }
    }

    private void handleReady(boolean ready) {
        if (!ready || presented || isFinishing()) {
            if (!ready) finishWith("unavailable");
            return;
        }
        presented = true;
        googlePayLauncher.presentForPaymentIntent(clientSecret, "NuVira order");
    }

    private void handleResult(GooglePayLauncher.Result result) {
        if (result instanceof GooglePayLauncher.Result.Completed) {
            finishWith("success");
        } else if (result instanceof GooglePayLauncher.Result.Canceled) {
            finishWith("canceled");
        } else {
            finishWith("failed");
        }
    }

    private void finishWith(String status) {
        setResult(RESULT_OK, new Intent().putExtra(EXTRA_STATUS, status));
        finish();
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
