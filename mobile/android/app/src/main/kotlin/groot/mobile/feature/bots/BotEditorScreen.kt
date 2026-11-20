package groot.mobile.feature.bots

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.toMutableStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.data.BotsState
import groot.mobile.data.api.Bot
import groot.mobile.data.api.BotDraft
import groot.mobile.data.api.Capability
import groot.mobile.data.api.CatalogModel
import groot.mobile.data.api.Connection
import groot.mobile.data.api.Guest
import groot.mobile.data.api.Skill
import groot.mobile.data.api.ToolInfo
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.brand.Dims
import groot.mobile.ui.components.AppCard
import groot.mobile.ui.components.AppIcon
import groot.mobile.ui.components.Chip
import groot.mobile.ui.components.ConfirmDialog
import groot.mobile.ui.components.Field
import groot.mobile.ui.components.LoadableContent
import groot.mobile.ui.components.MenuRow
import groot.mobile.ui.components.PrimaryButton
import groot.mobile.ui.components.ScreenColumn
import groot.mobile.ui.components.ScreenScaffold
import groot.mobile.ui.components.SecondaryButton
import groot.mobile.ui.components.SectionLabel
import groot.mobile.ui.components.Sheet
import groot.mobile.ui.components.rememberResource
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import groot.mobile.ui.components.BotAvatar
import groot.mobile.ui.components.Avatar
import kotlinx.coroutines.delay
import androidx.compose.runtime.produceState

data class BotEditorData(val bot: Bot?, val skills: List<Skill>, val connections: List<Connection>, val guests: List<Guest>)

