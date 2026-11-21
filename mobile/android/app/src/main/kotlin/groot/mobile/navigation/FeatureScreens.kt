package groot.mobile.navigation

import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavType
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import groot.mobile.AppContainer
import groot.mobile.feature.bots.BotEditorRoute
import groot.mobile.feature.bots.PastChatRoute
import groot.mobile.feature.bots.PastChatsRoute
import groot.mobile.feature.code.CodeChangesRoute
import groot.mobile.feature.code.CodeListRoute
import groot.mobile.feature.code.CodePullRoute
import groot.mobile.feature.code.CodeThreadRoute
import groot.mobile.feature.code.NewCodeThreadRoute
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
import kotlinx.coroutines.launch

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
        ScreenContainer { PastChatRoute(container, botId, chatId, onContinued = { navigate(Routes.HOME) }, onBack = back) }
    }
    composable(Routes.LIVE_BOT) { entry ->
        val surface = entry.arguments?.getString("surface").orEmpty()
        val botId = entry.arguments?.getString("botId").orEmpty()
        ScreenContainer {
            LiveRoute(container, LiveTarget(surface, botId = botId), title = if (surface == "browser") "Browser" else "Computer", onBack = back, onPip = {
                container.livePip.open(surface, botId)
                container.scope.launch { container.appPreferences.setLivePip(true) }
                back()
            })
        }
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
    codeScreens(container, navigate, back)
}

private fun NavGraphBuilder.codeScreens(container: AppContainer, navigate: (String) -> Unit, back: () -> Unit) {
    composable(Routes.CODE) {
        ScreenContainer { CodeListRoute(container, onOpen = { navigate(Routes.codeThread(it)) }, onNew = { navigate(Routes.CODE_NEW) }, onBack = back) }
    }
    composable(Routes.CODE_NEW) {
        ScreenContainer {
            NewCodeThreadRoute(container, onStarted = { id ->
                back()
                navigate(Routes.codeThread(id))
            }, onBack = back)
        }
    }
    composable(Routes.CODE_THREAD) { entry ->
        val threadId = entry.arguments?.getString("threadId").orEmpty()
        ScreenContainer {
            CodeThreadRoute(
                container,
                threadId,
                onOpenThread = { navigate(Routes.codeThread(it)) },
                onChanges = { navigate(Routes.codeChanges(threadId)) },
                onPullRequest = { navigate(Routes.codePr(threadId)) },
                onBack = back,
            )
        }
    }
    composable(Routes.CODE_CHANGES) { entry ->
        ScreenContainer { CodeChangesRoute(container, entry.arguments?.getString("threadId").orEmpty(), onBack = back) }
    }
    composable(Routes.CODE_PR) { entry ->
        ScreenContainer { CodePullRoute(container, entry.arguments?.getString("threadId").orEmpty(), onBack = back) }
    }
}
