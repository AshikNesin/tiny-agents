package groot.mobile.feature.live

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.ui.brand.Accents
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.components.AppCard
import groot.mobile.ui.components.AppIcon
import groot.mobile.ui.components.EmptyState
import groot.mobile.ui.components.LoadableContent
import groot.mobile.ui.components.ScreenScaffold
import groot.mobile.ui.components.StatusDot
import groot.mobile.ui.components.rememberResource
import kotlinx.coroutines.delay

@Composable
fun LivePageRoute(container: AppContainer, surface: String, onOpen: (profile: String) -> Unit, onBack: () -> Unit) {
    val browser = surface == "browser"
    val resource = rememberResource("live-page:$surface") { container.api.liveProfiles(surface) }
    LaunchedEffect(resource) {
        while (true) {
            delay(REFRESH_MS)
            resource.refresh()
        }
    }
    ScreenScaffold(title = if (browser) "Browser" else "Computer", onBack = onBack) {
        LoadableContent(resource) { list ->
            when {
                !list.available && !browser -> EmptyState(
                    "The computer is not set up",
                    icon = AppIcons.Monitor,
                    body = list.setupHint ?: "This server has no sandbox to run a desktop on.",
                )
                list.profiles.isEmpty() -> EmptyState(
                    if (browser) "No browsers yet" else "No desktops yet",
                    icon = if (browser) AppIcons.Globe else AppIcons.Monitor,
                    body = "One appears once you have a bot.",
                )
                else -> LazyColumn(contentPadding = PaddingValues(S.lg), verticalArrangement = Arrangement.spacedBy(S.sm), modifier = Modifier.fillMaxSize()) {
                    if (!list.available && list.setupHint != null) {
                        item { Text(list.setupHint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                    items(list.profiles, key = { it.profile }) { item ->
                        AppCard(onClick = { onOpen(item.profile) }) {
                            Row(horizontalArrangement = Arrangement.spacedBy(S.md), verticalAlignment = Alignment.CenterVertically) {
                                StatusDot(
                                    when {
                                        item.status.starting -> Accents.warning
                                        item.status.active -> Accents.success
                                        else -> MaterialTheme.colorScheme.outline
                                    },
                                )
                                Column(Modifier.weight(1f)) {
                                    Text(item.label, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                                    Text(
                                        listOfNotNull(
                                            linkLabel(item.status, if (item.status.active) LiveLink.Live else LiveLink.Idle).substringBefore(","),
                                            item.botNames.takeIf { it.isNotEmpty() }?.joinToString(", "),
                                        ).joinToString(" · "),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                AppIcon(AppIcons.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }
        }
    }
}

private const val REFRESH_MS = 4_000L
