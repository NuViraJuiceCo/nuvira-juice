package com.nuvirajuice.app;

import android.app.Activity;
import android.app.Instrumentation;
import android.os.Bundle;
import java.io.PrintWriter;
import java.io.StringWriter;

/** Uses only Android/Java APIs, avoiding test-runner Kotlin symbols that R8 can
 * legitimately inline/remove in the production app. No production keep-rule
 * relaxation is necessary just to accommodate instrumentation dependencies.
 */
public class ReleaseQaRunner extends Instrumentation {
    private boolean optedIn;
    private boolean onlineCatalog;
    @Override public void onCreate(Bundle arguments) {
        super.onCreate(arguments);
        optedIn = arguments != null && "true".equals(arguments.getString("nuviraReleaseQa"));
        onlineCatalog = arguments != null && "true".equals(arguments.getString("onlinePublicCatalog"));
        start();
    }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try {
            if (!optedIn) throw new AssertionError("Explicit nuviraReleaseQa=true required");
            ReleaseBridgeSmokeTest test = new ReleaseBridgeSmokeTest(this);
            if (onlineCatalog) {
                result.putString("stream", "G176 ONLINE PUBLIC CATALOG PASS\n" + test.onlinePublicCatalogImages() + "\n");
            } else {
                test.optimizedReleasePreservesNativeContracts();
                result.putString("stream", "G176 OPTIMIZED RELEASE NATIVE CONTRACTS PASS\nOffline emulator only; no provider/payment/order writes.\n");
            }
            finish(Activity.RESULT_OK, result);
        } catch (Throwable error) {
            StringWriter trace = new StringWriter();
            error.printStackTrace(new PrintWriter(trace));
            result.putString("stream", "G176 FAIL\n" + trace);
            finish(Activity.RESULT_CANCELED, result);
        }
    }
}
