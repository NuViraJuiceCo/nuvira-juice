package com.nuvirajuice.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.text.DateFormat;
import java.util.Date;
import java.util.Map;
import org.json.JSONObject;

@CapacitorPlugin(name = "DeliveryLiveActivity")
public class DeliveryLiveActivityPlugin extends Plugin {
    private static final String CHANNEL_ID = "nuvira_live_delivery";
    private static final String DELIVERY_MARKER = "1";
    private static final int NOTIFICATION_BASE_ID = 0x4E560000;
    private static final int NUVIRA_GREEN = Color.rgb(31, 161, 90);

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        boolean permissionGranted = notificationPermissionGranted(getContext());
        result.put("available", permissionGranted);
        result.put("platform", "android");
        result.put("systemSurface", "progress_notification");
        result.put("promotedAvailable", promotedNotificationsAvailable(getContext()));
        result.put("reason", permissionGranted ? JSONObject.NULL : "notification_permission_required");
        call.resolve(result);
    }

    @PluginMethod
    public void sync(PluginCall call) {
        JSObject snapshot = call.getObject("snapshot");
        if (snapshot == null || !isValidSnapshot(snapshot)) {
            call.reject("A valid delivery snapshot is required.");
            return;
        }

        String orderId = singleLine(snapshot.optString("orderId"), 160);
        String activityId = activityId(orderId);
        String state = singleLine(snapshot.optString("activityState"), 40);
        if ("delivered".equals(state) || "inactive".equals(state)) {
            cancel(getContext(), orderId);
        } else if (!render(getContext(), snapshot)) {
            call.reject("Delivery updates require notification permission.");
            return;
        }

        JSObject result = new JSObject();
        result.put("success", true);
        result.put("activityId", activityId);
        result.put("platform", "android");
        result.put("apnsEnvironment", "unknown");
        call.resolve(result);
    }

    @PluginMethod
    public void end(PluginCall call) {
        JSObject snapshot = call.getObject("snapshot");
        String orderId = snapshot == null ? "" : singleLine(snapshot.optString("orderId"), 160);
        if (orderId.isEmpty()) {
            call.reject("A valid order is required.");
            return;
        }
        cancel(getContext(), orderId);
        JSObject result = new JSObject();
        result.put("success", true);
        result.put("activityId", activityId(orderId));
        result.put("platform", "android");
        call.resolve(result);
    }

    static boolean handleRemoteMessage(Context context, Map<String, String> data) {
        if (!DELIVERY_MARKER.equals(data.get("nuvira_delivery_live_activity"))) return false;
        String orderId = singleLine(data.get("order_id"), 160);
        String orderNumber = singleLine(data.get("order_number"), 80);
        if (orderId.isEmpty() || orderNumber.isEmpty()) return true;

        if ("end".equals(singleLine(data.get("event"), 20))) {
            cancel(context, orderId);
            return true;
        }

        JSObject snapshot = new JSObject();
        snapshot.put("orderId", orderId);
        snapshot.put("orderNumber", orderNumber);
        snapshot.put("deepLink", safeDeepLink(data.get("deep_link"), orderNumber));
        snapshot.put("status", singleLine(data.get("status"), 40));
        snapshot.put("statusLabel", singleLine(data.get("status_label"), 80));
        snapshot.put("etaStartEpoch", positiveLong(data.get("eta_start_epoch")));
        snapshot.put("etaEndEpoch", positiveLong(data.get("eta_end_epoch")));
        snapshot.put("stopsAhead", boundedInt(data.get("stops_ahead"), 0, 500));
        snapshot.put("stopsDelivered", boundedInt(data.get("stops_delivered"), 0, 500));
        snapshot.put("stopsTotal", boundedInt(data.get("stops_total"), 0, 500));
        snapshot.put("progressPercent", boundedInt(data.get("progress_percent"), 0, 100));
        snapshot.put("updatedAtEpoch", positiveLong(data.get("updated_at_epoch")));
        snapshot.put("staleAtEpoch", positiveLong(data.get("stale_at_epoch")));
        snapshot.put("message", singleLine(data.get("message"), 160));
        snapshot.put("activityState", "en_route");
        render(context, snapshot);
        return true;
    }

    private static boolean render(Context context, JSONObject snapshot) {
        if (!notificationPermissionGranted(context)) return false;

        createChannel(context);
        String orderId = singleLine(snapshot.optString("orderId"), 160);
        String orderNumber = singleLine(snapshot.optString("orderNumber"), 80).replaceFirst("^#", "");
        String statusLabel = singleLine(snapshot.optString("statusLabel"), 80);
        String deepLink = safeDeepLink(snapshot.optString("deepLink"), orderNumber);
        int progress = Math.max(0, Math.min(100, snapshot.optInt("progressPercent", 0)));
        int stopsAhead = Math.max(0, snapshot.optInt("stopsAhead", 0));
        long etaStart = Math.max(0L, snapshot.optLong("etaStartEpoch", 0L));
        long etaEnd = Math.max(0L, snapshot.optLong("etaEndEpoch", 0L));

        NotificationCompat.ProgressStyle progressStyle = new NotificationCompat.ProgressStyle()
            .addProgressSegment(new NotificationCompat.ProgressStyle.Segment(100).setColor(NUVIRA_GREEN))
            .setProgress(progress)
            .setStyledByProgress(true);

        Intent openIntent = new Intent(Intent.ACTION_VIEW, deliveryUri(deepLink), context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            context,
            notificationId(orderId),
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String content = deliverySummary(context, statusLabel, etaStart, etaEnd, stopsAhead);
        Notification publicVersion = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_nuvira_delivery)
            .setContentTitle("NuVira delivery in progress")
            .setContentText("Open NuVira for the latest delivery update.")
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .build();

        Notification notification = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_nuvira_delivery)
            .setContentTitle("NuVira delivery · #" + orderNumber)
            .setContentText(content)
            .setSubText("Live delivery")
            .setShortCriticalText(stopsAhead > 0 ? stopsAhead + (stopsAhead == 1 ? " stop" : " stops") : "Arriving")
            .setContentIntent(contentIntent)
            .setStyle(progressStyle)
            .setColor(NUVIRA_GREEN)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setAutoCancel(false)
            .setRequestPromotedOngoing(true)
            .build();

        NotificationManagerCompat.from(context).notify(notificationId(orderId), notification);
        return true;
    }

    private static String deliverySummary(Context context, String statusLabel, long etaStart, long etaEnd, int stopsAhead) {
        String eta = formatEta(context, etaStart, etaEnd);
        String stops = stopsAhead > 0
            ? stopsAhead + (stopsAhead == 1 ? " stop ahead" : " stops ahead")
            : "Your delivery is next";
        if (!eta.isEmpty()) return eta + " · " + stops;
        if (!statusLabel.isEmpty()) return statusLabel + " · " + stops;
        return stops;
    }

    private static String formatEta(Context context, long startEpoch, long endEpoch) {
        if (startEpoch <= 0L && endEpoch <= 0L) return "";
        DateFormat formatter = android.text.format.DateFormat.getTimeFormat(context);
        if (startEpoch > 0L && endEpoch > 0L) {
            return formatter.format(new Date(startEpoch * 1000L)) + "–" + formatter.format(new Date(endEpoch * 1000L));
        }
        long value = startEpoch > 0L ? startEpoch : endEpoch;
        return "Around " + formatter.format(new Date(value * 1000L));
    }

    private static boolean isValidSnapshot(JSONObject snapshot) {
        String orderId = singleLine(snapshot.optString("orderId"), 160);
        String orderNumber = singleLine(snapshot.optString("orderNumber"), 80);
        return !orderId.isEmpty() && !orderNumber.isEmpty() && orderId.matches("[A-Za-z0-9._:@/-]+");
    }

    private static boolean notificationPermissionGranted(Context context) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private static boolean promotedNotificationsAvailable(Context context) {
        if (Build.VERSION.SDK_INT < 36 || !notificationPermissionGranted(context)) return false;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        return manager != null && manager.canPostPromotedNotifications();
    }

    private static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Live delivery updates",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Progress and arrival estimates for an active NuVira delivery");
        channel.setSound(null, null);
        channel.enableVibration(false);
        manager.createNotificationChannel(channel);
    }

    private static void cancel(Context context, String orderId) {
        NotificationManagerCompat.from(context).cancel(notificationId(orderId));
    }

    private static int notificationId(String orderId) {
        return NOTIFICATION_BASE_ID | (orderId.hashCode() & 0x0000FFFF);
    }

    private static String activityId(String orderId) {
        return "android:" + orderId;
    }

    private static Uri deliveryUri(String deepLink) {
        return new Uri.Builder().scheme("nuvira").authority("open").appendQueryParameter("path", deepLink).build();
    }

    private static String safeDeepLink(String value, String orderNumber) {
        String path = singleLine(value, 400);
        if (path.matches("/(order-tracker/[A-Za-z0-9._:@%/-]+|account/orders)([/?#].*)?")) return path;
        return "/order-tracker/" + Uri.encode(singleLine(orderNumber, 80));
    }

    private static String singleLine(Object value, int maxLength) {
        if (value == null) return "";
        String text = String.valueOf(value).trim().replaceAll("\\s+", " ");
        return text.length() <= maxLength ? text : text.substring(0, maxLength);
    }

    private static long positiveLong(Object value) {
        try {
            return Math.max(0L, Long.parseLong(singleLine(value, 32)));
        } catch (NumberFormatException error) {
            return 0L;
        }
    }

    private static int boundedInt(Object value, int minimum, int maximum) {
        try {
            return Math.max(minimum, Math.min(maximum, Integer.parseInt(singleLine(value, 16))));
        } catch (NumberFormatException error) {
            return minimum;
        }
    }
}
