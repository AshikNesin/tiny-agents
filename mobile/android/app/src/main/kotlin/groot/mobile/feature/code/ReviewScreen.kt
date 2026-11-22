package groot.mobile.feature.code

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.ui.platform.LocalContext
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
import groot.mobile.data.api.PullConversation
import groot.mobile.data.api.CodeReview
import androidx.compose.ui.text.font.FontWeight
import groot.mobile.feature.chat.TypingDots
import groot.mobile.ui.components.SectionLabel
import groot.mobile.ui.components.ScreenColumn
import groot.mobile.data.api.ReviewFinding
import groot.mobile.data.api.ReviewDraft
import groot.mobile.data.api.ReviewVerdict
import groot.mobile.data.api.canSubmitReview
import groot.mobile.data.code.DiffLine
import groot.mobile.data.code.FileDiffView
import groot.mobile.data.code.fileDiffView
import groot.mobile.ui.components.Markdown
import groot.mobile.feature.chat.openLink
import groot.mobile.ui.brand.AppIcons
import groot.mobile.ui.components.AppCard
import groot.mobile.ui.components.Chip
import groot.mobile.ui.components.ConfirmDialog
import groot.mobile.ui.components.EmptyState
import groot.mobile.ui.components.Field
import groot.mobile.ui.components.IconBtn
import groot.mobile.ui.components.LoadingBox
import groot.mobile.ui.components.PrimaryButton
import groot.mobile.ui.components.ScreenScaffold
import groot.mobile.ui.components.SecondaryButton
import groot.mobile.ui.components.Sheet
import groot.mobile.ui.components.relativeTime
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class ReviewTab(val label: String) { Files("Files"), Agent("Agent"), Conversations("Conversations") }

data class ReviewState(
    val review: CodeReview? = null,
    val error: String? = null,
    val tab: ReviewTab = ReviewTab.Files,
    val sinceReview: Boolean = false,
    val files: List<ChangedFile>? = null,
    val open: Map<String, FileDiffView?> = emptyMap(),
    val drafts: List<ReviewDraft> = emptyList(),
    val conversations: List<PullConversation>? = null,
    val busy: Boolean = false,
)

