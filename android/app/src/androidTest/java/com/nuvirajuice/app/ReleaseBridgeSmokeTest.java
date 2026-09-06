package com.nuvirajuice.app;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.util.Objects;

/** Offline, emulator-only checks against the optimized release, not a debug app.
 * No credentials, order creation, payment confirmation, or remote push is used.
 * Launch with -e nuviraReleaseQa true after disabling emulator Wi-Fi/mobile data.
 */
public class ReleaseBridgeSmokeTest {
    private final Instrumentation instrumentation;
    public ReleaseBridgeSmokeTest(Instrumentation runner) { instrumentation = runner; }
    private Activity activity;
    private WebView webView;

    public String onlinePublicCatalogImages() throws Exception {
        assertTrue("Only a disposable emulator is allowed", Build.HARDWARE.matches(".*(ranchu|goldfish).*"));
        Context context = instrumentation.getTargetContext();
        android.net.ConnectivityManager network = (android.net.ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        activity = instrumentation.startActivitySync(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        long networkDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (network.getActiveNetwork() == null && System.nanoTime() < networkDeadline) Thread.sleep(100);
        assertTrue("Online public-catalog check requires a network", network.getActiveNetwork() != null);
        instrumentation.runOnMainSync(() -> webView = findWebView(activity.getWindow().getDecorView()));
        assertNotNull(webView);
        instrumentation.runOnMainSync(() -> webView.loadUrl("https://localhost/shop"));
        awaitTrue("typeof Capacitor !== 'undefined' && typeof Capacitor.nativePromise === 'function'", 30);
        // Anonymous read-only storefront: never sign in, add items, or check out.
        awaitTrue("!!document.querySelector('a[aria-label=\"View Hydration Shot\"]')", 45);
        awaitTrue("!Array.from(document.querySelectorAll('div')).some(e => e.classList.contains('z-[9999]'))", 15);
        evaluate("Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Wellness Shots')?.click(); true");
        org.json.JSONArray images = new org.json.JSONArray();
        for (String title : new String[]{"Hydration Shot", "Radiance Shot", "Reset Shot"}) {
            String selector = "document.querySelector('a[aria-label=\"View " + title + "\"]')";
            awaitTrue("!!" + selector, 15);
            evaluate(selector + ".parentElement.scrollIntoView({block:'center'}); true");
            String image = selector + ".parentElement.querySelector('img')";
            awaitTrue("!!" + image + " && " + image + ".complete && " + image + ".naturalWidth > 0", 20);
            images.put(new JSONObject((String) evaluate("JSON.stringify({title:'" + title + "',src:" + image + ".currentSrc,width:" + image + ".naturalWidth,height:" + image + ".naturalHeight})")));
        }
        JSONObject report = new JSONObject();
        report.put("images", images);
        report.put("native", nativeCall("App", "getInfo", "{}"));
        report.put("live_updates", nativeCall("LiveUpdates", "getConfig", "{}"));
        JSONObject sync = awaitLiveUpdateSync();
        report.put("live_update_sync", sync);
        assertTrue("Live-update callback error", !sync.has("error"));
        String syncMessage = sync.optString("message", "").replaceAll("https?://\\S+", "[url]");
        assertTrue("Live-update sync failed at " + sync.optString("failStep") + ": " + syncMessage,
            !sync.has("failStep"));
        report.put("main_script", evaluate("Array.from(document.scripts).find(s=>s.src.includes('/assets/index-'))?.src || ''"));
        report.put("checkout_or_provider_write", false);
        awaitTrue("!Array.from(document.querySelectorAll('div')).some(e => e.classList.contains('z-[9999]'))", 15);
        java.io.File screenshot = new java.io.File(context.getExternalFilesDir(null), "g176-shop-shots.png");
        try (java.io.FileOutputStream output = new java.io.FileOutputStream(screenshot)) {
            android.graphics.Bitmap bitmap = instrumentation.getUiAutomation().takeScreenshot();
            assertNotNull(bitmap);
            bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output);
            bitmap.recycle();
        }
        report.put("screenshot", screenshot.getAbsolutePath());
        renderLauncherMasks(context);
        return report.toString(2);
    }

    private JSONObject awaitLiveUpdateSync() throws Exception {
        // App startup already downloads Production. A second sync can correctly
        // report busy until that download/reload completes. Retry only that exact
        // busy response, bounded in time; do not suppress real provider failures.
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(90);
        boolean requested = false;
        while (System.nanoTime() < deadline) {
            if (!requested || "undefined".equals(evaluate("typeof window.__releaseQaSync"))) {
                evaluate("window.__releaseQaSync = null; Capacitor.nativeCallback('LiveUpdates','sync',{},(r,e)=>{if(e || (r && ('snapshot' in r || r.failStep))) window.__releaseQaSync = JSON.stringify(e ? {error:String(e)} : r)}); true");
                requested = true;
            }
            if ("string".equals(evaluate("typeof window.__releaseQaSync"))) {
                JSONObject result = new JSONObject((String) evaluate("window.__releaseQaSync"));
                if ("CHECK".equals(result.optString("failStep")) &&
                    "Live Update failed on CHECK step. Reason: Sync already in progress.".equals(result.optString("message"))) {
                    requested = false;
                    Thread.sleep(1000);
                    continue;
                }
                return result;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("Production live-update sync did not settle within 90 seconds");
    }

    private void renderLauncherMasks(Context context) throws Exception {
        for (int size : new int[]{48, 72, 96, 144, 192}) {
            for (String mask : new String[]{"platform", "circle", "rounded-square"}) {
                android.graphics.drawable.Drawable icon = context.getPackageManager().getApplicationIcon(context.getPackageName());
                icon.setBounds(0, 0, size, size);
                android.graphics.Bitmap bitmap = android.graphics.Bitmap.createBitmap(size, size, android.graphics.Bitmap.Config.ARGB_8888);
                android.graphics.Canvas canvas = new android.graphics.Canvas(bitmap);
                if (icon instanceof android.graphics.drawable.AdaptiveIconDrawable && !mask.equals("platform")) {
                    android.graphics.Path clip = new android.graphics.Path();
                    if (mask.equals("circle")) clip.addCircle(size / 2f, size / 2f, size / 2f, android.graphics.Path.Direction.CW);
                    else clip.addRoundRect(0, 0, size, size, size * .22f, size * .22f, android.graphics.Path.Direction.CW);
                    canvas.clipPath(clip);
                    android.graphics.drawable.AdaptiveIconDrawable adaptive = (android.graphics.drawable.AdaptiveIconDrawable) icon;
                    adaptive.getBackground().draw(canvas);
                    adaptive.getForeground().draw(canvas);
                } else icon.draw(canvas);
                java.io.File outputFile = new java.io.File(context.getExternalFilesDir(null), "g176-icon-" + size + "-" + mask + ".png");
                try (java.io.FileOutputStream output = new java.io.FileOutputStream(outputFile)) {
                    bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output);
                }
                bitmap.recycle();
            }
        }
    }

    public void optimizedReleasePreservesNativeContracts() throws Exception {
        assertTrue("Only a disposable emulator is allowed", Build.HARDWARE.matches(".*(ranchu|goldfish).*"));
        Context context = instrumentation.getTargetContext();
        android.net.ConnectivityManager network = (android.net.ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        assertTrue("This test must run offline", network.getActiveNetwork() == null);
        assertEquals(0, context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE);
        assertEquals("com.nuvirajuice.app", context.getPackageName());

        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        assertNotNull(launch);
        activity = instrumentation.startActivitySync(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        instrumentation.runOnMainSync(() -> webView = findWebView(activity.getWindow().getDecorView()));
        assertNotNull("Release WebView must exist", webView);
        awaitTrue("typeof Capacitor !== 'undefined' && typeof Capacitor.nativePromise === 'function'", 30);

        assertEquals("android", evaluate("Capacitor.getPlatform()"));
        for (String plugin : new String[]{"App", "Browser", "LiveUpdates", "FirebaseMessaging", "NativeGooglePay", "DeliveryLiveActivity"}) {
            assertEquals("Plugin retained: " + plugin, Boolean.TRUE, evaluate("Capacitor.isPluginAvailable('" + plugin + "')"));
        }

        JSONObject info = nativeCall("App", "getInfo", "{}");
        assertEquals("38", info.getString("build"));
        assertEquals("2.117919.0", info.getString("version"));
        assertEquals("com.nuvirajuice.app", info.getString("id"));

        JSONObject wallet = nativeCall("NativeGooglePay", "isAvailable", "{}");
        assertFalse(wallet.getBoolean("available"));
        assertEquals("publishable_key_unavailable", wallet.getString("reason"));
        JSONObject invalidPayment = nativeCall("NativeGooglePay", "confirmPayment", "{}");
        assertEquals("INVALID_CLIENT_SECRET", invalidPayment.getString("errorCode"));
        // Permission reads do not request permission or register a push token.
        assertTrue(nativeCall("FirebaseMessaging", "checkPermissions", "{}").has("receive"));
        assertFalse(nativeCall("DeliveryLiveActivity", "isAvailable", "{}").has("errorCode"));

        PackageManager pm = context.getPackageManager();
        for (String url : new String[]{"nuvira://auth/callback", "nuvira://open/account/orders", "https://nuvirajuice.com/account/orders", "https://nuvirajuice.com/order-tracker/QA-NOT-AN-ORDER"}) {
            Intent link = new Intent(Intent.ACTION_VIEW, Uri.parse(url))
                .addCategory(Intent.CATEGORY_BROWSABLE).setPackage(context.getPackageName());
            assertNotNull("Packaged link handler: " + url, pm.resolveActivity(link, PackageManager.MATCH_DEFAULT_ONLY));
        }
        assertFalse(pm.getActivityInfo(new android.content.ComponentName(context, "com.nuvirajuice.app.NativeGooglePayActivity"), 0).exported);
        for (String service : new String[]{"NuViraMessagingService", "DriverRouteTrackingService"}) {
            assertFalse(pm.getServiceInfo(new android.content.ComponentName(context, "com.nuvirajuice.app." + service), 0).exported);
        }

        // Exercise pause/resume on the same optimized activity without a provider.
        instrumentation.runOnMainSync(() -> instrumentation.callActivityOnPause(activity));
        instrumentation.runOnMainSync(() -> instrumentation.callActivityOnResume(activity));
        assertEquals("38", nativeCall("App", "getInfo", "{}").getString("build"));
        instrumentation.runOnMainSync(activity::finish);
    }

    private WebView findWebView(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                WebView found = findWebView(group.getChildAt(i));
                if (found != null) return found;
            }
        }
        return null;
    }

    private Object evaluate(String expression) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> webView.evaluateJavascript(expression, result -> {
            value.set(result);
            done.countDown();
        }));
        assertTrue("JavaScript callback timed out", done.await(5, TimeUnit.SECONDS));
        return new JSONTokener(value.get()).nextValue();
    }

