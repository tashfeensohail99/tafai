package com.tashfeengroup.sales

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import android.os.PowerManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Hosts a tiny "call_locks" channel: during an active VoIP call we hold a
 * PARTIAL WakeLock (CPU stays up with the screen off) and a HIGH_PERF WifiLock
 * (disables Wi-Fi power-save). Without these, MTK/Transsion devices throttle
 * Wi-Fi as soon as the screen sleeps and the WebRTC media path starves and
 * drops — this is the documented Android mechanism every VoIP app uses.
 */
class MainActivity : FlutterActivity() {
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // Channel for server-sent message notifications (heads-up + sound).
        // Created up-front so it always exists when an FCM notification
        // arrives with channel_id=tashfeen_messages — even app-killed.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                nm.createNotificationChannel(
                    NotificationChannel(
                        "tashfeen_messages",
                        "Messages",
                        NotificationManager.IMPORTANCE_HIGH,
                    ).apply { description = "New WhatsApp messages from customers" },
                )
            } catch (_: Exception) {}
        }
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "call_locks")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "acquire" -> {
                        acquireLocks()
                        result.success(true)
                    }
                    "release" -> {
                        releaseLocks()
                        result.success(true)
                    }
                    else -> result.notImplemented()
                }
            }
    }

    private fun acquireLocks() {
        // In-call foreground service: keeps the process at in-call priority so
        // screen-off doesn't demote us to a cached app the OEM cleaner kills.
        try {
            CallForegroundService.start(this)
        } catch (_: Exception) {}
        try {
            if (wakeLock == null) {
                val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
                wakeLock = pm.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "tashfeen:call",
                )
            }
            if (wakeLock?.isHeld != true) wakeLock?.acquire(60 * 60 * 1000L)
        } catch (_: Exception) {}
        try {
            if (wifiLock == null) {
                val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
                @Suppress("DEPRECATION")
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "tashfeen:call")
            }
            if (wifiLock?.isHeld != true) wifiLock?.acquire()
        } catch (_: Exception) {}
    }

    private fun releaseLocks() {
        try {
            CallForegroundService.stop(this)
        } catch (_: Exception) {}
        try {
            if (wakeLock?.isHeld == true) wakeLock?.release()
        } catch (_: Exception) {}
        try {
            if (wifiLock?.isHeld == true) wifiLock?.release()
        } catch (_: Exception) {}
    }

    override fun onDestroy() {
        releaseLocks()
        super.onDestroy()
    }
}
