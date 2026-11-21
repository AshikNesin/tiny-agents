package groot.mobile.feature.code

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.data.api.ChangedFile
import groot.mobile.data.api.GitDiff
import groot.mobile.data.code.DiffLine
import groot.mobile.data.code.FileDiffView
import groot.mobile.data.code.fileDiffView
import groot.mobile.ui.brand.Accents
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.brand.Dims
import groot.mobile.ui.components.AppIcon
import groot.mobile.ui.components.Chip
import groot.mobile.ui.components.EmptyState
import groot.mobile.ui.components.Field
import groot.mobile.ui.components.IconBtn
import groot.mobile.ui.components.LoadingBox
import groot.mobile.ui.components.PrimaryButton
import groot.mobile.ui.components.ScreenScaffold
import groot.mobile.ui.components.Sheet
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

sealed interface ChangesScope {
    val key: String

    data object Branch : ChangesScope {
        override val key = "branch"
    }

    data class Harness(val diff: GitDiff) : ChangesScope {
        override val key = "diff:${diff.id}"
    }
}

data class ChangesState(
    val loading: Boolean = true,
    val error: String? = null,
    val project: Boolean = false,
    val scopes: List<ChangesScope> = emptyList(),
    val scope: ChangesScope? = null,
    val files: List<ChangedFile>? = null,
    val open: Map<String, FileDiffView?> = emptyMap(),
    val drafts: Int = 0,
)

class CodeChangesViewModel(private val container: AppContainer, private val threadId: String) : ViewModel() {
    private val api = container.code
    private val _state = MutableStateFlow(ChangesState())
    val state: StateFlow<ChangesState> = _state.asStateFlow()
    private var instanceId = instanceOf(threadId)
    private var cwd: String? = null

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            try {
                val thread = api.snapshot(threadId).thread
                instanceId = thread.instanceId.ifEmpty { instanceId }
                cwd = thread.cwd
                val project = thread.projectId != null
                val diffs = thread.cwd?.let { dir -> runCatching { api.diffs(instanceId, dir) }.getOrDefault(emptyList()) }.orEmpty()
                val scopes = buildList {
                    if (project) add(ChangesScope.Branch)
                    for (diff in diffs) if (diff.id != "working" || diff.filesCount > 0) add(ChangesScope.Harness(diff))
                }
                val drafts = if (project) runCatching { api.reviewDraftCount(threadId) }.getOrDefault(0) else 0
                _state.update { it.copy(loading = false, error = null, project = project, scopes = scopes, drafts = drafts) }
                select(_state.value.scope?.let { current -> scopes.firstOrNull { it.key == current.key } } ?: scopes.firstOrNull())
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = e.message ?: "Could not load the changes.") }
            }
        }
    }

    fun select(scope: ChangesScope?) {
        _state.update { it.copy(scope = scope, files = if (scope == null) emptyList() else null, open = emptyMap()) }
        scope ?: return
        viewModelScope.launch {
            try {
                val files = when (scope) {
                    ChangesScope.Branch -> api.reviewFiles(threadId)
                    is ChangesScope.Harness -> api.diffFiles(instanceId, scope.diff.id, cwd.orEmpty())
                }
                _state.update { if (it.scope == scope) it.copy(files = files.sortedBy { f -> f.generated }) else it }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                container.notices.showError(e, "Could not load the changed files.")
                _state.update { if (it.scope == scope) it.copy(files = emptyList()) else it }
            }
        }
    }

    fun toggle(file: ChangedFile) {
        val scope = _state.value.scope ?: return
        if (_state.value.open.containsKey(file.path)) {
            _state.update { it.copy(open = it.open - file.path) }
            return
        }
        _state.update { it.copy(open = it.open + (file.path to null)) }
        viewModelScope.launch {
            try {
                val contents = when (scope) {
                    ChangesScope.Branch -> api.reviewFile(threadId, file.path)
                    is ChangesScope.Harness -> api.diffFile(instanceId, scope.diff.id, cwd.orEmpty(), file.path)
                }
                val view = fileDiffView(contents)
                _state.update { if (it.open.containsKey(file.path)) it.copy(open = it.open + (file.path to view)) else it }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                container.notices.showError(e, "Could not load the diff.")
                _state.update { it.copy(open = it.open - file.path) }
            }
        }
    }

    fun setViewed(file: ChangedFile, viewed: Boolean) {
        val hash = file.hash ?: return
        _state.update { it.copy(files = it.files?.map { f -> if (f.path == file.path) f.copy(viewed = viewed) else f }) }
        viewModelScope.launch {
            try {
                api.markViewed(threadId, file.path, hash, viewed)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                container.notices.showError(e, "Could not mark the file.")
            }
        }
    }

    fun comment(path: String, line: DiffLine, body: String) {
        val number = line.newLine ?: line.oldLine ?: return
        val side = if (line.newLine == null) "old" else "new"
        viewModelScope.launch {
            try {
                api.addReviewDraft(threadId, path, number, number, line.text, body, side)
                _state.update { it.copy(drafts = it.drafts + 1) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                container.notices.showError(e, "Could not keep the comment.")
            }
        }
    }

    fun sendReview(done: () -> Unit) {
        viewModelScope.launch {
            try {
                val sent = api.sendReview(threadId)
                _state.update { it.copy(drafts = 0) }
                container.notices.show(if (sent == 1) "Sent 1 comment to the agent." else "Sent $sent comments to the agent.")
                done()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                container.notices.showError(e, "Could not send the comments.")
            }
        }
    }

    companion object {
        fun factory(container: AppContainer, threadId: String) = viewModelFactory { initializer { CodeChangesViewModel(container, threadId) } }
    }
}

