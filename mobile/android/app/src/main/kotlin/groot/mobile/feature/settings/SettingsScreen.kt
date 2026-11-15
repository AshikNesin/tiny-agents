package groot.mobile.feature.settings

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import groot.kit.buildinfo.BuildInfo
import groot.kit.settings.GrootSettingsScreen
import groot.kit.settings.SettingsAbout
import groot.kit.settings.SettingsActionRow
import groot.kit.settings.SettingsInfoRow
import groot.kit.settings.SettingsNavigationRow
import groot.kit.settings.SettingsSection
import groot.kit.theme.ThemeMode
import groot.mobile.R
import groot.mobile.data.Session
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.makerUrl

@Composable
fun SettingsRoute(
    viewModel: SettingsViewModel,
    buildInfo: BuildInfo,
    onNavigateUp: () -> Unit,
    onOpenAbout: () -> Unit,
    onOpenPeople: () -> Unit,
) {
    val themeMode by viewModel.themeMode.collectAsStateWithLifecycle()
    val session by viewModel.session.collectAsStateWithLifecycle()
    SettingsScreen(
        themeMode = themeMode,
        onThemeModeChange = viewModel::setThemeMode,
        session = session,
        guest = viewModel.guest,
        onSignOut = viewModel::signOut,
        onOpenPeople = onOpenPeople,
        onResetData = viewModel::resetAll,
        buildInfo = buildInfo,
        onNavigateUp = onNavigateUp,
        onOpenAbout = onOpenAbout,
    )
}

/** The kit's GrootSettingsScreen with the account on top: who is signed in, where, and the way out. */
@Composable
fun SettingsScreen(
    themeMode: ThemeMode,
    onThemeModeChange: (ThemeMode) -> Unit,
    session: Session,
    guest: Boolean,
    onSignOut: () -> Unit,
    onOpenPeople: () -> Unit,
    onResetData: () -> Unit,
    buildInfo: BuildInfo,
    onNavigateUp: () -> Unit,
    onOpenAbout: () -> Unit,
) {
    GrootSettingsScreen(
        themeMode = themeMode,
        onThemeModeChange = onThemeModeChange,
        onNavigateUp = onNavigateUp,
        onOpenAbout = onOpenAbout,
        onResetData = onResetData,
        about = SettingsAbout(
            appName = stringResource(R.string.app_name),
            buildInfo = buildInfo,
            feedbackEmail = stringResource(R.string.config_feedback_email),
            makerName = stringResource(R.string.config_maker_name),
            makerUrl = makerUrl(),
        ),
    ) {
        SettingsSection(title = "Account") {
            SettingsInfoRow(
                title = session.user?.name ?: session.user?.email ?: "Signed out",
                summary = session.user?.email?.takeIf { session.user?.name != null },
                icon = rememberVectorPainter(AppIcons.User),
            )
            SettingsInfoRow(
                title = "Server",
                summary = session.serverUrl?.substringAfter("://"),
                icon = rememberVectorPainter(AppIcons.Server),
            )
            if (!guest) {
                SettingsNavigationRow(
                    title = "People",
                    summary = "Guests you share bots with",
                    icon = rememberVectorPainter(AppIcons.Users),
                    onClick = onOpenPeople,
                )
            }
            SettingsActionRow(title = "Sign out", icon = rememberVectorPainter(AppIcons.LogOut), onClick = onSignOut)
        }
    }
}
