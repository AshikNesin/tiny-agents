package groot.mobile.feature.manage

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.data.api.Memory
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
import groot.mobile.ui.components.rememberResource

private val CATEGORIES = listOf("preference", "fact", "goal", "habit")

@Composable
fun MemoryRoute(container: AppContainer, initialBotId: String?, onBack: () -> Unit) {
    val bots by container.bots.state.collectAsStateWithLifecycle()
    var botId by rememberSaveable { mutableStateOf(initialBotId) }
    val current = bots.bot(botId) ?: bots.sorted.firstOrNull()
    var adding by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<Memory?>(null) }
    ScreenScaffold(
        title = "Memory",
        subtitle = current?.name,
        onBack = onBack,
        actions = { if (current != null) IconBtn(AppIcons.Plus, "Add a memory", onClick = { adding = true }) },
    ) {
        if (current == null) {
            EmptyState("No bots yet", icon = AppIcons.Layers)
            return@ScreenScaffold
        }
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = S.lg, vertical = S.sm), horizontalArrangement = Arrangement.spacedBy(S.sm)) {
                for (bot in bots.sorted) Chip(bot.name, selected = bot.id == current.id, onClick = { botId = bot.id })
            }
            key(current.id) {
                val resource = rememberResource("memory:${current.id}") { container.api.memories(current.id) }
                Box(Modifier.weight(1f)) {
                    LoadableContent(resource) { memories ->
                        val active = memories.filter { it.status == "active" }
                        val past = memories.filter { it.status != "active" && it.status != "deleted" }
                        if (active.isEmpty() && past.isEmpty()) {
                            EmptyState("Nothing remembered yet", icon = AppIcons.Layers, body = "${current.name} saves what matters as you chat. You can also add a memory yourself.")
                        } else {
                            LazyColumn(contentPadding = PaddingValues(S.lg), verticalArrangement = Arrangement.spacedBy(S.sm), modifier = Modifier.fillMaxSize()) {
                                for (category in CATEGORIES) {
                                    val group = active.filter { it.category == category }
                                    if (group.isEmpty()) continue
                                    item(key = "label:$category") { SectionLabel("${category}s") }
                                    items(group, key = { it.id }) { memory -> MemoryCard(memory, onClick = { editing = memory }) }
                                }
                                if (past.isNotEmpty()) {
                                    item(key = "label:past") { SectionLabel("No longer used") }
                                    items(past, key = { it.id }) { memory -> MemoryCard(memory, onClick = { editing = memory }) }
                                }
                            }
                        }
                    }
                }
                if (adding || editing != null) {
                    val memory = editing
                    MemoryForm(
                        memory = memory,
                        onDismiss = {
                            adding = false
                            editing = null
                        },
                        onSave = { text, category ->
                            adding = false
                            editing = null
                            resource.act("Could not save the memory.") {
                                if (memory == null) container.api.createMemory(current.id, text, category) else container.api.updateMemory(memory.id, text, category)
                            }
                        },
                        onRestore = {
                            editing = null
                            resource.act("Could not restore the memory.") { memory?.let { container.api.updateMemory(it.id, restore = true) } }
                        },
                        onDelete = {
                            editing = null
                            resource.act("Could not delete the memory.") { memory?.let { container.api.deleteMemory(it.id) } }
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun MemoryCard(memory: Memory, onClick: () -> Unit) {
    AppCard(onClick = onClick) {
        Text(
            memory.text,
            style = MaterialTheme.typography.bodyMedium,
            color = if (memory.status == "active") MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (memory.status != "active") {
            Text(memory.status.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MemoryForm(memory: Memory?, onDismiss: () -> Unit, onSave: (String, String) -> Unit, onRestore: () -> Unit, onDelete: () -> Unit) {
    var text by remember { mutableStateOf(memory?.text.orEmpty()) }
    var category by remember { mutableStateOf(memory?.category ?: "fact") }
    Sheet(onDismiss = onDismiss, title = if (memory == null) "Add a memory" else "Memory") {
        Field(text, { text = it }, placeholder = "Prefers window seats", singleLine = false, minLines = 2)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
            for (option in CATEGORIES) Chip(option.replaceFirstChar { it.uppercase() }, selected = category == option, onClick = { category = option })
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
            PrimaryButton("Save", enabled = text.isNotBlank(), onClick = { onSave(text.trim(), category) })
            if (memory != null && memory.status != "active") SecondaryButton("Restore", onClick = onRestore)
            if (memory != null) SecondaryButton("Delete", destructive = true, onClick = onDelete)
        }
    }
}
