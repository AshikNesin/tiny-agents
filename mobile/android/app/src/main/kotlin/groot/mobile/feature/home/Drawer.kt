package groot.mobile.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import groot.kit.theme.S
import groot.mobile.data.BotsState
import groot.mobile.data.ViewerRole
import groot.mobile.data.api.BotListEntry
import groot.mobile.data.api.CodeThreadSummary
import groot.mobile.data.code.activeThreads
import groot.mobile.data.code.starterOf
import groot.mobile.data.api.SessionUser
import groot.mobile.feature.chat.CountBadge
import groot.mobile.feature.chat.TypingDots
import groot.mobile.navigation.Routes
import groot.mobile.ui.brand.Accents
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.brand.Dims
import groot.mobile.ui.components.ActionTile
import groot.mobile.ui.components.AppIcon
import groot.mobile.ui.components.Avatar
import groot.mobile.ui.components.BotAvatar
import groot.mobile.ui.components.IconBtn
import groot.mobile.ui.components.SectionLabel
import groot.mobile.ui.components.StatusDot
import groot.mobile.ui.components.relativeTime

data class DrawerDestination(val label: String, val icon: ImageVector, val route: String)

val OWNER_DESTINATIONS: List<DrawerDestination> = listOf(
    DrawerDestination("Tasks", AppIcons.Tasks, Routes.TASKS),
    DrawerDestination("Code", AppIcons.Code, Routes.CODE),
    DrawerDestination("Terminal", AppIcons.Terminal, Routes.TERMINAL),
    DrawerDestination("Computer", AppIcons.Monitor, Routes.livePage("computer")),
    DrawerDestination("Browser", AppIcons.Globe, Routes.livePage("browser")),
    DrawerDestination("Routines", AppIcons.Clock, Routes.ROUTINES),
    DrawerDestination("Skills", AppIcons.Sparkle, Routes.SKILLS),
    DrawerDestination("Memory", AppIcons.Layers, Routes.memory(null)),
    DrawerDestination("Connections", AppIcons.Plug, Routes.CONNECTIONS),
    DrawerDestination("Vault", AppIcons.Key, Routes.VAULT),
)