@Composable
fun BotEditorRoute(container: AppContainer, botId: String?, onBack: () -> Unit) {
    val bots by container.bots.state.collectAsStateWithLifecycle()
    val resource = rememberResource("bot-editor:${botId ?: "new"}") {
        coroutineScope {
            val bot = async { botId?.let { container.api.bot(it) } }
            val skills = async { runCatching { container.api.skills() }.getOrDefault(emptyList()) }
            val connections = async { runCatching { container.api.connections() }.getOrDefault(emptyList()) }
            val guests = async { runCatching { container.api.guests() }.getOrDefault(emptyList()) }
            BotEditorData(bot.await(), skills.await(), connections.await(), guests.await())
        }
    }
    ScreenScaffold(title = if (botId == null) "New bot" else "Edit bot", onBack = onBack) {
        LoadableContent(resource) { data ->
            BotEditor(
                data = data,
                bots = bots,
                onSave = { draft ->
                    resource.act("Could not save the bot.", done = onBack) {
                        val saved = if (data.bot == null) container.api.createBot(draft) else container.api.updateBot(data.bot.id, draft)
                        container.bots.refresh()
                        if (data.bot == null) container.session.selectBot(saved.id)
                    }
                },
                onDelete = {
                    resource.act("Could not delete the bot.", done = onBack) {
                        data.bot?.let { container.api.deleteBot(it.id) }
                        container.bots.refresh()
                    }
                },
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BotEditor(data: BotEditorData, bots: BotsState, onSave: (BotDraft) -> Unit, onDelete: () -> Unit) {
    val bot = data.bot
    var name by remember { mutableStateOf(bot?.name.orEmpty()) }
    var description by remember { mutableStateOf(bot?.description.orEmpty()) }
    var prompt by remember { mutableStateOf(bot?.systemPrompt.orEmpty()) }
    var modelId by remember { mutableStateOf(bot?.modelId ?: bots.models.defaultModelId) }
    var memory by remember { mutableStateOf(bot?.memoryEnabled ?: true) }
    var autoReview by remember { mutableStateOf(bot?.autoReview ?: false) }
    var yolo by remember { mutableStateOf(bot?.yoloByDefault ?: false) }
    var ownBrowser by remember { mutableStateOf(bot?.browserProfile == "own") }
    val permissions = remember { mutableStateMapOf<String, String>().apply { putAll(bot?.toolPermissions.orEmpty()) } }
    val skillIds = remember { (bot?.skillIds ?: emptyList()).toMutableStateList() }
    val connectionIds = remember { (bot?.connectionIds ?: emptyList()).toMutableStateList() }
    val guestIds = remember { (bot?.guestIds ?: emptyList()).toMutableStateList() }
    var pickModel by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }

    val model = bots.models.models.firstOrNull { it.id == (modelId ?: bots.models.defaultModelId) }
    val canSave = name.isNotBlank() && (bot != null || model != null)

    val face by produceState(initialValue = name, name) {
        delay(AVATAR_PREVIEW_DELAY_MS)
        value = name
    }

    ScreenColumn {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
            if (face.isBlank()) Avatar("?", size = Dims.avatarLarge) else BotAvatar(face, size = Dims.avatarLarge)
        }
        Field(name, { name = it }, label = "Name", placeholder = "Travel Planner")
        Field(description, { description = it }, label = "Description", placeholder = "What it is for, in a line")
        Field(
            prompt,
            { prompt = it },
            label = "Instructions",
            placeholder = "How it should behave, what it knows, what to avoid",
            singleLine = false,
            minLines = 4,
            maxLines = 14,
        )

        SectionLabel("Model")
        AppCard(onClick = { pickModel = true }) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(S.md)) {
                Column(Modifier.weight(1f)) {
                    Text(model?.name ?: "Choose a model", style = MaterialTheme.typography.bodyLarge)
                    if (model != null) {
                        Text(
                            listOfNotNull(model.providerName, model.note).joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                AppIcon(AppIcons.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }

        SectionLabel("Behaviour")
        AppCard {
            ToggleRow("Memory", "Remember what matters across chats", memory) { memory = it }
            ToggleRow("Auto-review", "Let a classifier approve low-risk asks", autoReview) { autoReview = it }
            ToggleRow("YOLO by default", "New chats run tools without asking", yolo) { yolo = it }
            ToggleRow("Its own browser", "Off: it shares one browser and its logins with your other bots", ownBrowser) { ownBrowser = it }
        }

        val toolkits = bots.capabilities.filter { it.kind == "toolkit" && !it.auto && it.tools.any { tool -> !tool.unattendedOnly } }
        if (toolkits.isNotEmpty()) {
            SectionLabel("Tools")
            for (capability in toolkits) {
                ToolkitCard(capability, permissions)
            }
        }

        if (data.skills.isNotEmpty()) {
            SectionLabel("Skills")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
                for (skill in data.skills) {
                    Chip(skill.name, selected = skill.id in skillIds, onClick = { if (!skillIds.remove(skill.id)) skillIds.add(skill.id) })
                }
            }
        }
        if (data.connections.isNotEmpty()) {
            SectionLabel("Connections")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
                for (connection in data.connections) {
                    Chip(connection.name, selected = connection.id in connectionIds, onClick = { if (!connectionIds.remove(connection.id)) connectionIds.add(connection.id) })
                }
            }
        }
        if (data.guests.isNotEmpty()) {
            SectionLabel("Shared with")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
                for (guest in data.guests) {
                    Chip(guest.name ?: guest.email, selected = guest.id in guestIds, onClick = { if (!guestIds.remove(guest.id)) guestIds.add(guest.id) })
                }
            }
        }

        PrimaryButton(
            text = if (bot == null) "Create bot" else "Save",
            enabled = canSave,
            modifier = Modifier.fillMaxWidth().padding(top = S.md),
            onClick = {
                onSave(
                    BotDraft(
                        name = name.trim(),
                        description = description.trim(),
                        systemPrompt = prompt,
                        modelId = model?.id,
                        toolPermissions = permissions.toMap(),
                        skillIds = skillIds.toList(),
                        connectionIds = connectionIds.toList(),
                        guestIds = guestIds.toList(),
                        memoryEnabled = memory,
                        autoReview = autoReview,
                        yoloByDefault = yolo,
                        browserProfile = if (ownBrowser) "own" else "shared",
                    ),
                )
            },
        )
        if (bot != null) {
            SecondaryButton("Delete bot", onClick = { confirmDelete = true }, destructive = true, modifier = Modifier.fillMaxWidth())
        }
    }

    if (pickModel) {
        ModelSheet(bots.models.models, selected = model?.id, onPick = {
            modelId = it
            pickModel = false
        }, onDismiss = { pickModel = false })
    }
    if (confirmDelete && bot != null) {
        ConfirmDialog(
            title = "Delete ${bot.name}?",
            text = "Its chats, memory and routines go with it. This cannot be undone.",
            confirmLabel = "Delete",
            destructive = true,
            onConfirm = {
                confirmDelete = false
                onDelete()
            },
            onDismiss = { confirmDelete = false },
        )
    }
}

@Composable
private fun ToggleRow(title: String, summary: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Switch) { onChange(!checked) }.padding(vertical = S.sm),
        horizontalArrangement = Arrangement.spacedBy(S.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(summary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
private fun ToolkitCard(capability: Capability, permissions: MutableMap<String, String>) {
    var open by remember { mutableStateOf(false) }
    val tools = capability.tools.filter { !it.unattendedOnly }
    AppCard {
        Row(
            Modifier.fillMaxWidth().clickable(role = Role.Button) { open = !open },
            horizontalArrangement = Arrangement.spacedBy(S.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(capability.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                Text(
                    capability.setupHint ?: capability.description,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (capability.setupHint != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text("${tools.count { (permissions[it.name] ?: it.defaultPermission) != "off" }}/${tools.size}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            AppIcon(if (open) AppIcons.ChevronUp else AppIcons.ChevronDown, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        AnimatedVisibility(open) {
            Column(Modifier.padding(top = S.md), verticalArrangement = Arrangement.spacedBy(S.md)) {
                for (tool in tools) ToolPermissionRow(tool, permissions[tool.name] ?: tool.defaultPermission) { permissions[tool.name] = it }
            }
        }
    }
}

@Composable
private fun ToolPermissionRow(tool: ToolInfo, value: String, onChange: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(S.xs)) {
        Text((tool.askLabel ?: tool.label).replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.bodyMedium)
        Row(Modifier.clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainerHigh).padding(S.xxs)) {
            for (option in if (tool.askOnly) listOf("ask", "off") else listOf("allow", "ask", "off")) {
                val selected = option == value
                Text(
                    option.replaceFirstChar { it.uppercase() },
                    style = MaterialTheme.typography.labelMedium,
                    color = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHigh)
                        .clickable(role = Role.RadioButton) { onChange(option) }
                        .padding(horizontal = S.lg, vertical = S.sm),
                )
            }
        }
    }
}

@Composable
private fun ModelSheet(models: List<CatalogModel>, selected: String?, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    Sheet(onDismiss = onDismiss, title = "Model") {
        if (models.isEmpty()) {
            Text("No models yet. Add a provider in the web app under Settings, Models.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for (model in models.filter { it.enabled || it.id == selected }) {
            MenuRow(
                icon = if (model.id == selected) AppIcons.Check else AppIcons.Sparkle,
                title = model.name,
                summary = listOfNotNull(model.providerName, model.note, model.unavailableReason?.let { "unavailable: ${it.replace('_', ' ')}" }).joinToString(" · "),
                onClick = { onPick(model.id) },
                modifier = Modifier.clip(RoundedCornerShape(Dims.fieldRadius)),
            )
        }
    }
}

private const val AVATAR_PREVIEW_DELAY_MS = 400L