class ReviewViewModel(private val container: AppContainer, private val reviewId: String) : ViewModel() {
    private val api = container.code
    private val _state = MutableStateFlow(ReviewState())
    val state: StateFlow<ReviewState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            attempt("Could not open the review.", fatal = true) {
                val review = api.review(reviewId)
                _state.update { it.copy(review = review, sinceReview = review.hasNewCommits) }
                if (review.reviewing) pollWhileReviewing()
                reload()
            }
        }
    }

    private val scope: String? get() = if (_state.value.sinceReview) "review" else null

    private suspend fun reload() {
        val review = _state.value.review ?: return
        _state.update { it.copy(files = null, open = emptyMap()) }
        val files = api.reviewFiles(review.key, scope).sortedBy { it.generated }
        val drafts = runCatching { api.githubDrafts(review.key) }.getOrDefault(emptyList())
        _state.update { it.copy(files = files, drafts = drafts) }
        loadConversations()
    }

    private suspend fun loadConversations() {
        val conversations = runCatching { api.reviewConversations(reviewId) }.getOrDefault(emptyList())
        _state.update { it.copy(conversations = conversations.sortedBy { c -> c.resolved }) }
    }

    fun setTab(tab: ReviewTab) = _state.update { it.copy(tab = tab) }

    private var polling: kotlinx.coroutines.Job? = null

    private fun pollWhileReviewing() {
        if (polling?.isActive == true) return
        polling = viewModelScope.launch {
            while (_state.value.review?.reviewing == true) {
                kotlinx.coroutines.delay(REVIEW_POLL_MS)
                val next = runCatching { api.review(reviewId) }.getOrNull() ?: continue
                _state.update { it.copy(review = next) }
            }
        }
    }

    fun runAgentReview() = launch("Could not start the review.") {
        api.agentReview(reviewId)
        _state.update { it.copy(review = api.review(reviewId)) }
        pollWhileReviewing()
    }

    fun decide(finding: ReviewFinding, add: Boolean) = launch("Could not do that.") {
        val review = _state.value.review ?: return@launch
        val findings = api.decideFinding(reviewId, finding.id, add)
        _state.update { it.copy(review = it.review?.copy(findings = findings)) }
        if (add) {
            _state.update { it.copy(drafts = api.githubDrafts(review.key)) }
            container.notices.show("Added to your review. It is not posted yet.")
        }
    }

    fun setSinceReview(since: Boolean) {
        if (since == _state.value.sinceReview) return
        _state.update { it.copy(sinceReview = since) }
        launch("Could not load the changed files.") { reload() }
    }

    fun update() = launch("Could not update the review.") {
        val current = _state.value.review ?: return@launch
        val next = api.openReview(current.url)
        _state.update { it.copy(review = next) }
        if (next.headSha != current.headSha) container.notices.show("Moved to the PR's latest commit.")
        reload()
    }

    fun toggle(file: ChangedFile) {
        val review = _state.value.review ?: return
        if (_state.value.open.containsKey(file.path)) {
            _state.update { it.copy(open = it.open - file.path) }
            return
        }
        _state.update { it.copy(open = it.open + (file.path to null)) }
        viewModelScope.launch {
            try {
                val view = fileDiffView(api.reviewFile(review.key, file.path, scope))
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
        val review = _state.value.review ?: return
        val hash = file.hash ?: return
        _state.update { it.copy(files = it.files?.map { f -> if (f.path == file.path) f.copy(viewed = viewed) else f }) }
        launch("Could not mark the file.") { api.markViewed(review.key, file.path, hash, viewed) }
    }

    fun comment(path: String, line: DiffLine, body: String) {
        val review = _state.value.review ?: return
        val number = line.newLine ?: line.oldLine ?: return
        launch("Could not keep the comment.") {
            api.addGithubDraft(review.key, path, number, line.text, body, if (line.newLine == null) "old" else "new")
            _state.update { it.copy(drafts = api.githubDrafts(review.key)) }
        }
    }

    fun removeDraft(draft: ReviewDraft) {
        val review = _state.value.review ?: return
        launch("Could not remove the comment.") {
            api.removeGithubDraft(review.key, draft.id)
            _state.update { it.copy(drafts = it.drafts.filter { d -> d.id != draft.id }) }
        }
    }

    fun submit(verdict: ReviewVerdict, body: String, done: () -> Unit) = launch("Could not submit the review.") {
        api.submitReview(reviewId, verdict, body)
        _state.update { it.copy(drafts = emptyList()) }
        container.notices.show("Review submitted on GitHub.")
        done()
        loadConversations()
    }

    fun reply(conversation: PullConversation, body: String) = launch("Could not reply.") {
        api.replyToConversation(reviewId, conversation.id, body)
        loadConversations()
    }

    fun resolve(conversation: PullConversation) = launch("Could not resolve the conversation.") {
        api.resolveConversation(reviewId, conversation.id)
        loadConversations()
    }

    fun close(done: () -> Unit) = launch("Could not close the review.") {
        api.archiveReview(reviewId)
        done()
    }

    private fun launch(failure: String, block: suspend () -> Unit) {
        viewModelScope.launch { attempt(failure, fatal = false, block = block) }
    }

    private suspend fun attempt(failure: String, fatal: Boolean, block: suspend () -> Unit) {
        _state.update { it.copy(busy = true) }
        try {
            block()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (fatal) _state.update { it.copy(error = e.message ?: failure) } else container.notices.showError(e, failure)
        } finally {
            _state.update { it.copy(busy = false) }
        }
    }

    companion object {
        fun factory(container: AppContainer, reviewId: String) = viewModelFactory { initializer { ReviewViewModel(container, reviewId) } }
    }
}

@Composable
fun ReviewRoute(container: AppContainer, reviewId: String, onBack: () -> Unit) {
    val viewModel: ReviewViewModel = viewModel(key = "review:$reviewId", factory = ReviewViewModel.factory(container, reviewId))
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var commenting by remember { mutableStateOf<Pair<String, DiffLine>?>(null) }
    var submitting by remember { mutableStateOf(false) }
    var closing by remember { mutableStateOf(false) }
    val review = state.review
    ScreenScaffold(
        title = review?.let { "#${it.number} ${it.title}" } ?: "Review",
        subtitle = review?.let { "${it.repo} · @${it.author} · ${it.headRef} → ${it.baseRef}" },
        onBack = onBack,
        actions = {
            if (review != null) {
                IconBtn(AppIcons.Refresh, "Update to the latest commit", viewModel::update)
                IconBtn(AppIcons.External, "Open on GitHub", onClick = { openLink(context, null, review.url) })
                IconBtn(AppIcons.Close, "Close review", onClick = { closing = true })
            }
        },
    ) {
        when {
            state.error != null -> EmptyState("This review is not available", body = state.error, icon = AppIcons.Alert)
            review == null -> LoadingBox()
            else -> Column(Modifier.fillMaxSize()) {
                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = S.lg, vertical = S.sm),
                    horizontalArrangement = Arrangement.spacedBy(S.sm),
                ) {
                    for (tab in ReviewTab.entries) {
                        val count = when (tab) {
                            ReviewTab.Conversations -> state.conversations?.count { !it.resolved }?.takeIf { it > 0 }
                            ReviewTab.Agent -> review.openFindings.size.takeIf { it > 0 }
                            ReviewTab.Files -> null
                        }
                        Chip(listOfNotNull(tab.label, count?.toString()).joinToString(" "), selected = state.tab == tab, onClick = { viewModel.setTab(tab) })
                    }
                    if (state.tab == ReviewTab.Files && review.reviewedSha != null) {
                        Chip("Since your review", selected = state.sinceReview, onClick = { viewModel.setSinceReview(!state.sinceReview) })
                    }
                }
                Box(Modifier.weight(1f)) {
                    when (state.tab) {
                        ReviewTab.Files -> ReviewFiles(state, viewModel, onComment = { path, line -> commenting = path to line })
                        ReviewTab.Conversations -> Conversations(state.conversations, onReply = viewModel::reply, onResolve = viewModel::resolve)
                        ReviewTab.Agent -> AgentReview(review, state.busy, onRun = viewModel::runAgentReview, onDecide = viewModel::decide)
                    }
                }
                Box(Modifier.fillMaxWidth().padding(S.md).navigationBarsPadding(), contentAlignment = Alignment.Center) {
                    PrimaryButton(
                        when (state.drafts.size) {
                            0 -> "Submit review"
                            1 -> "Submit review · 1 comment"
                            else -> "Submit review · ${state.drafts.size} comments"
                        },
                        onClick = { submitting = true },
                        icon = AppIcons.Check,
                    )
                }
            }
        }
    }
    commenting?.let { (path, line) ->
        var body by remember(path, line) { mutableStateOf("") }
        Sheet(onDismiss = { commenting = null }, title = "Comment on line ${line.newLine ?: line.oldLine}") {
            Text(path, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            CodeBlock(line.text, maxLines = 3)
            Field(body, { body = it }, placeholder = "Your comment for the author", singleLine = false, minLines = 3)
            Hint("It goes to GitHub with your review when you submit it.")
            PrimaryButton("Add comment", enabled = body.isNotBlank(), onClick = {
                viewModel.comment(path, line, body.trim())
                commenting = null
            })
        }
    }
    if (submitting && review != null) {
        SubmitSheet(review, state.drafts, state.busy, onRemove = viewModel::removeDraft, onSubmit = { verdict, body ->
            viewModel.submit(verdict, body) { submitting = false }
        }, onDismiss = { submitting = false })
    }
    if (closing) {
        ConfirmDialog(
            title = "Close this review?",
            text = "It leaves your list and its checkout is removed. Comments you haven't submitted are lost.",
            confirmLabel = "Close",
            destructive = true,
            onConfirm = {
                closing = false
                viewModel.close(onBack)
            },
            onDismiss = { closing = false },
        )
    }
}

