package groot.mobile.feature.manage

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.toMutableStateList
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.data.api.BotListEntry
import groot.mobile.data.api.Skill
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

private val SKILL_NAME = Regex("^[a-z0-9]+(-[a-z0-9]+)*$")

/** Skills: instructions a bot loads when a task calls for them. Write one, edit it, give it to bots. */
@Composable
fun SkillsRoute(container: AppContainer, onBack: () -> Unit) {
    val resource = rememberResource("skills") { container.api.skills() }
    val bots by container.bots.state.collectAsStateWithLifecycle()
    var editing by remember { mutableStateOf<Skill?>(null) }
    var creating by remember { mutableStateOf(false) }
    ScreenScaffold(title = "Skills", onBack = onBack, actions = { IconBtn(AppIcons.Plus, "New skill", onClick = { creating = true }) }) {
        LoadableContent(resource) { skills ->
            if (skills.isEmpty()) {
                EmptyState(
                    "No skills yet",
                    icon = AppIcons.Sparkle,
                    body = "A skill is a set of instructions a bot pulls in when it needs them. Import from GitHub in the web app, or write one here.",
                    actionLabel = "New skill",
                    onAction = { creating = true },
                )
            } else {
                LazyColumn(contentPadding = PaddingValues(S.lg), verticalArrangement = Arrangement.spacedBy(S.sm), modifier = Modifier.fillMaxSize()) {
                    items(skills, key = { it.id }) { skill ->
                        AppCard(onClick = { editing = skill }) {
                            Text(skill.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                            Text(skill.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(
                                listOfNotNull(
                                    if (skill.botIds.isEmpty()) "No bots use it" else "${skill.botIds.size} bot(s)",
                                    if (skill.fileCount > 0) "${skill.fileCount} file(s)" else null,
                                ).joinToString(" · "),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
    }
    if (creating || editing != null) {
        val skill = editing
        SkillForm(
            skill = skill,
            bots = bots.sorted,
            onDismiss = {
                creating = false
                editing = null
            },
            onSave = { name, description, body, botIds ->
                creating = false
                editing = null
                resource.act("Could not save the skill.") {
                    val saved = skill ?: container.api.createSkill(name, description, body)
                    container.api.updateSkill(saved.id, name, description, body, botIds)
                }
            },
            onDelete = {
                editing = null
                resource.act("Could not delete the skill.") { skill?.let { container.api.deleteSkill(it.id) } }
            },
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SkillForm(
    skill: Skill?,
    bots: List<BotListEntry>,
    onDismiss: () -> Unit,
    onSave: (name: String, description: String, body: String, botIds: List<String>) -> Unit,
    onDelete: () -> Unit,
) {
    var name by remember { mutableStateOf(skill?.name.orEmpty()) }
    var description by remember { mutableStateOf(skill?.description.orEmpty()) }
    var body by remember { mutableStateOf(skill?.body.orEmpty()) }
    val botIds = remember { (skill?.botIds ?: emptyList()).toMutableStateList() }
    val nameOk = SKILL_NAME.matches(name.trim())
    Sheet(onDismiss = onDismiss, title = if (skill == null) "New skill" else "Edit skill") {
        Field(
            name,
            { name = it },
            label = "Name",
            placeholder = "weekly-report",
            isError = name.isNotEmpty() && !nameOk,
            supporting = "Lowercase letters, digits and hyphens",
        )
        Field(description, { description = it }, label = "Description", placeholder = "When a bot should use it")
        Field(body, { body = it }, label = "Instructions", singleLine = false, minLines = 5, maxLines = 16)
        if (bots.isNotEmpty()) {
            SectionLabel("Bots that can use it")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
                for (bot in bots) Chip(bot.name, selected = bot.id in botIds, onClick = { if (!botIds.remove(bot.id)) botIds.add(bot.id) })
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(S.sm)) {
            PrimaryButton("Save", enabled = nameOk && description.isNotBlank(), onClick = { onSave(name.trim(), description.trim(), body, botIds.toList()) })
            if (skill != null) SecondaryButton("Delete", destructive = true, onClick = onDelete)
        }
    }
}
