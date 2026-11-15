package groot.mobile.navigation

import android.net.Uri

/** Every screen's route, and the builders for the ones that take arguments. */
object Routes {
    const val HOME = "home"
    const val SETTINGS = "settings"
    const val ABOUT = "about"
    const val PEOPLE = "people"

    const val BOT_NEW = "bot/new"
    const val BOT_EDIT = "bot/{botId}/edit"
    const val HISTORY = "bot/{botId}/history"
    const val PAST_CHAT = "bot/{botId}/history/{chatId}"

    const val LIVE_BOT = "live/{surface}/bot/{botId}"
    const val LIVE_PAGE = "live/{surface}"
    const val LIVE_PROFILE = "live/{surface}/profile/{profile}"

    const val TERMINAL = "terminal"
    const val TASKS = "tasks"
    const val ROUTINES = "routines"
    const val SKILLS = "skills"
    const val MEMORY = "memory?botId={botId}"
    const val CONNECTIONS = "connections"
    const val VAULT = "vault"

    fun botEdit(botId: String) = "bot/${Uri.encode(botId)}/edit"
    fun history(botId: String) = "bot/${Uri.encode(botId)}/history"
    fun pastChat(botId: String, chatId: String) = "bot/${Uri.encode(botId)}/history/${Uri.encode(chatId)}"
    fun liveBot(surface: String, botId: String) = "live/$surface/bot/${Uri.encode(botId)}"
    fun livePage(surface: String) = "live/$surface"
    fun liveProfile(surface: String, profile: String) = "live/$surface/profile/${Uri.encode(profile)}"
    fun memory(botId: String?) = if (botId == null) "memory" else "memory?botId=${Uri.encode(botId)}"
}
