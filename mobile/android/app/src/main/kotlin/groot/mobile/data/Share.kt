package groot.mobile.data

import android.content.Intent
import android.net.Uri
import androidx.core.content.IntentCompat
import groot.mobile.data.api.BotListEntry

data class SharedContent(
    val uris: List<Uri> = emptyList(),
    val text: String? = null,
    val subject: String? = null,
    val botId: String? = null,
) {
    val isEmpty: Boolean get() = uris.isEmpty() && text.isNullOrBlank()
}

private const val SHORTCUT_PREFIX = "bot:"

fun shareShortcutId(botId: String): String = SHORTCUT_PREFIX + botId

fun botIdOfShortcut(shortcutId: String?): String? =
    shortcutId?.takeIf { it.startsWith(SHORTCUT_PREFIX) }?.removePrefix(SHORTCUT_PREFIX)?.takeIf { it.isNotEmpty() }

fun parseShareIntent(intent: Intent): SharedContent? {
    val streams = when (intent.action) {
        Intent.ACTION_SEND -> listOfNotNull(IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java))
        Intent.ACTION_SEND_MULTIPLE -> IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java).orEmpty().filterNotNull()
        else -> return null
    }
    val clip = intent.clipData
    val clipUris = if (streams.isEmpty() && clip != null) (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri } else emptyList()
    val content = SharedContent(
        uris = (streams.ifEmpty { clipUris }).distinct(),
        text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.trim()?.takeIf { it.isNotEmpty() },
        subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)?.trim()?.takeIf { it.isNotEmpty() },
        botId = botIdOfShortcut(intent.getStringExtra(Intent.EXTRA_SHORTCUT_ID)),
    )
    return content.takeUnless { it.isEmpty }
}

fun sharedText(content: SharedContent): String? {
    val text = content.text
    val subject = content.subject
    return when {
        text == null -> subject?.takeIf { content.uris.isEmpty() }
        subject == null || text.contains(subject) -> text
        else -> "$subject\n$text"
    }
}

fun shareMessage(note: String, shared: String?): String =
    listOf(note.trim(), shared?.trim().orEmpty()).filter { it.isNotEmpty() }.joinToString("\n\n")

fun shareTargetBots(state: BotsState, max: Int): List<BotListEntry> =
    if (state.loading || max <= 0) emptyList() else state.sorted.take(max)
