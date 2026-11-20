package groot.mobile.feature.settings

import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.platform.LocalContext
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
import groot.mobile.push.PushStatus
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
    val push by viewModel.push.collectAsStateWithLifecycle()
    val testNote by viewModel.testNote.collectAsStateWithLifecycle()
    val context = LocalContext.current
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
        push = push,
        testNote = testNote,
        onSendTest = viewModel::sendTestNotification,
        onRetryPush = viewModel::retryPush,
        onOpenNotificationSettings = { openNotificationSettings(context) },
    )
}

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
    push: PushStatus = PushStatus(),
    testNote: String? = null,
    onSendTest: () -> Unit = {},
    onRetryPush: () -> Unit = {},
    onOpenNotificationSettings: () -> Unit = {},
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
        if (!guest && push.state != PushStatus.State.Unsupported) {
            SettingsSection(title = "Notifications") {
                SettingsInfoRow(
                    title = pushTitle(push),
                    summary = pushSummary(push),
                    icon = rememberVectorPainter(AppIcons.Bell),
                )
                when (push.state) {
                    PushStatus.State.On -> SettingsActionRow(
                        title = "Send test notification",
                        summary = testNote,
                        icon = rememberVectorPainter(AppIcons.Zap),
                        onClick = onSendTest,
                    )
                    PushStatus.State.PermissionOff -> SettingsActionRow(
                        title = "Allow notifications",
                        summary = "Opens Android settings for this app",
                        icon = rememberVectorPainter(AppIcons.External),
                        onClick = onOpenNotificationSettings,
                    )
                    PushStatus.State.Registering, PushStatus.State.Unknown -> Unit
                    else -> SettingsActionRow(
                        title = "Try again",
                        icon = rememberVectorPainter(AppIcons.Refresh),
                        onClick = onRetryPush,
                    )
                }
            }
        }
    }
}

private fun pushTitle(push: PushStatus): String = when (push.state) {
    PushStatus.State.On -> "On"
    PushStatus.State.Registering, PushStatus.State.Unknown -> "Setting up"
    PushStatus.State.PermissionOff -> "Off"
    PushStatus.State.NoGooglePlay -> "Needs Google Play services"
    PushStatus.State.ServerTooOld -> "Your server needs an update"
    PushStatus.State.Failed -> "Not working"
    PushStatus.State.Unsupported -> "Not offered"
}

private fun pushSummary(push: PushStatus): String? = when (push.state) {
    PushStatus.State.On -> "Through Google"
    PushStatus.State.Registering, PushStatus.State.Unknown -> null
    PushStatus.State.PermissionOff -> "Allow notifications for this app in Android settings"
    PushStatus.State.NoGooglePlay -> "Phone notifications come through Google Play services, which this phone doesn't have"
    PushStatus.State.ServerTooOld -> "It doesn't send phone notifications yet. Update it (Settings, Updates on the web), then try again."
    PushStatus.State.Failed -> push.detail
    PushStatus.State.Unsupported -> null
}

private fun openNotificationSettings(context: Context) {
    val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
        .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
}
