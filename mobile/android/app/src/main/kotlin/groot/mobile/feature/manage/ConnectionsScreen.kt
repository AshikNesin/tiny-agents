package groot.mobile.feature.manage

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.data.api.BotListEntry
import groot.mobile.data.api.Connection
import groot.mobile.feature.chat.openLink
import groot.mobile.ui.brand.Accents
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.components.AppCard
import groot.mobile.ui.components.Chip
import groot.mobile.ui.components.EmptyState
import groot.mobile.ui.components.Field
import groot.mobile.ui.components.IconBtn
import groot.mobile.ui.components.LoadableContent
import groot.mobile.ui.components.PrimaryButton
import groot.mobile.ui.components.ScreenScaffold
import groot.mobile.ui.components.SecondaryButton
import groot.mobile.ui.components.SectionLabel
import groot.mobile.ui.components.Sheet
import groot.mobile.ui.components.StatusDot
import groot.mobile.ui.components.rememberResource
import groot.mobile.ui.components.rememberStepUpGate

@Composable
private fun statusColor(status: String): Color = when (status) {
    "connected" -> Accents.success
    "connecting", "needs_auth" -> Accents.warning
    else -> MaterialTheme.colorScheme.error
}

private fun statusLabel(status: String): String = when (status) {
    "connected" -> "Connected"
    "connecting" -> "Connecting"
    "needs_auth" -> "Needs sign-in"
    else -> "Error"
}

@Composable
fun ConnectionsRoute(container: AppContainer, onBack: () -> Unit) {
    val resource = rememberResource("connections") { container.api.connections() }
    val bots by container.bots.state.collectAsStateWithLifecycle()
    val gate = rememberStepUpGate()
    var openId by remember { mutableStateOf<String?>(null) }
    var creating by remember { mutableStateOf(false) }
    ScreenScaffold(title = "Connections", onBack = onBack, actions = { IconBtn(AppIcons.Plus, "Add a connection", onClick = { creating = true }) }) {
        LoadableContent(resource) { connections ->
            if (connections.isEmpty()) {
                EmptyState(
                    "No connections yet",
                    icon = AppIcons.Plug,
                    body = "Connect an MCP server to give your bots its tools: your tracker, your docs, your calendar.",
                    actionLabel = "Add a connection",
                    onAction = { creating = true },
                )
            } else {
                LazyColumn(contentPadding = PaddingValues(S.lg), verticalArrangement = Arrangement.spacedBy(S.sm), modifier = Modifier.fillMaxSize()) {
                    items(connections, key = { it.id }) { connection ->
                        val status = bots.connectionStatus[connection.id] ?: connection.status
                        AppCard(onClick = { openId = connection.id }) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(S.sm)) {
                                StatusDot(statusColor(status))
                                Text(connection.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(statusLabel(status), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Text(
                                "${connection.tools.count { it.enabled }} of ${connection.tools.size} tools on · ${connection.botIds.size} bot(s)",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            connection.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                        }
                    }
                }
            }
            connections.firstOrNull { it.id == openId }?.let { connection ->
                ConnectionSheet(
                    container = container,
                    connection = connection,
                    bots = bots.sorted,
                    onDismiss = { openId = null },
                    onAct = { failure, block -> resource.act(failure, block = block) },
                    onDelete = {
                        gate.run { token ->
                            openId = null
                            resource.act("Could not remove the connection.") { container.api.deleteConnection(connection.id, token) }
                        }
                    },
                )
            }
        }
    }
    if (creating) {
        var name by remember { mutableStateOf("") }
        var url by remember { mutableStateOf("") }
        var headerName by remember { mutableStateOf("") }
        var secret by remember { mutableStateOf("") }
        Sheet(onDismiss = { creating = false }, title = "Add a connection") {
            Field(name, { name = it }, label = "Name", placeholder = "Linear")
            Field(url, { url = it }, label = "Server URL", placeholder = "https://mcp.example.com/mcp", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri))
            Field(headerName, { headerName = it }, label = "Auth header (optional)", placeholder = "Authorization")
            if (headerName.isNotBlank()) Field(secret, { secret = it }, label = "Header value", placeholder = "Bearer …", password = true)
            Text(
                "A server that signs in with OAuth needs no header: add it, then tap Sign in.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            PrimaryButton(
                "Add",
                enabled = name.isNotBlank() && url.isNotBlank() && (headerName.isBlank() || secret.isNotEmpty()),
                modifier = Modifier.fillMaxWidth(),
                onClick = {
                    gate.run { token ->
                        creating = false
                        resource.act("Could not add the connection.") {
                            container.api.createConnection(name.trim(), url.trim(), headerName.trim().ifEmpty { null }, secret.ifEmpty { null }, token)
                        }
                    }
                },
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ConnectionSheet(
    container: AppContainer,
    connection: Connection,
    bots: List<BotListEntry>,
    onDismiss: () -> Unit,
    onAct: (failure: String, block: suspend () -> Unit) -> Unit,
    onDelete: () -> Unit,
) {
    val context = LocalContext.current
    Sheet(onDismiss = onDismiss, title = connection.name) {
        Text(connection.url, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
            if (connection.status == "needs_auth") {
                PrimaryButton("Sign in", icon = AppIcons.External, onClick = {
                    onAct("Could not start the sign-in.") {
                        container.api.authorizeConnection(connection.id)?.let { openLink(context, container.session.serverUrl, it) }
                    }
                })
            }
            SecondaryButton("Reconnect", icon = AppIcons.Refresh, onClick = { onAct("Could not reconnect.") { container.api.reconnectConnection(connection.id) } })
            SecondaryButton("Remove", destructive = true, onClick = onDelete)
        }
        EveryBotRow(
            checked = connection.allBots,
            onCheckedChange = { on -> onAct("Could not update the connection.") { container.api.setConnectionAllBots(connection.id, on) } },
        )
        if (bots.isNotEmpty()) {
            SectionLabel("Bots that can use it")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
                for (bot in bots) {
                    val on = bot.id in connection.botIds
                    Chip(bot.name, selected = on, onClick = {
                        onAct("Could not update the connection.") {
                            container.api.setConnectionBots(connection.id, if (on) connection.botIds - bot.id else connection.botIds + bot.id)
                        }
                    })
                }
            }
        }
        if (connection.tools.isNotEmpty()) {
            SectionLabel("Tools")
            for (tool in connection.tools) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(S.md), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(tool.label, style = MaterialTheme.typography.bodyMedium)
                        Text(tool.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    Switch(
                        checked = tool.enabled,
                        onCheckedChange = { enabled -> onAct("Could not switch the tool.") { container.api.setConnectionTool(connection.id, tool.serverName, enabled) } },
                    )
                }
            }
        }
    }
}