@Composable
private fun ReviewFiles(state: ReviewState, viewModel: ReviewViewModel, onComment: (String, DiffLine) -> Unit) {
    val files = state.files
    when {
        files == null -> LoadingBox()
        files.isEmpty() -> EmptyState(if (state.sinceReview) "Nothing changed since your review" else "No changed files", icon = AppIcons.File)
        else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = S.lg, vertical = S.xs)) {
            items(files, key = { it.path }) { file ->
                FileCard(
                    file = file,
                    view = state.open[file.path],
                    open = state.open.containsKey(file.path),
                    review = true,
                    onToggle = { viewModel.toggle(file) },
                    onViewed = { viewModel.setViewed(file, it) },
                    onComment = { line -> onComment(file.path, line) },
                )
            }
        }
    }
}

@Composable
private fun Conversations(conversations: List<PullConversation>?, onReply: (PullConversation, String) -> Unit, onResolve: (PullConversation) -> Unit) {
    when {
        conversations == null -> LoadingBox()
        conversations.isEmpty() -> EmptyState("No line comments yet", icon = AppIcons.File, body = "Comments on this pull request's lines show here.")
        else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(S.lg), verticalArrangement = Arrangement.spacedBy(S.sm)) {
            items(conversations, key = { it.id }) { conversation -> ConversationCard(conversation, onReply, onResolve) }
        }
    }
}

