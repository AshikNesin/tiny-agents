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

/*
 * One minimal transition for every screen: only the screen being opened or closed moves.
 * It slides in from the end over a still background, and slides back out on back.
 * No fades, no parallax, nothing moving behind it; a soft edge shadow (ScreenContainer) marks the sheet.
 */
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
    NavHost(
        navController = navController,
        startDestination = Routes.HOME,
        enterTransition = { enter() },
        exitTransition = { exit() },
        popEnterTransition = { popEnter() },
        popExitTransition = { popExit() },
        // Gesture back (predictive back, on by default when targeting Android 16) has its own
        // transitions in Navigation 2.10 and defaults to shrinking the screen into a card.
        // Use the same slide so swiping back looks like pressing back, following the finger.
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
                )
            }
        }
        composable(Routes.ABOUT) { ScreenContainer { AboutScreen(buildInfo = container.buildInfo, onNavigateUp = back) } }
        featureScreens(container, navigate, back)
    }
}

/**
 * Gives each screen an opaque background and a soft shadow, so a sliding screen reads as a
 * sheet over the one behind. At rest the shadow sits outside the screen and isn't visible.
 */
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
