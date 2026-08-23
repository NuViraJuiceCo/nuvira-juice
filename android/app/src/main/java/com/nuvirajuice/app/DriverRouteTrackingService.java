package com.nuvirajuice.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

public class DriverRouteTrackingService extends Service implements LocationListener {
    private static final String ACTION_START = "com.nuvirajuice.app.START_DRIVER_ROUTE_TRACKING";
    private static final String ACTION_STOP = "com.nuvirajuice.app.STOP_DRIVER_ROUTE_TRACKING";
    private static final String CHANNEL_ID = "nuvira_driver_route_tracking";
    private static final int NOTIFICATION_ID = 0x4E561001;
    private static volatile boolean active = false;
    private static volatile long lastSampleAt = 0L;
    private static volatile String lastReason = "";
    private final ExecutorService uploader = Executors.newSingleThreadExecutor();
    private LocationManager locationManager;
    private String endpoint = "";
    private String sessionId = "";
    private String sessionToken = "";
    private long minimumIntervalMs = 30_000L;
    private float minimumDistanceMeters = 75f;
    private int sequence = 0;

    public static void start(Context context, String endpoint, String sessionId, String sessionToken, int intervalSeconds, int distanceMeters) {
        Intent intent = new Intent(context, DriverRouteTrackingService.class)
            .setAction(ACTION_START)
            .putExtra("endpoint", endpoint)
            .putExtra("session_id", sessionId)
            .putExtra("session_token", sessionToken)
            .putExtra("interval_seconds", intervalSeconds)
            .putExtra("distance_meters", distanceMeters);
        ContextCompat.startForegroundService(context, intent);
    }

    public static void stop(Context context) {
        context.startService(new Intent(context, DriverRouteTrackingService.class).setAction(ACTION_STOP));
    }

    public static JSObject status() {
        JSObject result = new JSObject();
        result.put("platform", "android");
        result.put("active", active);
        result.put("lastSampleAt", lastSampleAt > 0L ? isoTimestamp(lastSampleAt) : JSONObject.NULL);
        result.put("reason", lastReason.isEmpty() ? JSONObject.NULL : lastReason);
        return result;
    }

