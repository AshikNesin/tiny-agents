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

data class ShareTarget(val botId: String, val name: String)

class ShareTargets(private val context: Context, private val avatars: AvatarStore) {
    val max: Int by lazy {
        runCatching { ShortcutManagerCompat.getMaxShortcutCountPerActivity(context) }.getOrDefault(MAX_TARGETS).coerceAtMost(MAX_TARGETS)
    }

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
            Log.w("ShareTargets", e) { "Could not publish share targets" }
        }
    }

    private suspend fun shortcut(target: ShareTarget, serverUrl: String?): ShortcutInfoCompat {
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
        const val SHARE_CATEGORY = "groot.mobile.category.SHARE_TO_BOT"
        const val MAX_TARGETS = 4

        private const val ADAPTIVE_SCALE = 1.5f
    }
}