@Composable
fun AppDrawer(
    bots: BotsState,
    selectedBotId: String?,
    user: SessionUser?,
    onSelectBot: (String) -> Unit,
    onNewBot: () -> Unit,
    onNavigate: (String) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    threads: List<CodeThreadSummary>? = null,
    now: () -> Long = System::currentTimeMillis,
) {
    var query by rememberSaveable { mutableStateOf("") }
    val shown = bots.sorted.filter { query.isBlank() || it.name.contains(query.trim(), ignoreCase = true) }
    Column(
        modifier
            .width(Dims.drawerWidth)
            .fillMaxHeight()
            .background(MaterialTheme.colorScheme.background)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(start = S.lg, end = S.sm, top = S.sm, bottom = S.sm),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(S.sm),
        ) {
            SearchField(query, onQuery = { query = it }, modifier = Modifier.weight(1f))
            if (bots.role == ViewerRole.Owner) IconBtn(AppIcons.Compose, "New bot", onNewBot)
        }
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(horizontal = S.sm, vertical = S.xs)) {
            if (bots.role == ViewerRole.Owner && query.isBlank() && threads != null) {
                val active = activeThreads(threads, DRAWER_THREADS)
                item(key = "threads-label") { SectionLabel("Threads", Modifier.padding(start = S.md)) }
                items(active.shown, key = { "thread-${it.id}" }) { row ->
                    DrawerThreadRow(row) { onNavigate(Routes.codeThread(row.id)) }
                }
                item(key = "threads-all") {
                    Text(
                        if (active.more > 0) "All threads, ${active.more} more" else "All threads",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(Dims.fieldRadius))
                            .clickable(role = Role.Button) { onNavigate(Routes.CODE) }
                            .padding(horizontal = S.md, vertical = S.sm),
                    )
                }
                item(key = "bots-label") { SectionLabel("Bots", Modifier.padding(start = S.md, top = S.md)) }
            }
            if (bots.error != null && bots.bots.isEmpty()) {
                item {
                    Column(Modifier.padding(S.lg), verticalArrangement = Arrangement.spacedBy(S.sm)) {
                        Text(bots.error, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(
                            "Try again",
                            style = MaterialTheme.typography.labelLarge,
                            modifier = Modifier.clickable(role = Role.Button, onClick = onRetry).padding(vertical = S.sm),
                        )
                    }
                }
            }
            items(shown, key = { it.id }) { bot ->
                BotRow(bot = bot, selected = bot.id == selectedBotId, now = now, onClick = { onSelectBot(bot.id) })
            }
            if (shown.isEmpty() && bots.error == null && !bots.loading) {
                item {
                    Text(
                        if (query.isBlank()) "No bots yet. Create your first one." else "No bot matches \"${query.trim()}\".",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(S.lg),
                    )
                }
            }
            if (bots.role == ViewerRole.Owner && query.isBlank()) {
                item(key = "workspace-label") { SectionLabel("Workspace", Modifier.padding(start = S.md, top = S.lg)) }
                items(OWNER_DESTINATIONS.chunked(WORKSPACE_COLUMNS), key = { row -> row.first().route }) { row ->
                    Row(Modifier.fillMaxWidth()) {
                        for (destination in row) {
                            ActionTile(destination.icon, destination.label, { onNavigate(destination.route) }, Modifier.weight(1f))
                        }
                        repeat(WORKSPACE_COLUMNS - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
        }
        Row(
            Modifier
                .fillMaxWidth()
                .clickable(role = Role.Button, onClickLabel = "Settings") { onNavigate(Routes.SETTINGS) }
                .padding(horizontal = S.lg, vertical = S.md),
            horizontalArrangement = Arrangement.spacedBy(S.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Avatar(user?.name ?: user?.email ?: "?", size = Dims.avatarSmall)
            Column(Modifier.weight(1f)) {
                Text(user?.name ?: user?.email.orEmpty(), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (bots.role == ViewerRole.Guest) Text("Guest", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            AppIcon(AppIcons.Settings, "Settings", tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

private const val DRAWER_THREADS = 5

@Composable
private fun DrawerThreadRow(row: CodeThreadSummary, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Dims.fieldRadius))
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = S.md, vertical = S.sm),
        horizontalArrangement = Arrangement.spacedBy(S.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (row.working) {
            TypingDots(Modifier.height(S.lg))
        } else {
            StatusDot(Accents.warning)
        }
        Text(
            row.title.ifBlank { "Untitled" },
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = if (row.unread) FontWeight.SemiBold else FontWeight.Normal,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        val note = if (row.statusReason == "asks you") "asks you" else starterOf(row)
        if (note != null) {
            Text(
                note,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun SearchField(query: String, onQuery: (String) -> Unit, modifier: Modifier = Modifier) {
    val style = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface)
    BasicTextField(
        value = query,
        onValueChange = onQuery,
        singleLine = true,
        textStyle = style,
        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
        modifier = modifier,
        decorationBox = { inner ->
            Row(
                Modifier
                    .height(Dims.iconButton)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.surfaceContainer)
                    .padding(horizontal = S.md),
                horizontalArrangement = Arrangement.spacedBy(S.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                AppIcon(AppIcons.Search, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, size = Dims.iconSmall)
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                    if (query.isEmpty()) Text("Search", style = style, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    inner()
                }
            }
        },
    )
}

@Composable
private fun BotRow(bot: BotListEntry, selected: Boolean, now: () -> Long, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Dims.fieldRadius))
            .background(if (selected) MaterialTheme.colorScheme.surfaceContainer else MaterialTheme.colorScheme.background)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = S.md, vertical = S.sm),
        horizontalArrangement = Arrangement.spacedBy(S.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BotAvatar(bot.name)
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(S.xs)) {
                Text(
                    bot.name,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = if (bot.unread) FontWeight.Bold else FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (bot.pinnedAt != null) AppIcon(AppIcons.Pin, "Pinned", tint = MaterialTheme.colorScheme.onSurfaceVariant, size = Dims.iconSmall)
            }
            Text(
                bot.lastMessagePreview?.takeIf { it.isNotBlank() } ?: bot.description.ifBlank { "No messages yet" },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(S.xs)) {
            when {
                bot.needsYou -> CountBadge(bot.approvals + bot.questions)
                bot.replying -> TypingDots(Modifier.height(S.lg))
                else -> {
                    Text(relativeTime(bot.lastActivityAt, now()), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (bot.unread) StatusDot(MaterialTheme.colorScheme.primary) else Spacer(Modifier.height(Dims.dot))
                }
            }
        }
    }
}

private const val WORKSPACE_COLUMNS = 3
