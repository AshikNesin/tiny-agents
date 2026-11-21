package groot.mobile.navigation

import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.feature.about.AboutScreen
import groot.mobile.feature.home.HomeRoute
import groot.mobile.feature.settings.SettingsRoute
import groot.mobile.feature.settings.SettingsViewModel
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.flow.first
import groot.mobile.data.AppLink
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect

private const val TRANSITION_MS = 250
private val easing = FastOutSlowInEasing

private fun AnimatedContentTransitionScope<NavBackStackEntry>.enter(): EnterTransition =
    slideInHorizontally(tween(TRANSITION_MS, easing = easing)) { it }

private fun AnimatedContentTransitionScope<NavBackStackEntry>.exit(): ExitTransition =
    ExitTransition.KeepUntilTransitionsFinished

private fun AnimatedContentTransitionScope<NavBackStackEntry>.popEnter(): EnterTransition =
    EnterTransition.None

private fun AnimatedContentTransitionScope<NavBackStackEntry>.popExit(): ExitTransition =
    slideOutHorizontally(tween(TRANSITION_MS, easing = easing)) { it }

@Composable
fun AppNavHost(
    container: AppContainer,
    navController: NavHostController = rememberNavController(),
) {
    val navigate: (String) -> Unit = { route -> navController.navigate(route) { launchSingleTop = true } }
    val back: () -> Unit = { navController.navigateUp() }
    val pendingLink by container.links.pending.collectAsStateWithLifecycle()
    LaunchedEffect(pendingLink) {
        val link = container.links.take() ?: return@LaunchedEffect
        openLink(container, link, home = { navController.popBackStack(Routes.HOME, inclusive = false) }, navigate = navigate)
    }
    NavHost(
        navController = navController,
        startDestination = Routes.HOME,
        enterTransition = { enter() },
        exitTransition = { exit() },
        popEnterTransition = { popEnter() },
        popExitTransition = { popExit() },
        predictivePopEnterTransition = { popEnter() },
        predictivePopExitTransition = { popExit() },
    ) {
        composable(Routes.HOME) { ScreenContainer { HomeRoute(container, navigate) } }
        composable(Routes.SETTINGS) {
            ScreenContainer {
                val viewModel: SettingsViewModel = viewModel(factory = SettingsViewModel.factory(container))
                SettingsRoute(
                    viewModel = viewModel,
                    buildInfo = container.buildInfo,
                    onNavigateUp = back,
                    onOpenAbout = { navigate(Routes.ABOUT) },
                    onOpenPeople = { navigate(Routes.PEOPLE) },
                    onOpenNotifications = { navigate(Routes.NOTIFICATIONS) },
                )
            }
        }
        composable(Routes.ABOUT) { ScreenContainer { AboutScreen(buildInfo = container.buildInfo, onNavigateUp = back) } }
        featureScreens(container, navigate, back)
    }
}

@Composable
internal fun ScreenContainer(content: @Composable () -> Unit) {
    Box(
        Modifier
            .fillMaxSize()
            .shadow(S.md)
            .background(MaterialTheme.colorScheme.background),
    ) {
        content()
    }
}

private suspend fun openLink(container: AppContainer, link: AppLink, home: () -> Unit, navigate: (String) -> Unit) {
    fun openChat(botId: String, taskId: Int?) {
        container.session.selectBot(botId)
        if (taskId != null) container.links.focus(botId, taskId) else container.links.clearFocus()
        home()
    }
    when (link) {
        is AppLink.Chat -> openChat(link.botId, link.focusTaskId)
        is AppLink.CredentialRequest -> {
            val request = runCatching { container.api.credentialRequest(link.taskId) }.getOrNull()
            val bots = withTimeoutOrNull(LINK_WAIT_MS) { container.bots.state.first { !it.loading } }
            val bot = bots?.bots?.firstOrNull { it.name == request?.botName }
            if (bot != null) openChat(bot.id, link.taskId) else home()
        }
        is AppLink.Screen -> if (link.route == Routes.HOME) home() else navigate(link.route)
    }
}

private const val LINK_WAIT_MS = 10_000L