@Composable
fun CodeChangesRoute(container: AppContainer, threadId: String, onBack: () -> Unit) {
    val viewModel: CodeChangesViewModel = viewModel(key = "changes:$threadId", factory = CodeChangesViewModel.factory(container, threadId))
    val state by viewModel.state.collectAsStateWithLifecycle()
    var commenting by remember { mutableStateOf<Pair<String, DiffLine>?>(null) }
    ScreenScaffold(
        title = "Changes",
        subtitle = state.scope?.let(::scopeLabel),
        onBack = onBack,
        actions = { IconBtn(AppIcons.Refresh, "Refresh", viewModel::refresh) },
    ) {
        when {
            state.loading -> LoadingBox()
            state.error != null -> EmptyState("Could not load the changes", body = state.error, icon = AppIcons.Alert, actionLabel = "Try again", onAction = viewModel::refresh)
            state.scopes.isEmpty() -> EmptyState("No changes", icon = AppIcons.File, body = "The working tree is clean.")
            else -> Column(Modifier.fillMaxSize()) {
                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = S.lg, vertical = S.sm),
                    horizontalArrangement = Arrangement.spacedBy(S.sm),
                ) {
                    for (scope in state.scopes) Chip(scopeLabel(scope), selected = scope.key == state.scope?.key, onClick = { viewModel.select(scope) })
                }
                Box(Modifier.weight(1f)) {
                    val files = state.files
                    when {
                        files == null -> LoadingBox()
                        files.isEmpty() -> EmptyState("No changed files", icon = AppIcons.File)
                        else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = S.lg, vertical = S.xs)) {
                            items(files, key = { it.path }) { file ->
                                FileCard(
                                    file = file,
                                    view = state.open[file.path],
                                    open = state.open.containsKey(file.path),
                                    review = state.scope == ChangesScope.Branch,
                                    onToggle = { viewModel.toggle(file) },
                                    onViewed = { viewModel.setViewed(file, it) },
                                    onComment = { line -> commenting = file.path to line },
                                )
                            }
                        }
                    }
                }
                if (state.drafts > 0) {
                    Box(Modifier.fillMaxWidth().padding(S.md).navigationBarsPadding(), contentAlignment = Alignment.Center) {
                        PrimaryButton(
                            if (state.drafts == 1) "Send 1 comment to the agent" else "Send ${state.drafts} comments to the agent",
                            onClick = { viewModel.sendReview(onBack) },
                            icon = AppIcons.ArrowUp,
                        )
                    }
                }
            }
        }
    }
    commenting?.let { (path, line) ->
        var body by remember(path, line) { mutableStateOf("") }
        Sheet(onDismiss = { commenting = null }, title = "Comment on line ${line.newLine ?: line.oldLine}") {
            Text(path, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            CodeBlock(line.text, maxLines = 3)
            Field(body, { body = it }, placeholder = "What should change here?", singleLine = false, minLines = 3)
            PrimaryButton("Add comment", enabled = body.isNotBlank(), onClick = {
                viewModel.comment(path, line, body.trim())
                commenting = null
            })
        }
    }
}

private fun scopeLabel(scope: ChangesScope): String = when (scope) {
    ChangesScope.Branch -> "Branch"
    is ChangesScope.Harness -> if (scope.diff.id == "working") "Uncommitted" else scope.diff.message.lineSequence().first().take(MAX_SCOPE_LABEL)
}

@Composable
private fun FileCard(
    file: ChangedFile,
    view: FileDiffView?,
    open: Boolean,
    review: Boolean,
    onToggle: () -> Unit,
    onViewed: (Boolean) -> Unit,
    onComment: (DiffLine) -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(vertical = S.xs), verticalArrangement = Arrangement.spacedBy(S.xs)) {
        Row(
            Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onToggle).padding(vertical = S.sm),
            horizontalArrangement = Arrangement.spacedBy(S.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AppIcon(if (open) AppIcons.ChevronDown else AppIcons.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, size = Dims.iconSmall)
            Text(
                file.path,
                style = MaterialTheme.typography.bodyMedium,
                fontFamily = FontFamily.Monospace,
                color = if (file.generated || file.viewed) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.StartEllipsis,
                modifier = Modifier.weight(1f),
            )
            if (file.status != "modified") Text(file.status, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (file.binary) Text("binary", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("+${file.additions}", style = MaterialTheme.typography.labelSmall, color = Accents.success)
            Text("−${file.deletions}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
            if (review && file.hash != null) Chip("Viewed", selected = file.viewed, icon = if (file.viewed) AppIcons.Check else null, onClick = { onViewed(!file.viewed) })
        }
        if (open) {
            when {
                view == null -> Text("Loading the diff…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                view.notice != null -> Text(view.notice, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                view.lines.isEmpty() -> Text("No line changes.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                else -> {
                    if (review) Text("Tap a line to comment on it.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    DiffView(view.lines, maxLines = MAX_DIFF_LINES, onLongPress = if (review) onComment else null)
                }
            }
        }
    }
}

private const val MAX_DIFF_LINES = 1500
private const val MAX_SCOPE_LABEL = 40
