package groot.mobile.feature.code

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import groot.kit.theme.S
import groot.mobile.AppContainer
import groot.mobile.data.api.CodeHarness
import groot.mobile.data.api.CodeListEvent
import groot.mobile.data.api.CodeThreadSummary
import groot.mobile.data.api.SseSignal
import groot.mobile.data.code.CodeListNode
import groot.mobile.data.code.buildCodeSections
import groot.mobile.data.code.shortPath
import groot.mobile.feature.chat.TypingDots
import groot.mobile.ui.brand.Accents
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.brand.Dims
import groot.mobile.ui.components.AppIcon
import groot.mobile.ui.components.Chip
import groot.mobile.ui.components.EmptyState
import groot.mobile.ui.components.IconBtn
import groot.mobile.ui.components.LoadingBox
import groot.mobile.ui.components.ScreenScaffold
import groot.mobile.ui.components.SectionLabel
import groot.mobile.ui.components.StatusDot
import groot.mobile.ui.components.relativeTime
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class CodeListState(
    val loading: Boolean = true,
    val error: String? = null,
    val harnesses: List<CodeHarness> = emptyList(),
    val states: Map<String, String> = emptyMap(),
    val threads: List<CodeThreadSummary> = emptyList(),
    val connected: Boolean = false,
    val showArchived: Boolean = false,
    val archived: List<CodeThreadSummary>? = null,
    val harnessFilter: String? = null,
)

class CodeListViewModel(private val container: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(CodeListState())
    val state: StateFlow<CodeListState> = _state.asStateFlow()
    private var stream: Job? = null

    init {
        loadHarnesses()
    }

    private fun loadHarnesses() {
        viewModelScope.launch {
            try {
                val harnesses = container.code.harnesses()
                _state.update { it.copy(harnesses = harnesses, error = null, loading = harnesses.isNotEmpty() && it.threads.isEmpty() && !it.connected) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = e.message ?: "Could not load Code.") }
            }
        }
    }

    fun show() {
        if (stream?.isActive == true) return
        stream = viewModelScope.launch {
            container.code.events().collect { signal ->
                when (signal) {
                    SseSignal.Open -> _state.update { it.copy(connected = true) }
                    SseSignal.Drop -> _state.update { it.copy(connected = false) }
                    is SseSignal.Event -> when (val event = CodeListEvent.from(signal.json)) {
                        is CodeListEvent.Status -> _state.update { it.copy(states = event.states) }
                        is CodeListEvent.Threads -> _state.update { it.copy(threads = event.threads, loading = false) }
                        is CodeListEvent.Error -> _state.update { it.copy(error = event.message, loading = false) }
                        null -> Unit
                    }
                }
            }
        }
    }

    fun hide() {
        stream?.cancel()
        stream = null
    }

    fun retry() {
        _state.update { it.copy(error = null, loading = true) }
        loadHarnesses()
        hide()
        show()
    }

    fun setHarnessFilter(id: String?) = _state.update { it.copy(harnessFilter = id) }

    fun setShowArchived(show: Boolean) {
        _state.update { it.copy(showArchived = show, archived = if (show) it.archived else null) }
        if (!show) return
        viewModelScope.launch {
            try {
                val archived = container.code.archived()
                _state.update { it.copy(archived = archived) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                container.notices.showError(e, "Could not load the archived threads.")
                _state.update { it.copy(archived = emptyList()) }
            }
        }
    }

    companion object {
        fun factory(container: AppContainer) = viewModelFactory { initializer { CodeListViewModel(container) } }
    }
}

@Composable
fun CodeListRoute(container: AppContainer, onOpen: (String) -> Unit, onNew: () -> Unit, onBack: () -> Unit) {
    val viewModel: CodeListViewModel = viewModel(factory = CodeListViewModel.factory(container))
    DisposableEffect(viewModel) {
        viewModel.show()
        onDispose { viewModel.hide() }
    }
    val state by viewModel.state.collectAsStateWithLifecycle()
    CodeListScreen(
        state = state,
        onOpen = onOpen,
        onNew = onNew,
        onFilter = viewModel::setHarnessFilter,
        onShowArchived = viewModel::setShowArchived,
        onRetry = viewModel::retry,
        onBack = onBack,
    )
}

