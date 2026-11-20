package groot.mobile.push

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import groot.mobile.MainActivity
import groot.mobile.R

class PushNotifier(context: Context) {
    private val appContext = context.applicationContext
    private val manager = NotificationManagerCompat.from(appContext)

    fun createChannels() {
        val system = appContext.getSystemService(NotificationManager::class.java) ?: return
        for (channel in PushChannel.entries) {
            val importance = if (channel.importanceHigh) NotificationManager.IMPORTANCE_HIGH else NotificationManager.IMPORTANCE_DEFAULT
            system.createNotificationChannel(NotificationChannel(channel.id, channel.title, importance))
        }
    }

    fun enabled(): Boolean = manager.areNotificationsEnabled()

    @SuppressLint("MissingPermission")
    fun show(spec: NotificationSpec, serverUrl: String?) {
        if (!manager.areNotificationsEnabled()) return
        createChannels()
        val builder = NotificationCompat.Builder(appContext, spec.channel.id)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(spec.title)
            .setContentText(spec.text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(spec.text))
            .setAutoCancel(true)
            .setContentIntent(openIntent(spec.tag, serverUrl, spec.path))
            .setPriority(if (spec.channel.importanceHigh) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(if (spec.actions != null) NotificationCompat.CATEGORY_REMINDER else NotificationCompat.CATEGORY_MESSAGE)
            .setGroup(spec.actions?.botId ?: spec.channel.id)
        val actions = spec.actions
        if (actions != null) {
            for (answer in spec.buttons) builder.addAction(answerAction(spec.tag, actions, answer))
        }
        manager.notify(spec.tag, NOTIFICATION_ID, builder.build())
    }

    fun dismiss(tag: String) {
        manager.cancel(tag, NOTIFICATION_ID)
    }

    @SuppressLint("MissingPermission")
    fun note(tag: String, title: String, text: String?, serverUrl: String?, path: String?) {
        if (!manager.areNotificationsEnabled()) return
        val notification = NotificationCompat.Builder(appContext, PushChannel.System.id)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setAutoCancel(true)
            .setSilent(true)
            .setTimeoutAfter(NOTE_TIMEOUT_MS)
            .setContentIntent(openIntent(tag, serverUrl, path))
            .build()
        manager.notify(tag, NOTIFICATION_ID, notification)
    }

    private fun openIntent(tag: String, serverUrl: String?, path: String?): PendingIntent {
        val intent = Intent(appContext, MainActivity::class.java).apply {
            val url = if (serverUrl != null && path != null) serverUrl.trimEnd('/') + path else null
            if (url != null) {
                action = Intent.ACTION_VIEW
                data = Uri.parse(url)
            } else {
                action = Intent.ACTION_MAIN
            }
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        return PendingIntent.getActivity(appContext, tag.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun answerAction(tag: String, actions: ApprovalActions, answer: ApprovalAnswer): NotificationCompat.Action {
        val extras = AnswerRequest(tag, actions.botId, actions.taskId, actions.tool, answer)
        val requestCode = (tag + answer.name).hashCode()
        val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        val pending = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.getBroadcast(appContext, requestCode, extras.into(Intent(appContext, NotificationActionReceiver::class.java)), flags)
        } else {
            val intent = extras.into(Intent(appContext, UnlockToAnswerActivity::class.java))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_HISTORY)
            PendingIntent.getActivity(appContext, requestCode, intent, flags)
        }
        return NotificationCompat.Action.Builder(0, answer.label, pending)
            .setAuthenticationRequired(true)
            .build()
    }

    private companion object {
        const val NOTIFICATION_ID = 1
        const val NOTE_TIMEOUT_MS = 4_000L
    }
}

data class AnswerRequest(
    val tag: String,
    val botId: String,
    val taskId: Int,
    val tool: String,
    val answer: ApprovalAnswer,
) {
    fun into(intent: Intent): Intent = intent
        .putExtra(EXTRA_TAG, tag)
        .putExtra(EXTRA_BOT, botId)
        .putExtra(EXTRA_TASK, taskId)
        .putExtra(EXTRA_TOOL, tool)
        .putExtra(EXTRA_ANSWER, answer.name)

    companion object {
        private const val EXTRA_TAG = "groot.mobile.push.TAG"
        private const val EXTRA_BOT = "groot.mobile.push.BOT"
        private const val EXTRA_TASK = "groot.mobile.push.TASK"
        private const val EXTRA_TOOL = "groot.mobile.push.TOOL"
        private const val EXTRA_ANSWER = "groot.mobile.push.ANSWER"

        fun from(intent: Intent): AnswerRequest? = AnswerRequest(
            tag = intent.getStringExtra(EXTRA_TAG) ?: return null,
            botId = intent.getStringExtra(EXTRA_BOT) ?: return null,
            taskId = intent.getIntExtra(EXTRA_TASK, -1).takeIf { it >= 0 } ?: return null,
            tool = intent.getStringExtra(EXTRA_TOOL).orEmpty(),
            answer = intent.getStringExtra(EXTRA_ANSWER)?.let { name -> ApprovalAnswer.entries.find { it.name == name } } ?: return null,
        )
    }
}
