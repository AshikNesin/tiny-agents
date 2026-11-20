package groot.mobile.feature.manage

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.data.api.BotListEntry
import groot.mobile.data.api.Routine
import groot.mobile.data.api.RoutineRun
import groot.mobile.ui.brand.Accents
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.components.AppCard
import groot.mobile.ui.components.Chip
import groot.mobile.ui.components.EmptyState
import groot.mobile.ui.components.Field
import groot.mobile.ui.components.IconBtn
import groot.mobile.ui.components.Loadable
import groot.mobile.ui.components.LoadableContent
import groot.mobile.ui.components.PrimaryButton
import groot.mobile.ui.components.ScreenScaffold
import groot.mobile.ui.components.SecondaryButton
import groot.mobile.ui.components.SectionLabel
import groot.mobile.ui.components.Sheet
import groot.mobile.ui.components.StatusDot
import groot.mobile.ui.components.dateTime
import groot.mobile.ui.components.rememberResource

@Composable
fun RoutinesRoute(container: AppContainer, onBack: () -> Unit) {
    val resource = rememberResource("routines") { container.api.routines() }
    val bots by container.bots.state.collectAsStateWithLifecycle()
    var open by remember { mutableStateOf<Routine?>(null) }
    var editing by remember { mutableStateOf<Routine?>(null) }
    var creating by remember { mutableStateOf(false) }
    val state by resource.state.collectAsStateWithLifecycle()
    RoutinesScreen(
        state = state,
        canCreate = bots.bots.isNotEmpty(),
        onCreate = { creating = true },
        onOpen = { open = it },
        onRetry = resource::refresh,
        onBack = onBack,
    )

    open?.let { routine ->
        RoutineSheet(
            container = container,
            routine = routine,
            onDismiss = { open = null },
            onEdit = {
                open = null
                editing = routine
            },
            onAction = { failure, block ->
                open = null
                resource.act(failure, block = block)
            },
        )
    }
    if (creating || editing != null) {
        val routine = editing
        RoutineForm(
            routine = routine,
            bots = bots.sorted,
            onDismiss = {
                creating = false
                editing = null
            },
            onSave = { botId, name, prompt, form ->
                val schedule = form.toSchedule() ?: return@RoutineForm
                creating = false
                editing = null
                resource.act("Could not save the routine.") {
                    if (routine == null) {
                        container.api.createRoutine(botId, name, prompt, schedule)
                    } else {
                        container.api.updateRoutine(routine.id, botId, name, prompt, schedule)
                    }
                }
            },
        )
    }
}

@Composable
fun RoutinesScreen(
    state: Loadable<List<Routine>>,
    canCreate: Boolean,
    onCreate: () -> Unit,
    onOpen: (Routine) -> Unit,
    onRetry: () -> Unit,
    onBack: () -> Unit,
) {
    ScreenScaffold(
        title = "Routines",
        onBack = onBack,
        actions = { IconBtn(AppIcons.Plus, "New routine", onClick = onCreate, enabled = canCreate) },
    ) {
        LoadableContent(state, onRetry) { routines ->
            if (routines.isEmpty()) {
                EmptyState(
                    "No routines yet",
                    icon = AppIcons.Clock,
                    body = "A routine sends a bot the same prompt on a schedule, like a morning summary.",
                    actionLabel = if (canCreate) "New routine" else null,
                    onAction = onCreate,
                )
            } else {
                LazyColumn(contentPadding = PaddingValues(S.lg), verticalArrangement = Arrangement.spacedBy(S.sm), modifier = Modifier.fillMaxSize()) {
                    items(routines, key = { it.id }) { routine -> RoutineCard(routine, onClick = { onOpen(routine) }) }
                }
            }
        }
    }
}