    public static boolean validEndpoint(String value) {
        try {
            Uri uri = Uri.parse(value);
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
            return "https".equals(uri.getScheme())
                && ("nuvirajuice.com".equals(host) || "www.nuvirajuice.com".equals(host) || "nuvira-fresh-flow.base44.app".equals(host))
                && "/functions/getAdminOperationsDashboardSummary".equals(uri.getPath());
        } catch (Exception error) {
            return false;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || ACTION_STOP.equals(intent.getAction())) {
            stopTracking("operator_stopped");
            return START_NOT_STICKY;
        }
        if (!ACTION_START.equals(intent.getAction())) return START_NOT_STICKY;

        String candidateEndpoint = clean(intent.getStringExtra("endpoint"), 500);
        String candidateSessionId = clean(intent.getStringExtra("session_id"), 180);
        String candidateToken = clean(intent.getStringExtra("session_token"), 256);
        if (!validEndpoint(candidateEndpoint) || candidateSessionId.isEmpty() || candidateToken.isEmpty()) {
            stopTracking("invalid_route_session");
            return START_NOT_STICKY;
        }
        endpoint = candidateEndpoint;
        sessionId = candidateSessionId;
        sessionToken = candidateToken;
        minimumIntervalMs = Math.max(15, Math.min(120, intent.getIntExtra("interval_seconds", 30))) * 1000L;
        minimumDistanceMeters = Math.max(25, Math.min(500, intent.getIntExtra("distance_meters", 75)));
        sequence = 0;
        lastReason = "";

        startForeground(NOTIFICATION_ID, new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_nuvira_delivery)
            .setContentTitle("NuVira live route tracking")
            .setContentText("Customer ETAs are updating while this delivery route is active.")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(PendingIntent.getActivity(
                this,
                NOTIFICATION_ID,
                new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            ))
            .build());
        requestUpdates();
        return START_NOT_STICKY;
    }

    private void requestUpdates() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
            && ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            stopTracking("location_permission_required");
            return;
        }
        active = true;
        if (locationManager == null) {
            stopTracking("location_services_unavailable");
            return;
        }
        if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
            locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, minimumIntervalMs, minimumDistanceMeters, this, Looper.getMainLooper());
        }
        if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
            locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, minimumIntervalMs, minimumDistanceMeters, this, Looper.getMainLooper());
        }
    }

    @Override
    public void onLocationChanged(Location location) {
        if (!active || location == null || !location.hasAccuracy() || location.getAccuracy() < 0) return;
        long now = System.currentTimeMillis();
        if (lastSampleAt > 0L && now - lastSampleAt < minimumIntervalMs) return;
        lastSampleAt = now;
        int nextSequence = ++sequence;
        upload(location, nextSequence);
    }

    @Override public void onProviderEnabled(String provider) {}
    @Override public void onProviderDisabled(String provider) {}
    @Override public void onStatusChanged(String provider, int status, Bundle extras) {}

    private void upload(Location location, int sampleSequence) {
        final String requestEndpoint = endpoint;
        final String requestSessionId = sessionId;
        final String requestToken = sessionToken;
        final double latitude = location.getLatitude();
        final double longitude = location.getLongitude();
        final float accuracy = location.getAccuracy();
        final String capturedAt = isoTimestamp(location.getTime());
        uploader.submit(() -> {
            HttpURLConnection connection = null;
            try {
                JSONObject payload = new JSONObject()
                    .put("action", "ingest")
                    .put("session_id", requestSessionId)
                    .put("sequence", sampleSequence)
                    .put("latitude", latitude)
                    .put("longitude", longitude)
                    .put("accuracy_meters", accuracy)
                    .put("captured_at", capturedAt);
                byte[] body = new JSONObject()
                    .put("gateway_action", "manageDriverRouteTelemetry")
                    .put("payload", payload)
                    .toString()
                    .getBytes(StandardCharsets.UTF_8);
                connection = (HttpURLConnection) new URL(requestEndpoint).openConnection();
                connection.setConnectTimeout(15_000);
                connection.setReadTimeout(15_000);
                connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setRequestProperty("X-App-Id", "69d48d0c39891f7945481152");
                connection.setRequestProperty("X-Route-Session-Token", requestToken);
                connection.setDoOutput(true);
                try (OutputStream output = connection.getOutputStream()) { output.write(body); }
                int statusCode = connection.getResponseCode();
                if (statusCode == 410) {
                    stopTracking("route_session_ended");
                } else if (statusCode < 200 || statusCode >= 300) {
                    lastReason = "route_update_unavailable";
                } else {
                    lastReason = "";
                }
            } catch (Exception error) {
                lastReason = "route_update_unavailable";
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Driver route tracking", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Visible only while NuVira is actively calculating customer delivery estimates");
        channel.setSound(null, null);
        channel.enableVibration(false);
        manager.createNotificationChannel(channel);
    }

    private void stopTracking(String reason) {
        active = false;
        lastReason = "operator_stopped".equals(reason) ? "" : reason;
        if (locationManager != null) locationManager.removeUpdates(this);
        endpoint = "";
        sessionId = "";
        sessionToken = "";
        sequence = 0;
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (locationManager != null) locationManager.removeUpdates(this);
        active = false;
        endpoint = "";
        sessionId = "";
        sessionToken = "";
        uploader.shutdownNow();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) { return null; }

    private static String clean(String value, int max) {
        String text = value == null ? "" : value.trim().replaceAll("\\s+", " ");
        return text.length() <= max ? text : text.substring(0, max);
    }

    private static String isoTimestamp(long epochMillis) {
        SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
        return formatter.format(new Date(epochMillis));
    }
}
