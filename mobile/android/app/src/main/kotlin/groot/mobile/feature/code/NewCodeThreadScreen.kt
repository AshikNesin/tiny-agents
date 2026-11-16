package groot.mobile.feature.code

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.imePadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.data.api.CodeHarness
import groot.mobile.data.api.CodeModel
import groot.mobile.data.api.CodeProject
import groot.mobile.data.api.PermissionModes
import groot.mobile.data.code.recentDirectories
import groot.mobile.data.code.shortPath
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.components.AppIcon
import groot.mobile.ui.components.Chip
import groot.mobile.ui.components.Field
import groot.mobile.ui.components.LoadableContent
import groot.mobile.ui.components.MenuRow
import groot.mobile.ui.components.PrimaryButton
import groot.mobile.ui.components.ScreenColumn
import groot.mobile.ui.components.ScreenScaffold
import groot.mobile.ui.components.SectionLabel
import groot.mobile.ui.components.Sheet
import groot.mobile.ui.components.rememberResource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** What the New thread screen picks from: the harnesses, the projects and the directories used lately. */
data class NewThreadOptions(val harnesses: List<CodeHarness>, val projects: List<CodeProject>, val recent: List<String>)

/**
 * Start a thread: pick the harness, a project (its own worktree on a new branch) or a working
 * directory, the model and permissions, and write the first message.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NewCodeThreadRoute(container: AppContainer, onStarted: (String) -> Unit, onBack: () -> Unit) {
    val options = rememberResource("code-new") {
        val harnesses = container.code.harnesses()
        // Projects need GitHub and a sandbox; without them Code still works by directory.
        val projects = runCatching { container.code.projects() }.getOrDefault(emptyList())
        val recent = runCatching { recentDirectories(container.code.threads()) }.getOrDefault(emptyList())
        NewThreadOptions(harnesses, projects, recent)
    }
    ScreenScaffold(title = "New thread", onBack = onBack) {
        LoadableContent(options) { loaded ->
            NewThreadForm(container, loaded, onStarted)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun NewThreadForm(container: AppContainer, options: NewThreadOptions, onStarted: (String) -> Unit) {
    val ready = options.harnesses.filter { it.connected }.ifEmpty { options.harnesses }
    var harnessId by rememberSaveable { mutableStateOf(ready.firstOrNull()?.id) }
    var projectId by rememberSaveable { mutableStateOf<String?>(null) }
    var cwd by rememberSaveable { mutableStateOf(options.recent.firstOrNull().orEmpty()) }
    var model by rememberSaveable { mutableStateOf<String?>(null) }
    var mode by rememberSaveable { mutableStateOf<String?>(null) }
    var message by rememberSaveable { mutableStateOf("") }
    var cwdError by remember { mutableStateOf<String?>(null) }
    var starting by remember { mutableStateOf(false) }
    var pickModel by remember { mutableStateOf(false) }
    var models by remember { mutableStateOf<List<CodeModel>>(emptyList()) }
    val scope = rememberCoroutineScope()
    val harness = options.harnesses.firstOrNull { it.id == harnessId }
    val caps = harness?.capabilities

    LaunchedEffect(harnessId) {
        model = null
        mode = caps?.defaultPermissionMode ?: caps?.permissionModes?.firstOrNull()
        models = if (caps?.modelSwitch == true && harnessId != null) {
            runCatching { container.code.models(harnessId!!) }.getOrDefault(emptyList()).filter { it.ready }
        } else {
            emptyList()
        }
    }

    val needsCwd = projectId == null && caps?.requiresCwd == true
    val canStart = harness != null && message.isNotBlank() && (!needsCwd || cwd.isNotBlank()) && !starting

    ScreenColumn(Modifier.imePadding()) {
        if (options.harnesses.size > 1) {
            SectionLabel("Harness")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
                for (option in options.harnesses) {
                    Chip(option.label, selected = option.id == harnessId, enabled = option.connected, onClick = { harnessId = option.id })
                }
            }
        }
        if (options.projects.isNotEmpty()) {
            SectionLabel("Project")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
                Chip("None", selected = projectId == null, onClick = { projectId = null })
                for (project in options.projects) {
                    Chip(project.name, selected = project.id == projectId, onClick = {
                        projectId = project.id
                        project.defaultInstanceId?.takeIf { id -> options.harnesses.any { it.id == id } }?.let { harnessId = it }
                    })
                }
            }
            options.projects.firstOrNull { it.id == projectId }?.let {
                Text(
                    "${it.repo}: a new worktree on its own branch from ${it.baseBranch}.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (projectId == null) {
            Field(
                cwd,
                {
                    cwd = it
                    cwdError = null
                },
                label = "Working directory",
                placeholder = "/home/me/project",
                monospace = true,
                isError = cwdError != null,
                supporting = cwdError ?: if (needsCwd) "Required for ${harness?.label}." else null,
            )
            if (options.recent.isNotEmpty()) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
                    for (dir in options.recent) Chip(shortPath(dir), selected = dir == cwd, onClick = {
                        cwd = dir
                        cwdError = null
                    })
                }
            }
        }
        if (models.isNotEmpty()) {
            SectionLabel("Model")
            Chip(models.firstOrNull { it.id == model }?.label ?: models.firstOrNull { it.isDefault }?.label?.let { "$it (default)" } ?: "Default", icon = AppIcons.Sparkle, onClick = { pickModel = true })
        }
        if (!caps?.permissionModes.isNullOrEmpty()) {
            SectionLabel("Permissions")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
                for (option in caps!!.permissionModes) Chip(PermissionModes.label(option), selected = option == mode, onClick = { mode = option })
            }
            mode?.let { Text(PermissionModes.hint(it), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        Field(message, { message = it }, label = "Task", placeholder = "What should the agent do?", singleLine = false, minLines = 4, maxLines = 12)
        PrimaryButton("Start", loading = starting, enabled = canStart, icon = AppIcons.Play, onClick = {
            val instanceId = harnessId ?: return@PrimaryButton
            starting = true
            scope.launch {
                try {
                    if (projectId == null && cwd.isNotBlank()) {
                        val problem = container.code.checkCwd(instanceId, cwd.trim())
                        if (problem != null) {
                            cwdError = problem
                            return@launch
                        }
                    }
                    val id = container.code.create(
                        instanceId = instanceId,
                        message = message.trim(),
                        projectId = projectId,
                        cwd = cwd.trim().takeIf { projectId == null && it.isNotEmpty() },
                        model = model,
                        permissionMode = mode,
                    )
                    onStarted(id)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    container.notices.showError(e, "Could not start the thread.")
                } finally {
                    starting = false
                }
            }
        })
    }
    if (pickModel) {
        Sheet(onDismiss = { pickModel = false }, title = "Model") {
            for (option in models) {
                MenuRow(
                    AppIcons.Sparkle,
                    option.label,
                    summary = if (option.isDefault) "Default" else null,
                    onClick = {
                        model = option.id
                        pickModel = false
                    },
                    trailing = if (option.id == model) ({ AppIcon(AppIcons.Check, "Current") }) else null,
                )
            }
        }
    }
}
