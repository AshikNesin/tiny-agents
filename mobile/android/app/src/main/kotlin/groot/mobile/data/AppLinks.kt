package groot.mobile.data

import groot.mobile.navigation.Routes
import java.net.URI
import java.net.URLDecoder
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.getAndUpdate

/** Where one of the server's web links (a push notification's, usually) takes the app. */
sealed interface AppLink {
    /** A bot's chat, scrolled to the card waiting on [focusTaskId] when there is one. */
    data class Chat(val botId: String, val focusTaskId: Int? = null) : AppLink

    /** A bot's request for a sign-in (`/vault/requests/<task>`): its chat, on that card. */
    data class CredentialRequest(val taskId: Int) : AppLink

    /** A screen with no argument: Home, Tasks, Routines, Vault. */
    data class Screen(val route: String) : AppLink
}

/** By name: `URLDecoder.decode(String, Charset)` is API 33, above the app's minimum. */
private const val UTF_8 = "UTF-8"

/** `focus=approval:12` as the server writes it for a waiting card (the web client's `focus-param.ts`). */
private val FOCUS = Regex("^(approval|question|takeover):(\\d+)$")

/**
 * Port of the paths the server's notifications link to (`notifications.events.ts`) onto app
 * screens. A link to another server than the one signed in to, or a path the app has no
 * screen for, gives null: the app then just opens.
 */
fun parseAppLink(url: String, serverUrl: String?): AppLink? {
    val uri = runCatching { URI(url) }.getOrNull() ?: return null
    if (uri.scheme != "https" && uri.scheme != "http") return null
    if (serverUrl != null) {
        val server = runCatching { URI(serverUrl) }.getOrNull() ?: return null
        if (!server.host.equals(uri.host, ignoreCase = true)) return null
    }
    val segments = uri.rawPath.orEmpty().split('/').filter { it.isNotEmpty() }.map { URLDecoder.decode(it, UTF_8) }
    val query = uri.rawQuery.orEmpty().split('&').mapNotNull { pair ->
        val (key, value) = pair.split('=', limit = 2).takeIf { it.size == 2 } ?: return@mapNotNull null
        URLDecoder.decode(key, UTF_8) to URLDecoder.decode(value, UTF_8)
    }.toMap()
    return when {
        segments.isEmpty() -> AppLink.Screen(Routes.HOME)
        segments[0] == "chats" && segments.size == 2 -> AppLink.Chat(
            botId = segments[1],
            focusTaskId = query["focus"]?.let { FOCUS.matchEntire(it) }?.groupValues?.get(2)?.toIntOrNull(),
        )
        segments.size == 3 && segments[0] == "vault" && segments[1] == "requests" -> segments[2].toIntOrNull()?.let { AppLink.CredentialRequest(it) }
        segments == listOf("vault") -> AppLink.Screen(Routes.VAULT)
        segments == listOf("routines") -> AppLink.Screen(Routes.ROUTINES)
        segments == listOf("tasks") -> AppLink.Screen(Routes.TASKS)
        else -> null
    }
}

/** A chat should scroll to the card waiting on [taskId] once it shows it. */
data class ChatFocus(val botId: String, val taskId: Int)

/**
 * Links the app was opened with, held until the signed-in screens can act on them (a link
 * that arrives before sign-in waits for it), and the card a chat should scroll to.
 */
class AppLinks {
    private val _pending = MutableStateFlow<AppLink?>(null)
    val pending: StateFlow<AppLink?> = _pending.asStateFlow()

    private val _focus = MutableStateFlow<ChatFocus?>(null)
    val focus: StateFlow<ChatFocus?> = _focus.asStateFlow()

    fun open(link: AppLink) {
        _pending.value = link
    }

    /** The waiting link, once: whoever takes it acts on it. */
    fun take(): AppLink? = _pending.getAndUpdate { null }

    fun focus(botId: String, taskId: Int) {
        _focus.value = ChatFocus(botId, taskId)
    }

    fun clearFocus() {
        _focus.value = null
    }
}
