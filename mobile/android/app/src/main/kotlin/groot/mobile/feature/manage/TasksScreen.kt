package groot.mobile.feature.manage

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextDecoration
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.data.api.OwnerTask
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.brand.Dims
import groot.mobile.ui.components.AppIcon
import groot.mobile.ui.components.Chip
import groot.mobile.ui.components.EmptyState
import groot.mobile.ui.components.Field
import groot.mobile.ui.components.Loadable
import groot.mobile.ui.components.LoadableContent
import groot.mobile.ui.components.PrimaryButton
import groot.mobile.ui.components.ScreenScaffold
import groot.mobile.ui.components.SecondaryButton
import groot.mobile.ui.components.Sheet
import groot.mobile.ui.components.rememberResource

private val PRIORITIES = listOf("low", "medium", "high", "urgent")

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun TasksRoute(container: AppContainer, onBack: () -> Unit) {
    val resource = rememberResource("tasks") { container.api.tasks() }
    var showDone by rememberSaveable { mutableStateOf(false) }
    var title by rememberSaveable { mutableStateOf("") }
    var editing by remember { mutableStateOf<OwnerTask?>(null) }
    val add = {
        val text = title.trim()
        if (text.isNotEmpty()) {
            title = ""
            resource.act("Could not add the task.") { container.api.createTask(text) }
        }
    }
    val state by resource.state.collectAsStateWithLifecycle()
    TasksScreen(
        state = state,
        showDone = showDone,
        onShowDoneChange = { showDone = it },
        title = title,
        onTitleChange = { title = it },
        onAdd = add,
        onToggle = { task ->
            resource.act("Could not update the task.") {
                container.api.updateTask(task.id, status = if (task.status == "done") "todo" else "done")
            }
        },
        onOpen = { editing = it },
        onRetry = resource::refresh,
        onBack = onBack,
    )
    editing?.let { task ->
        var editTitle by remember(task.id) { mutableStateOf(task.title) }
        var description by remember(task.id) { mutableStateOf(task.description) }
        var priority by remember(task.id) { mutableStateOf(task.priority) }
        Sheet(onDismiss = { editing = null }, title = "Task") {
            Field(editTitle, { editTitle = it }, label = "Title")
            Field(description, { description = it }, label = "Notes", singleLine = false, minLines = 2)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm)) {
                for (option in PRIORITIES) Chip(option.replaceFirstChar { it.uppercase() }, selected = priority == option, onClick = { priority = option })
            }
            Row(horizontalArrangement = Arrangement.spacedBy(S.sm)) {
                PrimaryButton("Save", enabled = editTitle.isNotBlank(), onClick = {
                    editing = null
                    resource.act("Could not save the task.") { container.api.updateTask(task.id, title = editTitle.trim(), description = description.trim(), priority = priority) }
                })
                SecondaryButton("Delete", destructive = true, onClick = {
                    editing = null
                    resource.act("Could not delete the task.") { container.api.deleteTask(task.id) }
                })
            }
        }
    }
}

@Composable
fun TasksScreen(
    state: Loadable<List<OwnerTask>>,
    showDone: Boolean,
    onShowDoneChange: (Boolean) -> Unit,
    title: String,
    onTitleChange: (String) -> Unit,
    onAdd: () -> Unit,
    onToggle: (OwnerTask) -> Unit,
    onOpen: (OwnerTask) -> Unit,
    onRetry: () -> Unit,
    onBack: () -> Unit,
) {
    ScreenScaffold(title = "Tasks", onBack = onBack) {
        Column(Modifier.fillMaxSize().imePadding()) {
            Row(Modifier.padding(horizontal = S.lg, vertical = S.sm), horizontalArrangement = Arrangement.spacedBy(S.sm)) {
                Chip("Open", selected = !showDone, onClick = { onShowDoneChange(false) })
                Chip("Done", selected = showDone, onClick = { onShowDoneChange(true) })
            }
            Box(Modifier.weight(1f)) {
                LoadableContent(state, onRetry) { tasks ->
                    val shown = tasks.filter { (it.status == "done") == showDone }
                    if (shown.isEmpty()) {
                        EmptyState(if (showDone) "Nothing done yet" else "Nothing to do", icon = AppIcons.Tasks, body = if (showDone) null else "Add a task below, or ask a bot to.")
                    } else {
                        LazyColumn(contentPadding = PaddingValues(horizontal = S.lg), modifier = Modifier.fillMaxSize()) {
                            items(shown, key = { it.id }) { task ->
                                TaskRow(task = task, onToggle = { onToggle(task) }, onOpen = { onOpen(task) })
                            }
                        }
                    }
                }
            }
            if (!showDone) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = S.lg, vertical = S.sm).navigationBarsPadding(),
                    horizontalArrangement = Arrangement.spacedBy(S.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Field(
                        value = title,
                        onValueChange = onTitleChange,
                        placeholder = "Add a task",
                        modifier = Modifier.weight(1f),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { onAdd() }),
                    )
                    PrimaryButton("Add", onClick = onAdd, enabled = title.isNotBlank())
                }
            }
        }
    }
}

@Composable
private fun TaskRow(task: OwnerTask, onToggle: () -> Unit, onOpen: () -> Unit) {
    val done = task.status == "done"
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onOpen).padding(vertical = S.md),
        horizontalArrangement = Arrangement.spacedBy(S.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(Dims.iconLarge)
                .clip(CircleShape)
                .background(if (done) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.background)
                .border(Dims.stroke, if (done) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline, CircleShape)
                .toggleable(value = done, role = Role.Checkbox, onValueChange = { onToggle() })
                .semantics { contentDescription = "Done" },
            contentAlignment = Alignment.Center,
        ) {
            if (done) AppIcon(AppIcons.Check, null, tint = MaterialTheme.colorScheme.onPrimary, size = Dims.iconSmall)
        }
        Column(Modifier.weight(1f)) {
            Text(
                task.title,
                style = MaterialTheme.typography.bodyLarge,
                textDecoration = if (done) TextDecoration.LineThrough else null,
                color = if (done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
            )
            val details = listOfNotNull(
                task.priority.takeIf { it == "high" || it == "urgent" }?.replaceFirstChar { it.uppercase() },
                task.status.takeIf { it == "in_progress" }?.let { "In progress" },
                task.description.takeIf { it.isNotBlank() },
            )
            if (details.isNotEmpty()) {
                Text(details.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
            }
        }
    }
}
