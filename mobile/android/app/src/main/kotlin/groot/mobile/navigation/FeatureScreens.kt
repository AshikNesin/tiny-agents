package groot.mobile.navigation

import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import groot.mobile.AppContainer
import groot.mobile.feature.bots.BotEditorRoute
import groot.mobile.feature.bots.PastChatRoute
import groot.mobile.feature.bots.PastChatsRoute
import groot.mobile.feature.live.LivePageRoute
import groot.mobile.feature.live.LiveRoute
import groot.mobile.feature.live.LiveTarget
import groot.mobile.feature.manage.ConnectionsRoute
import groot.mobile.feature.manage.MemoryRoute
import groot.mobile.feature.manage.PeopleRoute
import groot.mobile.feature.manage.RoutinesRoute
import groot.mobile.feature.manage.SkillsRoute
import groot.mobile.feature.manage.TasksRoute
import groot.mobile.feature.manage.VaultRoute
import groot.mobile.feature.terminal.TerminalRoute

/** The screens beyond Home and Settings; each feature adds its own destinations here. */
internal fun NavGraphBuilder.featureScreens(container: AppContainer, navigate: (String) -> Unit, back: () -> Unit) {
    composable(Routes.BOT_NEW) { ScreenContainer { BotEditorRoute(container, botId = null, onBack = back) } }
    composable(Routes.BOT_EDIT) { entry ->
        ScreenContainer { BotEditorRoute(container, botId = entry.arguments?.getString("botId"), onBack = back) }
    }
    composable(Routes.HISTORY) { entry ->
        val botId = entry.arguments?.getString("botId").orEmpty()
        ScreenContainer { PastChatsRoute(container, botId, onOpen = { navigate(Routes.pastChat(botId, it)) }, onBack = back) }
    }
    composable(Routes.PAST_CHAT) { entry ->
        val botId = entry.arguments?.getString("botId").orEmpty()
        val chatId = entry.arguments?.getString("chatId").orEmpty()
        // Continuing moves the bot back onto this chat: return to Home, where it is now the live one.
        ScreenContainer { PastChatRoute(container, botId, chatId, onContinued = { navigate(Routes.HOME) }, onBack = back) }
    }
    composable(Routes.LIVE_BOT) { entry ->
        val surface = entry.arguments?.getString("surface").orEmpty()
        val botId = entry.arguments?.getString("botId").orEmpty()
        ScreenContainer { LiveRoute(container, LiveTarget(surface, botId = botId), title = if (surface == "browser") "Browser" else "Computer", onBack = back) }
    }
    composable(Routes.LIVE_PAGE) { entry ->
        val surface = entry.arguments?.getString("surface").orEmpty()
        ScreenContainer { LivePageRoute(container, surface, onOpen = { navigate(Routes.liveProfile(surface, it)) }, onBack = back) }
    }
    composable(Routes.LIVE_PROFILE) { entry ->
        val surface = entry.arguments?.getString("surface").orEmpty()
        val profile = entry.arguments?.getString("profile").orEmpty()
        ScreenContainer { LiveRoute(container, LiveTarget(surface, profile = profile), title = if (surface == "browser") "Browser" else "Computer", onBack = back) }
    }
    composable(Routes.TERMINAL) { ScreenContainer { TerminalRoute(container, back) } }
    composable(Routes.TASKS) { ScreenContainer { TasksRoute(container, back) } }
    composable(Routes.ROUTINES) { ScreenContainer { RoutinesRoute(container, back) } }
    composable(Routes.SKILLS) { ScreenContainer { SkillsRoute(container, back) } }
    composable(
        Routes.MEMORY,
        arguments = listOf(navArgument("botId") { type = NavType.StringType; nullable = true; defaultValue = null }),
    ) { entry ->
        ScreenContainer { MemoryRoute(container, initialBotId = entry.arguments?.getString("botId"), onBack = back) }
    }
    composable(Routes.CONNECTIONS) { ScreenContainer { ConnectionsRoute(container, back) } }
    composable(Routes.VAULT) { ScreenContainer { VaultRoute(container, back) } }
    composable(Routes.PEOPLE) { ScreenContainer { PeopleRoute(container, back) } }
}
