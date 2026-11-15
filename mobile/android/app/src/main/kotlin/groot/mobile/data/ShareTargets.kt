package groot.mobile.data

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.net.Uri
import androidx.core.content.ContextCompat
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.createBitmap
import androidx.core.graphics.drawable.IconCompat
import androidx.core.net.toUri
import groot.kit.log.Log
import groot.mobile.MainActivity
import groot.mobile.R
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** A bot offered in Android's share sheet. */
data class ShareTarget(val botId: String, val name: String)

/**
 * Publishes the owner's top bots as Direct Share targets: Android's share sheet then lists
 * them by face and name, and picking one opens the share sheet with that bot chosen. The same
 * shortcuts show on a long press of the launcher icon and open that bot's chat.
 */
class ShareTargets(private val context: Context, private val avatars: AvatarStore) {
    /** How many targets to publish: what the launcher allows, at most [MAX_TARGETS]. */
    val max: Int by lazy {
        runCatching { ShortcutManagerCompat.getMaxShortcutCountPerActivity(context) }.getOrDefault(MAX_TARGETS).coerceAtMost(MAX_TARGETS)
    }

    /** Replace the published targets with [targets]; none removes them all (signed out). */
    suspend fun publish(targets: List<ShareTarget>, serverUrl: String?) {
        try {
            val shortcuts = targets.map { shortcut(it, serverUrl) }
            withContext(Dispatchers.IO) {
                if (shortcuts.isEmpty()) {
                    ShortcutManagerCompat.removeAllDynamicShortcuts(context)
                } else {
                    ShortcutManagerCompat.setDynamicShortcuts(context, shortcuts)
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Rate limited, or a launcher without shortcuts: the share sheet still lists the app itself.
            Log.w("ShareTargets", e) { "Could not publish share targets" }
        }
    }

    private suspend fun shortcut(target: ShareTarget, serverUrl: String?): ShortcutInfoCompat {
        // Opening the shortcut from the launcher goes to the bot's chat, as a notification's link does.
        val open = Intent(context, MainActivity::class.java)
            .setAction(Intent.ACTION_VIEW)
            .setData(serverUrl?.let { "$it/chats/${Uri.encode(target.botId)}".toUri() })
        return ShortcutInfoCompat.Builder(context, shareShortcutId(target.botId))
            .setShortLabel(target.name)
            .setLongLabel(target.name)
            .setIcon(icon(target.name))
            .setIntent(open)
            .setCategories(setOf(SHARE_CATEGORY))
            .setLongLived(true)
            .build()
    }

    /** The bot's face centered on the launcher icon's background, padded for the adaptive mask. */
    private suspend fun icon(name: String): IconCompat {
        val face = avatars.load(name) ?: return IconCompat.createWithResource(context, R.mipmap.ic_launcher)
        val size = (face.width * ADAPTIVE_SCALE).toInt()
        val bitmap: Bitmap = createBitmap(size, size)
        Canvas(bitmap).apply {
            drawColor(ContextCompat.getColor(context, R.color.launcher_background))
            drawBitmap(face, (size - face.width) / 2f, (size - face.height) / 2f, null)
        }
        return IconCompat.createWithAdaptiveBitmap(bitmap)
    }

    companion object {
        /** Matches `res/xml/shortcuts.xml`'s share target. */
        const val SHARE_CATEGORY = "groot.mobile.category.SHARE_TO_BOT"
        const val MAX_TARGETS = 4

        /** An adaptive icon is 108dp with the visible part in the middle 72dp. */
        private const val ADAPTIVE_SCALE = 1.5f
    }
}