@Composable
private fun RoutineCard(routine: Routine, onClick: () -> Unit) {
    AppCard(onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(S.sm)) {
            StatusDot(
                when (routine.state) {
                    "scheduled" -> Accents.success
                    "struggling", "auto_paused" -> Accents.warning
                    else -> MaterialTheme.colorScheme.outline
                },
            )
            Text(routine.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            Text(routine.botName, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(
            listOfNotNull(
                routine.scheduleDescription,
                when (routine.state) {
                    "paused" -> "Paused"
                    "done" -> "Done"
                    "auto_paused" -> routine.pausedReason
                    "struggling" -> "Last run was blocked"
                    else -> routine.nextRunAt?.let { "Next ${dateTime(it)}" }
                },
            ).joinToString(" · "),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = S.xs),
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RoutineSheet(
    container: AppContainer,
    routine: Routine,
    onDismiss: () -> Unit,
    onEdit: () -> Unit,
    onAction: (failure: String, block: suspend () -> Unit) -> Unit,
) {
    val runs = rememberResource("routine-runs:${routine.id}") { container.api.routineRuns(routine.id) }
    Sheet(onDismiss = onDismiss, title = routine.name) {
        Text(routine.prompt, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 6, overflow = TextOverflow.Ellipsis)
        Text("${routine.scheduleDescription} (IST) · ${routine.botName}", style = MaterialTheme.typography.labelMedium)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
            PrimaryButton("Run now", icon = AppIcons.Play, onClick = { onAction("Could not run the routine.") { container.api.runRoutine(routine.id) } })
            if (routine.enabled) {
                SecondaryButton("Pause", icon = AppIcons.Pause, onClick = { onAction("Could not pause the routine.") { container.api.pauseRoutine(routine.id) } })
            } else {
                SecondaryButton("Resume", icon = AppIcons.Play, onClick = { onAction("Could not resume the routine.") { container.api.resumeRoutine(routine.id) } })
            }
            SecondaryButton("Edit", icon = AppIcons.Pencil, onClick = onEdit)
            SecondaryButton("Delete", destructive = true, onClick = { onAction("Could not delete the routine.") { container.api.deleteRoutine(routine.id) } })
        }
        SectionLabel("Recent runs")
        val state by runs.state.collectAsStateWithLifecycle()
        val list = (state as? Loadable.Ready<List<RoutineRun>>)?.value
        when {
            list == null -> Text("Loading", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            list.isEmpty() -> Text("It has not run yet.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            else -> for (run in list.take(MAX_RUNS)) {
                Column {
                    Text("${dateTime(run.scheduledFor)} · ${run.status}", style = MaterialTheme.typography.bodyMedium)
                    (run.error ?: run.output)?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RoutineForm(
    routine: Routine?,
    bots: List<BotListEntry>,
    onDismiss: () -> Unit,
    onSave: (botId: String, name: String, prompt: String, form: ScheduleForm) -> Unit,
) {
    var botId by remember { mutableStateOf(routine?.botId ?: bots.firstOrNull()?.id.orEmpty()) }
    var name by remember { mutableStateOf(routine?.name.orEmpty()) }
    var prompt by remember { mutableStateOf(routine?.prompt.orEmpty()) }
    var form by remember { mutableStateOf(routine?.let { ScheduleForm.of(it.schedule) } ?: ScheduleForm()) }
    Sheet(onDismiss = onDismiss, title = if (routine == null) "New routine" else "Edit routine") {
        Field(name, { name = it }, label = "Name", placeholder = "Morning summary")
        Field(prompt, { prompt = it }, label = "Prompt", placeholder = "What the bot should do each time", singleLine = false, minLines = 3)
        SectionLabel("Bot")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
            for (bot in bots) Chip(bot.name, selected = bot.id == botId, onClick = { botId = bot.id })
        }
        SectionLabel("Schedule (IST)")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
            for (kind in ScheduleForm.Kind.entries) Chip(kind.label, selected = form.kind == kind, onClick = { form = form.copy(kind = kind) })
        }
        when (form.kind) {
            ScheduleForm.Kind.Daily, ScheduleForm.Kind.Weekdays -> Field(form.time, { form = form.copy(time = it) }, label = "Time", placeholder = "09:00")
            ScheduleForm.Kind.Weekly -> {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(S.xs), verticalArrangement = Arrangement.spacedBy(S.xs)) {
                    ScheduleForm.WEEKDAYS.forEachIndexed { index, day -> Chip(day, selected = form.weekday == index, onClick = { form = form.copy(weekday = index) }) }
                }
                Field(form.time, { form = form.copy(time = it) }, label = "Time", placeholder = "09:00")
            }
            ScheduleForm.Kind.Interval -> FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
                for ((label, minutes) in INTERVALS) Chip(label, selected = form.minutes == minutes, onClick = { form = form.copy(minutes = minutes) })
            }
            ScheduleForm.Kind.Once -> {
                Field(form.date, { form = form.copy(date = it) }, label = "Date", placeholder = "2026-12-01", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                Field(form.time, { form = form.copy(time = it) }, label = "Time", placeholder = "09:00")
            }
            ScheduleForm.Kind.Cron -> Field(form.cron, { form = form.copy(cron = it) }, label = "Cron expression", placeholder = "0 9 * * 1-5", monospace = true)
        }
        form.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
        PrimaryButton(
            "Save",
            enabled = name.isNotBlank() && prompt.isNotBlank() && botId.isNotEmpty() && form.error == null,
            onClick = { onSave(botId, name.trim(), prompt.trim(), form) },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

private val INTERVALS = listOf("15 min" to 15, "30 min" to 30, "1 hour" to 60, "2 hours" to 120, "4 hours" to 240, "6 hours" to 360, "12 hours" to 720, "24 hours" to 1440)
private const val MAX_RUNS = 8