@Composable
private fun ConversationCard(conversation: PullConversation, onReply: (PullConversation, String) -> Unit, onResolve: (PullConversation) -> Unit) {
    var reply by remember(conversation.id) { mutableStateOf("") }
    var expanded by remember(conversation.id) { mutableStateOf(!conversation.resolved) }
    AppCard(onClick = if (conversation.resolved) ({ expanded = !expanded }) else null) {
        Column(verticalArrangement = Arrangement.spacedBy(S.sm)) {
            Text(
                listOfNotNull(
                    conversation.path + (conversation.line?.let { ":$it" } ?: ""),
                    "outdated".takeIf { conversation.outdated },
                    "resolved".takeIf { conversation.resolved },
                ).joinToString(" · "),
                style = MaterialTheme.typography.labelMedium,
                fontFamily = FontFamily.Monospace,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.StartEllipsis,
            )
            val shown = if (expanded) conversation.comments else conversation.comments.take(1)
            for (comment in shown) {
                Column {
                    Text(
                        "@${comment.author}${if (comment.bot) " (bot)" else ""} · ${relativeTime(comment.createdAt)}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Markdown(comment.body)
                }
            }
            if (expanded && !conversation.resolved) {
                Field(reply, { reply = it }, placeholder = "Reply", singleLine = false, minLines = 1)
                Row(horizontalArrangement = Arrangement.spacedBy(S.sm)) {
                    PrimaryButton("Reply", enabled = reply.isNotBlank(), onClick = {
                        onReply(conversation, reply.trim())
                        reply = ""
                    })
                    SecondaryButton("Resolve", onClick = { onResolve(conversation) })
                }
            }
        }
    }
}

@Composable
private fun SubmitSheet(
    review: CodeReview,
    drafts: List<ReviewDraft>,
    busy: Boolean,
    onRemove: (ReviewDraft) -> Unit,
    onSubmit: (ReviewVerdict, String) -> Unit,
    onDismiss: () -> Unit,
) {
    var verdict by remember { mutableStateOf(ReviewVerdict.Comment) }
    var body by remember { mutableStateOf("") }
    Sheet(onDismiss = onDismiss, title = "Submit review") {
        Hint(
            when (drafts.size) {
                0 -> "No line comments yet. Tap a line in a diff to add some."
                1 -> "1 comment goes with it, on the commit you read."
                else -> "${drafts.size} comments go with it, on the commit you read."
            },
        )
        for (draft in drafts) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(S.sm)) {
                Column(Modifier.weight(1f)) {
                    Text("${draft.path}:${draft.lines}", style = MaterialTheme.typography.labelSmall, fontFamily = FontFamily.Monospace, maxLines = 1, overflow = TextOverflow.StartEllipsis)
                    Text(draft.body, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                IconBtn(AppIcons.Trash, "Remove comment on ${draft.path}:${draft.lines}", onClick = { onRemove(draft) })
            }
        }
        Field(
            body,
            { body = it },
            placeholder = if (verdict == ReviewVerdict.RequestChanges) "Say what to change…" else "Leave a summary (optional)",
            singleLine = false,
            minLines = 3,
        )
        FlowRow(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalArrangement = Arrangement.spacedBy(S.sm)) {
            for (option in ReviewVerdict.entries) {
                Chip(option.label, selected = verdict == option, enabled = !review.mine || option == ReviewVerdict.Comment, onClick = { verdict = option })
            }
        }
        if (review.mine) Hint("This is your pull request: GitHub lets you comment on it, not approve it.")
        PrimaryButton(
            "Submit",
            enabled = canSubmitReview(verdict, body, drafts.size, review.mine),
            loading = busy,
            modifier = Modifier.fillMaxWidth(),
            onClick = { onSubmit(verdict, body.trim()) },
        )
    }
}

@Composable
private fun AgentReview(review: CodeReview, busy: Boolean, onRun: () -> Unit, onDecide: (ReviewFinding, Boolean) -> Unit) {
    ScreenColumn {
        when {
            review.reviewing -> Row(horizontalArrangement = Arrangement.spacedBy(S.sm), verticalAlignment = Alignment.CenterVertically) {
                TypingDots()
                Text("The agent is reading the change.", style = MaterialTheme.typography.bodyMedium)
            }
            else -> SecondaryButton(
                if (review.brief == null) "Review with the agent" else "Review again",
                onClick = onRun,
                icon = AppIcons.Sparkle,
                enabled = !busy,
            )
        }
        review.brief?.let { brief ->
            SectionLabel("Brief")
            Text(brief, style = MaterialTheme.typography.bodyMedium)
        }
        if (review.brief != null && !review.reviewing) {
            val open = review.openFindings
            SectionLabel(if (open.isEmpty()) "No open findings" else "Findings · ${open.size} open")
            for (finding in open) {
                AppCard {
                    Column(verticalArrangement = Arrangement.spacedBy(S.sm)) {
                        Text(
                            "${finding.severity} · ${finding.path.substringAfterLast('/')}:${finding.line}",
                            style = MaterialTheme.typography.labelSmall,
                            color = if (finding.severity == "bug") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(finding.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                        if (finding.body.isNotBlank()) Text(finding.body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Row(horizontalArrangement = Arrangement.spacedBy(S.sm)) {
                            PrimaryButton("Add to my review", onClick = { onDecide(finding, true) }, icon = AppIcons.Check, enabled = !busy)
                            SecondaryButton("Dismiss", onClick = { onDecide(finding, false) }, enabled = !busy)
                        }
                    }
                }
            }
            val settled = review.findings.filter { it.state != "open" }
            for (finding in settled) {
                Text(
                    "${finding.title}: ${if (finding.state == "added") "in your review" else "dismissed"}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Hint("Nothing is posted until you submit your review.")
        }
    }
}

private const val REVIEW_POLL_MS = 3_000L
