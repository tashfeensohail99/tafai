package com.tashfeengroup.sales

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder

/**
 * Holds the process at FOREGROUND (in-call) priority for the duration of a
 * call. Without this the app sat at cached priority (adj 900) once the screen
 * locked, and OEM task cleaners (XOS "remove task") killed it MID-CALL —
 * audio died with no hangup sent. Started/stopped from MainActivity's
 * "call_locks" channel alongside the wake/Wi-Fi locks.
 */
class CallForegroundService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIF_ID, buildNotification())
        return START_NOT_STICKY
    }

    private fun buildNotification(): Notification {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                CHANNEL_ID,
                "Ongoing call",
                NotificationManager.IMPORTANCE_LOW, // silent, no heads-up
            )
            ch.setShowBadge(false)
            nm.createNotificationChannel(ch)
        }
        val tap = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setContentTitle("Call in progress")
            .setContentText("Tashfeen call is active")
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setOngoing(true)
            .setContentIntent(tap)
            .build()
    }

    companion object {
        private const val CHANNEL_ID = "tashfeen_in_call"
        private const val NOTIF_ID = 7301

        fun start(context: Context) {
            val intent = Intent(context, CallForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, CallForegroundService::class.java))
        }
    }
}