    private void awaitTrue(String expression, int seconds) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds);
        while (System.nanoTime() < deadline) {
            if (Boolean.TRUE.equals(evaluate(expression))) return;
            Thread.sleep(100);
        }
        fail("Release bridge timed out: " + expression);
    }

    private JSONObject nativeCall(String plugin, String method, String options) throws Exception {
        evaluate("window.__releaseQaResult = null; Capacitor.nativePromise('" + plugin + "','" + method + "'," + options
            + ").then(r => window.__releaseQaResult = JSON.stringify(r || {}))"
            + ".catch(e => window.__releaseQaResult = JSON.stringify({errorCode:e.code,message:e.message})); true");
        awaitTrue("typeof window.__releaseQaResult === 'string'", 10);
        return new JSONObject((String) evaluate("window.__releaseQaResult"));
    }

    private static void fail(String message) { throw new AssertionError(message); }
    private static void assertTrue(String message, boolean value) { if (!value) fail(message); }
    private static void assertTrue(boolean value) { assertTrue("Expected true", value); }
    private static void assertFalse(boolean value) { assertTrue("Expected false", !value); }
    private static void assertEquals(String message, Object expected, Object actual) {
        if (!Objects.equals(expected, actual)) fail(message + ": expected " + expected + ", actual " + actual);
    }
    private static void assertEquals(Object expected, Object actual) { assertEquals("Values differ", expected, actual); }
    private static void assertNotNull(String message, Object value) { assertTrue(message, value != null); }
    private static void assertNotNull(Object value) { assertNotNull("Expected non-null", value); }
}