@Composable
fun CodeListScreen(
    state: CodeListState,
    onOpen: (String) -> Unit,
    onNew: () -> Unit,
    onFilter: (String?) -> Unit,
    onShowArchived: (Boolean) -> Unit,
    onRetry: () -> Unit,
    onBack: () -> Unit,
    now: () -> Long = System::currentTimeMillis,
) {
    val labels = state.harnesses.associate { it.id to it.label }
    ScreenScaffold(
        title = "Code",
        onBack = onBack,
        subtitle = if (!state.connected && !state.loading && state.harnesses.isNotEmpty()) "Reconnecting" else null,
        actions = { if (state.harnesses.isNotEmpty()) IconBtn(AppIcons.Compose, "New thread", onNew) },
    ) {
        when {
            state.error != null && state.harnesses.isEmpty() -> EmptyState(
                "Could not load Code",
                body = state.error,
                icon = AppIcons.Alert,
                actionLabel = "Try again",
                onAction = onRetry,
            )
            state.harnesses.isEmpty() && !state.loading -> EmptyState(
                "Code is not set up",
                icon = AppIcons.Code,
                body = "Set SHELLEY_URL, or add the Claude plan account in the web app under Settings, Models, then restart the server.",
            )
            state.loading && state.threads.isEmpty() -> LoadingBox()
            else -> Column(Modifier.fillMaxSize()) {
                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = S.lg, vertical = S.sm),
                    horizontalArrangement = Arrangement.spacedBy(S.sm),
                ) {
                    if (state.harnesses.size > 1) {
                        Chip("All", selected = state.harnessFilter == null && !state.showArchived, onClick = { onShowArchived(false); onFilter(null) })
                        for (harness in state.harnesses) {
                            Chip(harness.label, selected = state.harnessFilter == harness.id && !state.showArchived, onClick = { onShowArchived(false); onFilter(harness.id) })
                        }
                    } else {
                        Chip("Active", selected = !state.showArchived, onClick = { onShowArchived(false) })
                    }
                    Chip("Archived", selected = state.showArchived, onClick = { onShowArchived(!state.showArchived) })
                }
                for (harness in state.harnesses) {
                    val live = state.states[harness.id] ?: harness.state
                    if (live != "connected") HarnessProblem(harness, live)
                }
                Box(Modifier.weight(1f)) {
                    if (state.showArchived) {
                        val archived = state.archived
                        when {
                            archived == null -> LoadingBox()
                            archived.isEmpty() -> EmptyState("Nothing archived", icon = AppIcons.Code)
                            else -> ThreadList(
                                buildCodeSections(archived, state.harnessFilter).let { it.working + it.recent },
                                emptyList(),
                                labels,
                                now,
                                onOpen,
                            )
                        }
                    } else {
                        val sections = buildCodeSections(state.threads, state.harnessFilter)
                        if (sections.working.isEmpty() && sections.recent.isEmpty()) {
                            EmptyState(
                                "No threads yet",
                                icon = AppIcons.Code,
                                body = "Start one, or ask a bot to hand off a coding task.",
                                actionLabel = "New thread",
                                onAction = onNew,
                            )
                        } else {
                            ThreadList(sections.recent, sections.working, labels, now, onOpen)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun HarnessProblem(harness: CodeHarness, state: String) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = S.lg, vertical = S.xs),
        horizontalArrangement = Arrangement.spacedBy(S.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StatusDot(if (state == "disabled") MaterialTheme.colorScheme.error else Accents.warning)
        Text(
            buildString {
                append(harness.label)
                append(": ")
                append(
                    when (state) {
                        "connecting" -> "connecting"
                        "reconnecting" -> "reconnecting"
                        else -> "not available"
                    },
                )
                harness.detail?.let { append(". ").append(it) }
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun ThreadList(
    recent: List<CodeListNode>,
    working: List<CodeListNode>,
    labels: Map<String, String>,
    now: () -> Long,
    onOpen: (String) -> Unit,
) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = S.sm, vertical = S.xs)) {
        if (working.isNotEmpty()) {
            item(key = "working") { SectionLabel("Working now", Modifier.padding(start = S.md)) }
            nodes(working, 0, labels, now, onOpen)
        }
        if (recent.isNotEmpty()) {
            if (working.isNotEmpty()) item(key = "recent") { SectionLabel("Recent", Modifier.padding(start = S.md, top = S.md)) }
            nodes(recent, 0, labels, now, onOpen)
        }
        item(key = "end") { Spacer(Modifier.height(S.xl)) }
    }
}

private fun LazyListScope.nodes(nodes: List<CodeListNode>, depth: Int, labels: Map<String, String>, now: () -> Long, onOpen: (String) -> Unit) {
    for (node in nodes) {
        item(key = node.row.id) { ThreadRow(node, depth, labels[node.row.instanceId] ?: node.row.kind, now, onOpen) }
        if (depth < MAX_INDENT) nodes(node.children, depth + 1, labels, now, onOpen)
    }
}

@Composable
private fun ThreadRow(node: CodeListNode, depth: Int, harness: String, now: () -> Long, onOpen: (String) -> Unit) {
    val row = node.row
    Row(
        Modifier
            .fillMaxWidth()
            .padding(start = indent(depth))
            .clip(RoundedCornerShape(Dims.fieldRadius))
            .clickable(role = Role.Button, onClick = { onOpen(row.id) })
            .padding(horizontal = S.md, vertical = S.sm),
        horizontalArrangement = Arrangement.spacedBy(S.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (depth > 0) AppIcon(AppIcons.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, size = Dims.iconSmall)
        Column(Modifier.weight(1f)) {
            Text(
                row.title.ifBlank { "Untitled" },
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = if (row.unread) FontWeight.Bold else FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            val details = listOfNotNull(
                harness,
                shortPath(row.repoRoot ?: row.cwd).takeIf { it.isNotEmpty() },
                row.pr?.let { "PR #${it.number}" + loopNote(it.loop) },
                row.queuedCount.takeIf { it > 0 }?.let { "$it queued" },
                "Interrupted".takeIf { row.turnInterrupted },
            )
            Text(
                details.joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(S.xs)) {
            if (node.busy) {
                TypingDots(Modifier.height(S.lg))
            } else {
                Text(relativeTime(row.updatedAt, now()), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (node.unread) {
                    StatusDot(MaterialTheme.colorScheme.primary)
                } else {
                    Spacer(Modifier.height(Dims.dot))
                }
            }
        }
    }
}

internal fun loopNote(loop: String): String = when (loop) {
    "fixing" -> ", fixing"
    "needs_input" -> ", needs you"
    "green" -> ", green"
    "paused" -> ", paused"
    "merged" -> ", merged"
    else -> ""
}

@Composable
private fun indent(depth: Int): Dp = S.lg * depth.coerceAtMost(MAX_INDENT)

private const val MAX_INDENT = 3
