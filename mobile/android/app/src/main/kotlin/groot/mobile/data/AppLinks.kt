package groot.mobile.data

import groot.mobile.navigation.Routes
import java.net.URI
import java.net.URLDecoder
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.getAndUpdate

sealed interface AppLink {
    data class Chat(val botId: String, val focusTaskId: Int? = null) : AppLink

    data class CredentialRequest(val taskId: Int) : AppLink

    data class Screen(val route: String) : AppLink
}

private const val UTF_8 = "UTF-8"

private val FOCUS = Regex("^(approval|question|takeover):(\\d+)$")

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
        segments.size == 3 && segments[0] == "vault" && segments[1] == "items" -> AppLink.Screen(Routes.vaultItem(segments[2]))
        segments == listOf("routines") -> AppLink.Screen(Routes.ROUTINES)
        segments == listOf("tasks") -> AppLink.Screen(Routes.TASKS)
        segments == listOf("code") -> AppLink.Screen(Routes.CODE)
        segments == listOf("code", "new") -> AppLink.Screen(Routes.CODE_NEW)
        segments == listOf("code", "reviews") -> AppLink.Screen(Routes.CODE_REVIEWS)
        segments.size == 3 && segments[0] == "code" && segments[1] == "reviews" -> AppLink.Screen(Routes.codeReview(segments[2]))
        segments.size == 2 && segments[0] == "code" -> AppLink.Screen(Routes.codeThread(segments[1]))
        else -> null
    }
}

data class ChatFocus(val botId: String, val taskId: Int)

class AppLinks {
    private val _pending = MutableStateFlow<AppLink?>(null)
    val pending: StateFlow<AppLink?> = _pending.asStateFlow()

    private val _focus = MutableStateFlow<ChatFocus?>(null)
    val focus: StateFlow<ChatFocus?> = _focus.asStateFlow()

    fun open(link: AppLink) {
        _pending.value = link
    }

    fun take(): AppLink? = _pending.getAndUpdate { null }

    fun focus(botId: String, taskId: Int) {
        _focus.value = ChatFocus(botId, taskId)
    }

    fun clearFocus() {
        _focus.value = null
    }
}
